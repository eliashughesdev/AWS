#!/usr/bin/env bash
# Run in AWS CloudShell, or locally with AWS_PROFILE and AWS_REGION set.
#
# Moves Tatum's deposit webhooks from one host to another, e.g. api.noda.money to
# app-api.noda.money before api-domains.sh gives api. to the public API (which has no
# /webhook/* and would answer 404, so deposits would go uncredited).
#
#   1. SSM /loudibly/api/TATUM_WEBHOOK_URL, which new accounts' subscriptions are made with,
#      gets the new host when it has the old one.
#   2. Every subscription whose attr.url has the old host is made again with the new one: a
#      subscription's URL cannot be changed, and Tatum refuses a second one on the same address
#      and currency (403 subscription.exists.on.address-and-currency), so the old one is deleted
#      first. That leaves about a second in which a deposit's webhook is not sent. Nothing in
#      DynamoDB names a subscription, so nothing else changes.
#
# The Tatum key comes from TATUM_API_KEY if exported, else SSM /loudibly/api/TATUM_API_KEY.
#
# Usage:
#   bash repoint-tatum-webhooks.sh api.noda.money app-api.noda.money            # dry run
#   bash repoint-tatum-webhooks.sh api.noda.money app-api.noda.money --commit

set -uo pipefail

OLD_HOST="${1:-}"
NEW_HOST="${2:-}"
COMMIT=0
[[ "${3:-}" == "--commit" ]] && COMMIT=1
[[ -n "$OLD_HOST" && -n "$NEW_HOST" ]] || { sed -n '2,21p' "$0"; exit 1; }
[[ $COMMIT -eq 1 ]] && echo "MODE: commit" || echo "MODE: dry run (pass --commit to write)"

BASE_URL="${TATUM_BASE_URL:-https://api.tatum.io/v3}"
REGION="${AWS_REGION:-}"
[[ -n "$REGION" ]] || { echo "ERROR: set AWS_REGION (us-east-2 staging, eu-west-3 production)." >&2; exit 1; }

if [[ -z "${TATUM_API_KEY:-}" ]]; then
  TATUM_API_KEY=$(aws ssm get-parameter --region "$REGION" --name /loudibly/api/TATUM_API_KEY \
    --with-decryption --query Parameter.Value --output text 2>/dev/null)
fi
[[ -n "${TATUM_API_KEY:-}" && "$TATUM_API_KEY" != "None" ]] || { echo "ERROR: no Tatum key in env or SSM." >&2; exit 1; }

# The URL with //<old host>/ swapped for //<new host>/, the rest as it was.
rehost() {
  jq -rn --arg url "$1" --arg old "//$OLD_HOST/" --arg new "//$NEW_HOST/" '$url | split($old) | join($new)'
}

echo
echo "== SSM TATUM_WEBHOOK_URL"
CURRENT=$(aws ssm get-parameter --region "$REGION" --name /loudibly/api/TATUM_WEBHOOK_URL --query Parameter.Value --output text) || exit 1
if [[ "$CURRENT" == *"//$OLD_HOST/"* ]]; then
  NEXT=$(rehost "$CURRENT")
  echo "  $CURRENT -> $NEXT"
  if [[ $COMMIT -eq 1 ]]; then
    aws ssm put-parameter --region "$REGION" --name /loudibly/api/TATUM_WEBHOOK_URL --value "$NEXT" --overwrite >/dev/null || exit 1
    echo "  Written. A warm Lambda reads it within a minute."
  fi
else
  echo "  $CURRENT (unchanged)"
fi

echo
echo "== Subscriptions sending to $OLD_HOST"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
echo "[]" > "$WORKDIR/subs.json"
offset=0
while true; do
  page=$(curl -s "${BASE_URL}/subscription?pageSize=50&offset=${offset}" -H "x-api-key: ${TATUM_API_KEY}")
  echo "$page" | jq -e 'type == "array"' >/dev/null || { echo "ERROR: Tatum answered $page" >&2; exit 1; }
  jq -s '.[0] + .[1]' "$WORKDIR/subs.json" <(echo "$page") > "$WORKDIR/next.json" && mv "$WORKDIR/next.json" "$WORKDIR/subs.json"
  [[ $(echo "$page" | jq length) -lt 50 ]] && break
  offset=$((offset + 50))
done

jq -c --arg d "//$OLD_HOST/" '.[] | select((.attr.url // "") | contains($d))' "$WORKDIR/subs.json" > "$WORKDIR/old.jsonl"
TOTAL=$(wc -l < "$WORKDIR/old.jsonl" | tr -d ' ')
echo "  $TOTAL of $(jq length "$WORKDIR/subs.json")"

MOVED=0 FAILED=0
create() {
  curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/subscription" -H "x-api-key: ${TATUM_API_KEY}" \
    -H 'Content-Type: application/json' -d "$1"
}
remove() {
  curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE_URL}/subscription/$1" -H "x-api-key: ${TATUM_API_KEY}"
}

while read -r sub; do
  [[ -z "$sub" ]] && continue
  id=$(echo "$sub" | jq -r .id)
  url=$(echo "$sub" | jq -r .attr.url)
  newUrl=$(rehost "$url")
  body=$(echo "$sub" | jq -c --arg u "$newUrl" '{type, attr: (.attr + {url: $u})}')
  echo "  $id $(echo "$sub" | jq -r '[.type, .attr.chain, .attr.address] | join(" ")')"
  echo "    -> $newUrl"
  [[ $COMMIT -eq 0 ]] && continue

  gone=$(remove "$id")
  if [[ ! "$gone" =~ ^2 ]]; then
    echo "    delete answered $gone: left as it was"
    FAILED=$((FAILED + 1))
    continue
  fi
  out=$(create "$body"); code=$(echo "$out" | tail -n1); resp=$(echo "$out" | sed '$d')
  if [[ "$code" =~ ^2 ]]; then
    echo "    deleted $id, created $(echo "$resp" | jq -r .id)"
    MOVED=$((MOVED + 1))
  else
    echo "    CRITICAL: $id is deleted and its replacement answered $code: $resp"
    echo "    create it by hand: POST ${BASE_URL}/subscription $body"
    FAILED=$((FAILED + 1))
  fi
done < "$WORKDIR/old.jsonl"

echo
[[ $COMMIT -eq 1 ]] && echo "Moved $MOVED, failed $FAILED, of $TOTAL." || echo "Would move $TOTAL."
[[ $FAILED -eq 0 ]]
