#!/usr/bin/env bash
# Run in AWS CloudShell, or locally with AWS_PROFILE and AWS_REGION set.
#
# Gives the public API (loudiblyPublicApi) the api. domain the API docs name, and the internal
# API (loudiblyRestApi: the web apps, staff tools and provider webhooks) app-api. instead:
#
#   staging (129364817855)     api.staging.loudibly.com   app-api.staging.loudibly.com
#   production (471112580718)  api.noda.money             app-api.noda.money
#
# Both are edge-optimized domains (their certificate in us-east-1, like the ones made before)
# with the base path v1 mapped to the stage v1, so a path is the same as on execute-api and an
# HMAC caller signs it the same way. DNS for both zones is on Cloudflare: this script prints
# each record to add there (CNAME, DNS only) and adds none.
#
# Two steps, in this order:
#
#   internal  Finds or requests the certificate for app-api., creates the domain and maps it to
#             loudiblyRestApi. A certificate it requested is validated by a CNAME it prints; run
#             the step again once ACM says ISSUED.
#   public    Moves api.'s v1 mapping from loudiblyRestApi to loudiblyPublicApi. It refuses while
#             anything still calls the internal API at api.: app-api. not answering, SSM's
#             TATUM_WEBHOOK_URL, a Tatum subscription (repoint-tatum-webhooks.sh moves them) or
#             an Amplify branch's VITE_API_BASE. FORCE=1 skips the refusal, not the report.
#             Didit's and Stripe's webhook URLs live in their dashboards and cannot be read from
#             here: check them by hand first.
#
# CloudFront takes a few minutes to serve a changed mapping.
#
# Usage:
#   bash api-domains.sh internal            # dry run: what it would do
#   bash api-domains.sh internal --commit
#   bash api-domains.sh public              # dry run, with every check
#   bash api-domains.sh public --commit

set -uo pipefail

STEP="${1:-}"
COMMIT=0
[[ "${2:-}" == "--commit" ]] && COMMIT=1
[[ "$STEP" == "internal" || "$STEP" == "public" ]] || { sed -n '2,32p' "$0"; exit 1; }
[[ $COMMIT -eq 1 ]] && echo "MODE: commit" || echo "MODE: dry run (pass --commit to write)"

REGION="${AWS_REGION:-}"
[[ -n "$REGION" ]] || { echo "ERROR: set AWS_REGION (us-east-2 staging, eu-west-3 production)." >&2; exit 1; }

ACCOUNT=$(aws sts get-caller-identity --query Account --output text) || exit 1
case "$ACCOUNT" in
  129364817855) ZONE="staging.loudibly.com" ;;
  471112580718) ZONE="noda.money" ;;
  *) echo "ERROR: account $ACCOUNT has no domains here; add it to the case above." >&2; exit 1 ;;
esac
PUBLIC_DOMAIN="api.$ZONE"
INTERNAL_DOMAIN="app-api.$ZONE"
echo "Account $ACCOUNT, $REGION: public $PUBLIC_DOMAIN, internal $INTERNAL_DOMAIN"

apiId() {
  aws apigateway get-rest-apis --region "$REGION" --limit 500 \
    --query "items[?name=='$1'].id | [0]" --output text
}
INTERNAL_API=$(apiId loudiblyRestApi)
PUBLIC_API=$(apiId loudiblyPublicApi)
[[ "$INTERNAL_API" != "None" && "$PUBLIC_API" != "None" ]] || { echo "ERROR: loudiblyRestApi or loudiblyPublicApi not found in $REGION." >&2; exit 1; }
echo "loudiblyRestApi $INTERNAL_API, loudiblyPublicApi $PUBLIC_API"

mappedApi() {
  aws apigateway get-base-path-mappings --region "$REGION" --domain-name "$1" \
    --query "items[?basePath=='v1'].restApiId | [0]" --output text 2>/dev/null
}

# An issued us-east-1 certificate naming the domain itself or *.<its parent>.
findCert() {
  local domain="$1" wildcard="*.${1#*.}" arn names
  for arn in $(aws acm list-certificates --region us-east-1 --certificate-statuses ISSUED \
      --query 'CertificateSummaryList[].CertificateArn' --output text); do
    names=$(aws acm describe-certificate --region us-east-1 --certificate-arn "$arn" \
      --query 'Certificate.SubjectAlternativeNames' --output text)
    for name in $names; do
      if [[ "$name" == "$domain" || "$name" == "$wildcard" ]]; then echo "$arn"; return; fi
    done
  done
}

