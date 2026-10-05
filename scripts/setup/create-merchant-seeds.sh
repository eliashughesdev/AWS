#!/usr/bin/env bash
# Paste into AWS CloudShell and run it.
#
# Gives every registered merchant, and the `loudibly` system merchant, a seed for each
# network (B31 step 4). New merchants get theirs at /merchants/register; this covers the
# ones registered before that and finishes any seed left half-created.
#
# It only asks the hdAddressFn Lambda to create seeds. It never sees one: a seed is
# generated and stored inside that function. Each new seed creates one KMS key (about
# $1 a month).
#
# Dry run by default; creates only with --commit. Safe to re-run: a seed that exists is
# left alone.
#
# Usage:
#   bash create-merchant-seeds.sh            # dry run
#   bash create-merchant-seeds.sh --commit

set -uo pipefail

REGION="${AWS_REGION:-us-east-2}"
# Must match SYSTEM_MERCHANT_ID in amplify/utils/merchant.ts
SYSTEM_MERCHANT="loudibly"
# Must match NETWORKS in amplify/utils/currencies.ts
NETWORKS=(TRON SOL)
COMMIT=0
[[ "${1:-}" == "--commit" ]] && COMMIT=1

[[ $COMMIT -eq 1 ]] && echo "MODE: commit" || echo "MODE: dry run (pass --commit to write)"

# ready | provisioning | none
seed_status() {
  local key status
  key=$(jq -nc --arg id "$1" --arg sk "SEED#$2" '{id:{S:$id},sk:{S:$sk}}')
  status=$(aws dynamodb get-item --region "$REGION" --table-name v1MerchantTable \
    --key "$key" --query 'Item.status.S' --output text)
  [[ "$status" == "None" ]] && echo none || echo "$status"
}

merchants=$(aws dynamodb scan --region "$REGION" --table-name v1MerchantTable \
  --filter-expression 'sk = :profile' --expression-attribute-values '{":profile":{"S":"PROFILE"}}' \
  --projection-expression '#id' --expression-attribute-names '{"#id":"id"}' \
  --query 'Items[].id.S' --output text)

failed=0
for merchant in $(printf '%s\n' $merchants "$SYSTEM_MERCHANT" | sort -u); do
  for network in "${NETWORKS[@]}"; do
    status=$(seed_status "$merchant" "$network")
    if [[ "$status" == "ready" ]]; then
      echo "  ok      $merchant $network"
      continue
    fi
    echo "  create  $merchant $network (now: $status)"
    [[ $COMMIT -eq 1 ]] || continue

    payload=$(jq -nc --arg m "$merchant" --arg n "$network" '{op:"createSeed",merchantId:$m,network:$n}')
    out=$(mktemp)
    error=$(aws lambda invoke --region "$REGION" --function-name hdAddressFn \
      --cli-binary-format raw-in-base64-out --payload "$payload" "$out" \
      --query 'FunctionError' --output text)
    if [[ "$error" == "None" ]]; then
      echo "          $(cat "$out")"
    else
      echo "          FAILED: $(cat "$out")" >&2
      failed=1
    fi
    rm -f "$out"
  done
done

exit $failed
