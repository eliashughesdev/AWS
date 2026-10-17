#!/usr/bin/env bash
# Run in AWS CloudShell.
#
# B31 step 8, part 1: retires every custodial account in this environment that still has
# its own KMS key, so it can be created again under its merchant's seed. Accounts that are
# already derived (keyModel = hd, no kmsKeyId) and the seeds themselves are never touched.
#
# For every ACCOUNT# row on v2CustomerTable with a real kmsKeyId, a vAccountId and a
# depositAddress, in this order:
#
#   1. Tatum: DELETE every subscription watching its depositAddress.
#   2. Tatum: remove the deposit address from its VA — this is what stops the per-address
#      daily scanning charge.
#   3. DynamoDB: delete its v1AccountBalanceTable row and its ACCOUNT# row.
#   4. KMS: schedule deletion of its key (30-day recovery window).
#
# Steps 3 and 4 only run if 1 and 2 succeeded: the row is the only record of the VA and the
# address, so an account whose Tatum side could not be undone is left whole for a re-run.
#
# Then the merchant masters still on a KMS key. Each is retired by
# delete-merchant-master.sh, which has its own checks, a backup and its own prompt. If that
# script sits next to this one (or in ../cleanup) it is run for each master; otherwise the
# commands are printed. Provision each master again with /merchants/masters/provision.
#
# SAFETY GATES
#   - Never touched, whatever the flags: an account whose key can't be described or isn't
#     tagged service=loudibly and accountId=<accountNo>.
#   - Skipped unless FORCE_NONZERO_BALANCE=1: an account whose on-chain balance or app
#     balance is nonzero or can't be read. The key controls whatever sits at the address,
#     and it is gone for good 30 days after this runs.
#
# The Tatum key comes from TATUM_API_KEY if exported, else SSM /loudibly/api/TATUM_API_KEY,
# else the Secrets Manager secret TATUM_API_KEY.
#
# Usage:
#   bash retire-kms-accounts.sh            # dry run: the full report, nothing touched
#   bash retire-kms-accounts.sh --commit   # after review; asks you to type DELETE once

set -uo pipefail

BASE_URL="${TATUM_BASE_URL:-https://api.tatum.io/v3}"
REGION="${AWS_REGION:-us-east-2}"
TABLE="v2CustomerTable"
BALANCE_TABLE="v1AccountBalanceTable"
MERCHANT_TABLE="v1MerchantTable"
PENDING_WINDOW_DAYS=30
FORCE_NONZERO="${FORCE_NONZERO_BALANCE:-0}"
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
COMMIT=0
[[ "${1:-}" == "--commit" ]] && COMMIT=1

[[ $COMMIT -eq 1 ]] && echo "MODE: commit" || echo "MODE: dry run (pass --commit to write)"

TATUM_KEY_SOURCE="env"
if [[ -z "${TATUM_API_KEY:-}" ]]; then
  TATUM_KEY_SOURCE="SSM /loudibly/api/TATUM_API_KEY"
  TATUM_API_KEY=$(aws ssm get-parameter --region "$REGION" --name "/loudibly/api/TATUM_API_KEY" \
    --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)
fi
if [[ -z "${TATUM_API_KEY:-}" || "$TATUM_API_KEY" == "None" ]]; then
  TATUM_KEY_SOURCE="Secrets Manager TATUM_API_KEY"
  TATUM_API_KEY=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id TATUM_API_KEY \
    --query SecretString --output text 2>/dev/null | jq -r '.TATUM_API_KEY // empty' 2>/dev/null)
fi
if [[ -z "${TATUM_API_KEY:-}" ]]; then
  echo "ERROR: no Tatum key in env, SSM /loudibly/api/TATUM_API_KEY or Secrets Manager TATUM_API_KEY." >&2
  exit 1
fi
echo "Using Tatum key from $TATUM_KEY_SOURCE"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
SUBS_JSON="$WORKDIR/subs.json"

echo "Fetching Tatum subscriptions..."
PAGE_SIZE=50
echo "[]" > "$SUBS_JSON"
offset=0
while true; do
  page=$(curl -s -X GET "${BASE_URL}/subscription?pageSize=${PAGE_SIZE}&offset=${offset}" -H "x-api-key: ${TATUM_API_KEY}")
  if ! echo "$page" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "ERROR: unexpected response from Tatum at offset $offset:" >&2
    echo "$page" >&2
    exit 1
  fi
  n=$(echo "$page" | jq 'length')
  jq -s '.[0] + .[1]' "$SUBS_JSON" <(echo "$page") > "$SUBS_JSON.tmp" && mv "$SUBS_JSON.tmp" "$SUBS_JSON"
  [[ "$n" -lt "$PAGE_SIZE" ]] && break
  offset=$((offset + PAGE_SIZE))