printCname() {
  local target
  target=$(aws apigateway get-domain-name --region "$REGION" --domain-name "$1" \
    --query distributionDomainName --output text)
  echo "  Cloudflare: CNAME $1 -> $target (DNS only, not proxied)"
}

# What a request to the domain answers: an HTTP status, or 000 when it does not resolve or connect.
# Resolved through 1.1.1.1 when dig is there: a local cache keeps a "no such name" from before the
# CNAME was added for a while.
answers() {
  local ip=""
  command -v dig >/dev/null && ip=$(dig @1.1.1.1 +short "$1" A | grep -E '^[0-9.]+$' | tail -1)
  curl -s -o /dev/null -m 15 -w '%{http_code}' ${ip:+--resolve "$1:443:$ip"} "https://$1/v1/accounts/list"
}

if [[ "$STEP" == "internal" ]]; then
  echo
  echo "== $INTERNAL_DOMAIN -> loudiblyRestApi"
  if aws apigateway get-domain-name --region "$REGION" --domain-name "$INTERNAL_DOMAIN" >/dev/null 2>&1; then
    echo "  Domain exists."
  else
    CERT=$(findCert "$INTERNAL_DOMAIN")
    if [[ -z "$CERT" ]]; then
      PENDING=$(aws acm list-certificates --region us-east-1 --certificate-statuses PENDING_VALIDATION \
        --query "CertificateSummaryList[?DomainName=='$INTERNAL_DOMAIN'].CertificateArn | [0]" --output text)
      if [[ "$PENDING" == "None" ]]; then
        echo "  No certificate covers it."
        if [[ $COMMIT -eq 0 ]]; then
          echo "  Would request one in us-east-1 (DNS validation)."
          exit 0
        fi
        PENDING=$(aws acm request-certificate --region us-east-1 --domain-name "$INTERNAL_DOMAIN" \
          --validation-method DNS --query CertificateArn --output text) || exit 1
        echo "  Requested $PENDING"
        sleep 10
      fi
      echo "  Certificate $PENDING waits for validation. Add in Cloudflare (DNS only):"
      aws acm describe-certificate --region us-east-1 --certificate-arn "$PENDING" \
        --query 'Certificate.DomainValidationOptions[].ResourceRecord.[Type,Name,Value]' --output text \
        | while read -r type name value; do echo "    $type $name -> $value"; done
      echo "  Run this step again once it is ISSUED."
      exit 0
    fi
    echo "  Certificate $CERT"
    if [[ $COMMIT -eq 0 ]]; then
      echo "  Would create the edge domain (TLS 1.2) and map v1 to $INTERNAL_API stage v1."
      exit 0
    fi
    aws apigateway create-domain-name --region "$REGION" --domain-name "$INTERNAL_DOMAIN" \
      --certificate-arn "$CERT" --endpoint-configuration types=EDGE --security-policy TLS_1_2 >/dev/null || exit 1
    echo "  Created."
  fi

  MAPPED=$(mappedApi "$INTERNAL_DOMAIN")
  if [[ "$MAPPED" == "$INTERNAL_API" ]]; then
    echo "  v1 is mapped to loudiblyRestApi."
  elif [[ "$MAPPED" == "None" ]]; then
    if [[ $COMMIT -eq 1 ]]; then
      aws apigateway create-base-path-mapping --region "$REGION" --domain-name "$INTERNAL_DOMAIN" \
        --base-path v1 --rest-api-id "$INTERNAL_API" --stage v1 >/dev/null || exit 1
      echo "  Mapped v1 to loudiblyRestApi."
    else
      echo "  Would map v1 to loudiblyRestApi."
    fi
  else
    echo "ERROR: v1 on $INTERNAL_DOMAIN is mapped to $MAPPED, not loudiblyRestApi. Fix it by hand." >&2
    exit 1
  fi
  printCname "$INTERNAL_DOMAIN"
  echo "  Answers: $(answers "$INTERNAL_DOMAIN") (000 until the CNAME is in and CloudFront has it; 401 or 403 means it is the API)"
  exit 0
fi

# public
echo
echo "== Who still calls the internal API at $PUBLIC_DOMAIN"
PROBLEMS=0
problem() { echo "  BLOCKS: $1"; PROBLEMS=$((PROBLEMS + 1)); }
fine() { echo "  ok: $1"; }

