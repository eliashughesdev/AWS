#!/usr/bin/env bash
# CloudWatch log helper for the Loudibly backend, scoped to the AWS account mapped to a git branch.
#
#   logs.sh env                          # show resolved branch -> account/region/profile and verify credentials
#   logs.sh groups                       # list this stack's log groups with last event time
#   logs.sh errors [since] [limit]       # Logs Insights: error lines across all stack log groups (default 1h, 100)
#   logs.sh query <since> '<insights>' [group-filter]   # custom Logs Insights query
#   logs.sh tail <group-filter> [since]  # raw recent events from groups whose name contains <group-filter>
#   logs.sh request <requestId> [since]  # every line for one Lambda/API Gateway request id
#   logs.sh deployed                     # recent Amplify deploy jobs for the branch (commit, status, time)
#
# `since` is a duration like 15m, 2h, 1d. Branch defaults to the current git branch; override with BRANCH=<name>.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="${BRANCH:-$(git -C "$DIR" rev-parse --abbrev-ref HEAD)}"

ENV_LINE=$(awk -v b="$BRANCH" '$1 == b { print $2, $3, $4, $5 }' "$DIR/environments.tsv")
if [[ -z "$ENV_LINE" ]]; then
  echo "No AWS environment mapped for branch '$BRANCH' in $DIR/environments.tsv. Known branches:" >&2
  awk '!/^#/ && NF { print "  " $1 }' "$DIR/environments.tsv" >&2
  exit 2
fi
read -r ACCOUNT REGION PROFILE APP_ID <<< "$ENV_LINE"

aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

verify_account() {
  local actual
  actual="$(aws_ sts get-caller-identity --query Account --output text 2>&1)" || {
    echo "Credentials for profile '$PROFILE' failed: $actual" >&2; exit 3; }
  if [[ "$actual" != "$ACCOUNT" ]]; then
    echo "Profile '$PROFILE' is account $actual, but branch '$BRANCH' expects $ACCOUNT. Refusing to continue." >&2
    exit 3
  fi
}

to_seconds() {
  local v="${1%[smhd]}" u="${1: -1}"
  case "$u" in s) echo "$v" ;; m) echo $((v * 60)) ;; h) echo $((v * 3600)) ;; d) echo $((v * 86400)) ;; *) echo $(($1 * 60)) ;; esac
}

# Log groups belonging to this backend: Amplify-managed lambdas for this app, the CDK-named
# lambdas from amplify/backend.ts, and API Gateway access/execution logs.
stack_groups() {
  local filter="${1:-}"
  aws_ logs describe-log-groups --query 'logGroups[].logGroupName' --output text | tr '\t' '\n' |
    grep -E "^/aws/lambda/amplify-${APP_ID}-|^/aws/lambda/(custom-authorizer-fn|sqsV1WebhookProcessorFn|sqsV1GeneralProcessorFn|streamTopicHandlerFn|wsConnectHandlerFn|wsDisconnectHandlerFn)$|^/aws/apigateway/Loudibly(Rest|Public)Api$|^API-Gateway-Execution-Logs_" |
    grep -vE 'BranchLinker|BucketDeploy|S3AutoDeleteObject|TableManagerCustomProvid' |
    { if [[ -n "$filter" ]]; then grep -i -- "$filter"; else cat; fi; } || true
}

run_insights() {
  local since="$1" q="$2" filter="${3:-}" groups start qid status
  groups=$(stack_groups "$filter")
  [[ -z "$groups" ]] && { echo "No log groups match '${filter}'." >&2; exit 4; }
  start=$(( $(date +%s) - $(to_seconds "$since") ))
  # shellcheck disable=SC2086
  qid=$(aws_ logs start-query --log-group-names $groups --start-time "$start" --end-time "$(date +%s)" \
    --query-string "$q" --query queryId --output text)
  for _ in $(seq 1 60); do
    status=$(aws_ logs get-query-results --query-id "$qid" --query status --output text)
    [[ "$status" == Complete || "$status" == Failed || "$status" == Cancelled ]] && break
    sleep 1
  done
  [[ "$status" != Complete ]] && { echo "Query $qid ended with status $status" >&2; exit 5; }
  # One result row per block: field=value pairs, tab-separated (multi-line messages keep their newlines).
  aws_ logs get-query-results --query-id "$qid" --output text \
    --query "results[*][?field!='@ptr'].join('=', [field, value])" | sed -e "s/@log=${ACCOUNT}:/@log=/"
  aws_ logs get-query-results --query-id "$qid" --output text \
    --query '[length(results), statistics.recordsScanned]' | awk '{ printf "(%d rows, %d records scanned)\n", $1, $2 }' >&2
}

cmd="${1:-errors}"; shift || true
verify_account
case "$cmd" in
  env)
    echo "branch=$BRANCH account=$ACCOUNT region=$REGION profile=$PROFILE amplifyAppId=$APP_ID (credentials verified)" ;;
  groups)
    for g in $(stack_groups "${1:-}"); do
      ts=$(aws_ logs describe-log-streams --log-group-name "$g" --order-by LastEventTime --descending --max-items 1 \
        --query 'logStreams[0].lastEventTimestamp' --output text 2>/dev/null | head -1)
      if [[ "$ts" =~ ^[0-9]+$ ]]; then last=$(date -r $((ts / 1000)) '+%Y-%m-%d %H:%M:%S'); else last="(no events)"; fi
      printf '%-20s %s\n' "$last" "$g"
    done ;;
  errors)
    run_insights "${1:-1h}" "fields @timestamp, @log, @requestId, @message
      | filter @message like /(?i)(ERROR|Exception|Unhandled|Task timed out|Runtime\.|\"status\":\"5\d\d\"|Process exited|out of memory|AccessDenied|ValidationException|ConditionalCheckFailed)/
      | filter @message not like /NodeVersionSupportWarning/
      | sort @timestamp desc | limit ${2:-100}" ;;
  query)
    [[ $# -lt 2 ]] && { echo "usage: logs.sh query <since> '<insights query>' [group-filter]" >&2; exit 1; }
    run_insights "$1" "$2" "${3:-}" ;;
  tail)
    [[ $# -lt 1 ]] && { echo "usage: logs.sh tail <group-filter> [since]" >&2; exit 1; }
    run_insights "${2:-30m}" "fields @timestamp, @log, @requestId, @message | sort @timestamp desc | limit 200" "$1" ;;
  request)
    [[ $# -lt 1 ]] && { echo "usage: logs.sh request <requestId> [since]" >&2; exit 1; }
    run_insights "${2:-1d}" "fields @timestamp, @log, @requestId, @message | filter @requestId = '$1' or @message like '$1' | sort @timestamp asc | limit 500" ;;
  deployed)
    aws_ amplify list-jobs --app-id "$APP_ID" --branch-name "$BRANCH" --max-items 5 --output table \
      --query 'jobSummaries[].{job:jobId,status:status,commit:commitId,started:startTime}' ;;
  *) echo "unknown command: $cmd" >&2; exit 1 ;;
esac