done

echo "Scanning $TABLE for accounts with a KMS key..."
scan=$(aws dynamodb scan --region "$REGION" --table-name "$TABLE" \
  --filter-expression 'begins_with(sk, :account) AND attribute_exists(kmsKeyId)' \
  --expression-attribute-values '{":account":{"S":"ACCOUNT#"}}' --output json 2>&1)
if [[ $? -ne 0 ]]; then
  echo "ERROR scanning $TABLE: $scan" >&2
  exit 1
fi

declare -a ELIGIBLE=()   # userId|accountNo|chain|kmsKeyId|depositAddress|vAccountId|addressAttached|subIds(comma)
skipped=0
blocked=0
left=0

# `|` keeps empty fields in place, which a tab would not
while IFS='|' read -r userId accountNo chain kmsKeyId depositAddress vAccountId; do
  [[ -z "$userId" ]] && continue

  if [[ ! "$kmsKeyId" =~ $UUID_RE || -z "$vAccountId" || -z "$depositAddress" || -z "$accountNo" ]]; then
    echo "  LEFT ALONE  user=$userId account=${accountNo:-?} — not a custodial KMS account (kmsKeyId=$kmsKeyId)"
    left=$((left + 1))
    continue
  fi

  hard=()   # never overridden
  soft=()   # overridden by FORCE_NONZERO_BALANCE=1

  resp=$(case "$chain" in
    TRON|*_TRON) curl -s -w '\n%{http_code}' "${BASE_URL}/tron/account/${depositAddress}" -H "x-api-key: ${TATUM_API_KEY}" ;;
    SOL) curl -s -w '\n%{http_code}' "${BASE_URL}/solana/account/balance/${depositAddress}" -H "x-api-key: ${TATUM_API_KEY}" ;;
  esac)
  httpStatus="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  if [[ -z "$resp" ]]; then
    onchain="UNKNOWN chain=$chain"
    soft+=("unknown chain '$chain' — can't check the on-chain balance")
  elif [[ "$httpStatus" != "200" ]]; then
    onchain="UNVERIFIED (HTTP $httpStatus)"
    soft+=("could not read the on-chain balance")
  elif [[ "$chain" == "SOL" ]]; then
    onchain="SOL=$(echo "$body" | jq -r '.balance // "0"' 2>/dev/null)"
    nonzero=$(echo "$body" | jq '((.balance // "0") | tonumber) != 0' 2>/dev/null)
  else
    onchain="TRX(sun)=$(echo "$body" | jq -r '.balance // 0' 2>/dev/null) trc20=$(echo "$body" | jq -c '.trc20 // []' 2>/dev/null)"
    # A trc20 entry is {<contract>: <balance>}; {contractAddress, balance} is accepted too
    nonzero=$(echo "$body" | jq '((.balance // 0) != 0) or ([.trc20[]? | (if has("balance") then .balance else (to_entries[] | .value) end) | tonumber] | any(. != 0))' 2>/dev/null)
  fi
  # Anything but a clear "no coins here" counts against the account
  if [[ -n "$resp" && "$httpStatus" == "200" ]]; then
    if [[ "$nonzero" == "true" ]]; then
      soft+=("nonzero on-chain balance")
    elif [[ "$nonzero" != "false" ]]; then
      soft+=("could not read the on-chain balance")
    fi
  fi

  balItem=$(aws dynamodb get-item --region "$REGION" --table-name "$BALANCE_TABLE" \
    --key "{\"id\":{\"S\":\"$vAccountId\"}}" --output json 2>&1)
  if [[ $? -ne 0 ]]; then
    appBalance="unreadable"
    soft+=("could not read the app balance")
  else
    avail=$(echo "$balItem" | jq -r '.Item.availableBalance.N // "0"' 2>/dev/null)
    bal=$(echo "$balItem" | jq -r '.Item.balance.N // "0"' 2>/dev/null)
    appBalance="balance=$bal availableBalance=$avail"
    appNonzero=$(jq -n --arg a "$avail" --arg b "$bal" '(($a|tonumber) != 0) or (($b|tonumber) != 0)' 2>/dev/null)
    if [[ "$appNonzero" == "true" ]]; then
      soft+=("nonzero app balance")
    elif [[ "$appNonzero" != "false" ]]; then
      soft+=("could not read the app balance")
    fi
  fi

  subIds=$(jq -r --arg addr "$depositAddress" '[.[] | select(.attr.address == $addr) | .id] | join(",")' "$SUBS_JSON")

  addrList=$(curl -s -X GET "${BASE_URL}/offchain/account/${vAccountId}/address" -H "x-api-key: ${TATUM_API_KEY}")
  addressAttached=0
  echo "$addrList" | jq -e --arg addr "$depositAddress" 'type == "array" and any(.[]; .address == $addr)' >/dev/null 2>&1 && addressAttached=1

  meta=$(aws kms describe-key --region "$REGION" --key-id "$kmsKeyId" --output json 2>&1)
  if [[ $? -ne 0 ]]; then
    kmsState="describe-key failed"
    hard+=("could not describe its KMS key")
  else
    keyState=$(echo "$meta" | jq -r '.KeyMetadata.KeyState')
    tags=$(aws kms list-resource-tags --region "$REGION" --key-id "$kmsKeyId" --output json 2>/dev/null)
    tagAccount=$(echo "$tags" | jq -r '.Tags[]? | select(.TagKey=="accountId") | .TagValue')
    tagService=$(echo "$tags" | jq -r '.Tags[]? | select(.TagKey=="service") | .TagValue')
    kmsState="state=$keyState service=$tagService accountId=$tagAccount"
    [[ "$tagService" != "loudibly" || "$tagAccount" != "$accountNo" ]] && hard+=("its KMS key's tags don't match this account")
  fi

  echo ""
  echo "  account=$accountNo  user=$userId  chain=$chain"
  echo "    depositAddress=$depositAddress  on-chain: $onchain"
  echo "    vAccountId=$vAccountId  app: $appBalance  address attached to VA: $([[ $addressAttached -eq 1 ]] && echo yes || echo no)"
  echo "    subscriptions: ${subIds:-none}"
  echo "    kmsKeyId=$kmsKeyId  $kmsState"

  if [[ ${#hard[@]} -gt 0 ]]; then
    for b in "${hard[@]}"; do echo "    BLOCKED: $b"; done
    blocked=$((blocked + 1))
    continue
  fi
  if [[ ${#soft[@]} -gt 0 && "$FORCE_NONZERO" != "1" ]]; then
    for b in "${soft[@]}"; do echo "    SKIPPED: $b (FORCE_NONZERO_BALANCE=1 to retire it anyway)"; done
    skipped=$((skipped + 1))
    continue
  fi
  for b in "${soft[@]}"; do echo "    OVERRIDDEN by FORCE_NONZERO_BALANCE: $b"; done
  echo "    -> RETIRE"
  ELIGIBLE+=("$userId|$accountNo|$chain|$kmsKeyId|$depositAddress|$vAccountId|$addressAttached|$subIds")
done < <(echo "$scan" | jq -r '.Items[]? | [(.id.S // ""), (.accountNo.S // ""), (.chain.S // ""), (.kmsKeyId.S // ""), (.depositAddress.S // ""), (.vAccountId.S // "")] | join("|")')

echo ""
echo "Accounts: ${#ELIGIBLE[@]} to retire, $skipped skipped for a balance, $blocked blocked, $left left alone."

if [[ $COMMIT -eq 1 && ${#ELIGIBLE[@]} -gt 0 ]]; then
  echo ""
  read -r -p "Type DELETE to retire the ${#ELIGIBLE[@]} account(s) marked RETIRE above: " confirm
  if [[ "$confirm" != "DELETE" ]]; then
    echo "Aborted — nothing was touched."
    exit 0
  fi

  for e in "${ELIGIBLE[@]}"; do
    IFS='|' read -r userId accountNo chain kmsKeyId depositAddress vAccountId addressAttached subIds <<< "$e"
    echo ""
    echo "Retiring account=$accountNo ($chain)..."
    tatumOk=1

    IFS=',' read -r -a subs <<< "$subIds"
    for s in "${subs[@]}"; do
      [[ -z "$s" ]] && continue
      status=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${BASE_URL}/subscription/${s}" -H "x-api-key: ${TATUM_API_KEY}")
      if [[ "$status" == "200" || "$status" == "204" ]]; then
        echo "  Deleted Tatum subscription $s"
      else
        echo "  FAILED ($status) deleting Tatum subscription $s" >&2
        tatumOk=0
      fi
    done

    if [[ "$addressAttached" == "1" ]]; then
      status=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${BASE_URL}/offchain/account/${vAccountId}/address/${depositAddress}" -H "x-api-key: ${TATUM_API_KEY}")
      if [[ "$status" == "200" || "$status" == "204" ]]; then
        echo "  Removed deposit address $depositAddress from VA $vAccountId"
      else
        echo "  FAILED ($status) removing deposit address $depositAddress from VA $vAccountId" >&2
        tatumOk=0
      fi
    fi

    if [[ $tatumOk -eq 0 ]]; then
      echo "  LEFT IN PLACE: its rows and key are untouched — fix the above and re-run" >&2
      continue
    fi

    err=$(aws dynamodb delete-item --region "$REGION" --table-name "$BALANCE_TABLE" \
      --key "{\"id\":{\"S\":\"$vAccountId\"}}" 2>&1 >/dev/null)
    [[ $? -eq 0 ]] && echo "  Deleted $BALANCE_TABLE row id=$vAccountId" || echo "  FAILED deleting $BALANCE_TABLE row id=$vAccountId: $err" >&2

    err=$(aws dynamodb delete-item --region "$REGION" --table-name "$TABLE" \
      --key "{\"id\":{\"S\":\"$userId\"},\"sk\":{\"S\":\"ACCOUNT#$accountNo\"}}" 2>&1 >/dev/null)
    if [[ $? -ne 0 ]]; then
      echo "  FAILED deleting $TABLE row sk=ACCOUNT#$accountNo: $err — its key is left alone" >&2
      continue
    fi
    echo "  Deleted $TABLE row id=$userId sk=ACCOUNT#$accountNo"

    err=$(aws kms schedule-key-deletion --region "$REGION" --key-id "$kmsKeyId" --pending-window-in-days "$PENDING_WINDOW_DAYS" 2>&1 >/dev/null)
    [[ $? -eq 0 ]] \
      && echo "  Scheduled KMS deletion: $kmsKeyId (cancel within ${PENDING_WINDOW_DAYS}d: aws kms cancel-key-deletion --region $REGION --key-id $kmsKeyId)" \
      || echo "  FAILED scheduling KMS deletion for $kmsKeyId: $err" >&2
  done
fi

echo ""
echo "Scanning $MERCHANT_TABLE for masters with a KMS key..."
masters=$(aws dynamodb scan --region "$REGION" --table-name "$MERCHANT_TABLE" \
  --filter-expression 'begins_with(sk, :master) AND attribute_exists(kmsKeyId)' \
  --expression-attribute-values '{":master":{"S":"MASTER#"}}' --output json 2>&1)
if [[ $? -ne 0 ]]; then
  echo "ERROR scanning $MERCHANT_TABLE: $masters" >&2
  exit 1
fi
mapfile -t MASTERS < <(echo "$masters" | jq -r '.Items[]? | "\(.id.S)|\(.sk.S | sub("^MASTER#"; ""))"')
echo "Masters: ${#MASTERS[@]} still on a KMS key."

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MASTER_SCRIPT=""
for candidate in "$here/delete-merchant-master.sh" "$here/../cleanup/delete-merchant-master.sh"; do
  [[ -f "$candidate" ]] && MASTER_SCRIPT="$candidate" && break
done

for m in "${MASTERS[@]}"; do
  IFS='|' read -r merchantId currency <<< "$m"
  if [[ -z "$MASTER_SCRIPT" ]]; then
    echo "  bash delete-merchant-master.sh $merchantId $currency --commit"
    continue
  fi
  echo ""
  echo "=== master $merchantId $currency ==="
  if [[ $COMMIT -eq 1 ]]; then
    TATUM_API_KEY="$TATUM_API_KEY" bash "$MASTER_SCRIPT" "$merchantId" "$currency" --commit
  else
    TATUM_API_KEY="$TATUM_API_KEY" bash "$MASTER_SCRIPT" "$merchantId" "$currency"
  fi
done
[[ -z "$MASTER_SCRIPT" && ${#MASTERS[@]} -gt 0 ]] && echo "delete-merchant-master.sh isn't next to this script — run the commands above yourself."

if [[ $COMMIT -eq 0 ]]; then
  echo ""
  echo "Dry run only — nothing was touched. Re-run with --commit after reviewing the above."
fi