CODE=$(answers "$INTERNAL_DOMAIN")
[[ "$CODE" == "401" || "$CODE" == "403" ]] && fine "$INTERNAL_DOMAIN answers $CODE" \
  || problem "$INTERNAL_DOMAIN answers $CODE (run the internal step and add its CNAME)"

TATUM_URL=$(aws ssm get-parameter --region "$REGION" --name /loudibly/api/TATUM_WEBHOOK_URL \
  --query Parameter.Value --output text 2>/dev/null)
[[ "$TATUM_URL" == *"//$PUBLIC_DOMAIN/"* ]] && problem "SSM TATUM_WEBHOOK_URL is $TATUM_URL" \
  || fine "SSM TATUM_WEBHOOK_URL is $TATUM_URL"

TATUM_API_KEY="${TATUM_API_KEY:-$(aws ssm get-parameter --region "$REGION" --name /loudibly/api/TATUM_API_KEY \
  --with-decryption --query Parameter.Value --output text 2>/dev/null)}"
if [[ -z "$TATUM_API_KEY" || "$TATUM_API_KEY" == "None" ]]; then
  problem "no Tatum key in TATUM_API_KEY or SSM, so its subscriptions could not be read"
else
  OLD_SUBS=0 offset=0
  while true; do
    page=$(curl -s "https://api.tatum.io/v3/subscription?pageSize=50&offset=$offset" -H "x-api-key: $TATUM_API_KEY")
    OLD_SUBS=$((OLD_SUBS + $(echo "$page" | jq --arg d "//$PUBLIC_DOMAIN/" '[.[] | select((.attr.url // "") | contains($d))] | length')))
    [[ $(echo "$page" | jq length) -lt 50 ]] && break
    offset=$((offset + 50))
  done
  [[ $OLD_SUBS -gt 0 ]] && problem "$OLD_SUBS Tatum subscription(s) send to $PUBLIC_DOMAIN (repoint-tatum-webhooks.sh)" \
    || fine "no Tatum subscription sends to $PUBLIC_DOMAIN"
fi

BRANCHES=0
for app in $(aws amplify list-apps --region "$REGION" --query 'apps[].appId' --output text); do
  for branch in $(aws amplify list-branches --region "$REGION" --app-id "$app" --query 'branches[].branchName' --output text); do
    base=$(aws amplify get-branch --region "$REGION" --app-id "$app" --branch-name "$branch" \
      --query 'branch.environmentVariables.VITE_API_BASE' --output text)
    [[ "$base" == "None" ]] && base=$(aws amplify get-app --region "$REGION" --app-id "$app" \
      --query 'app.environmentVariables.VITE_API_BASE' --output text)
    [[ "$base" == *"//$PUBLIC_DOMAIN"* ]] && { BRANCHES=$((BRANCHES + 1)); problem "Amplify $app/$branch VITE_API_BASE is $base (change it and rebuild the branch)"; }
  done
done
[[ $BRANCHES -eq 0 ]] && fine "no Amplify branch's VITE_API_BASE uses $PUBLIC_DOMAIN"
echo "  by hand: Didit's and Stripe's webhook URLs must not use $PUBLIC_DOMAIN"

echo
echo "== $PUBLIC_DOMAIN -> loudiblyPublicApi"
MAPPED=$(mappedApi "$PUBLIC_DOMAIN")
if [[ "$MAPPED" == "$PUBLIC_API" ]]; then
  echo "  v1 is already mapped to loudiblyPublicApi."
  exit 0
fi
echo "  v1 is mapped to ${MAPPED/None/nothing}."
if [[ $PROBLEMS -gt 0 && "${FORCE:-0}" != "1" ]]; then
  echo "  Not moved: $PROBLEMS check(s) above block it (FORCE=1 to move anyway)."
  exit 1
fi
if [[ $COMMIT -eq 0 ]]; then
  echo "  Would map v1 to loudiblyPublicApi."
  exit 0
fi
if [[ "$MAPPED" == "None" ]]; then
  aws apigateway create-base-path-mapping --region "$REGION" --domain-name "$PUBLIC_DOMAIN" \
    --base-path v1 --rest-api-id "$PUBLIC_API" --stage v1 >/dev/null || exit 1
else
  aws apigateway update-base-path-mapping --region "$REGION" --domain-name "$PUBLIC_DOMAIN" --base-path v1 \
    --patch-operations "op=replace,path=/restapiId,value=$PUBLIC_API" >/dev/null || exit 1
fi
echo "  Mapped v1 to loudiblyPublicApi. To undo: the same update with value=$INTERNAL_API."
