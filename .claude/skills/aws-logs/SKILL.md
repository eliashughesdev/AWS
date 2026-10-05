---
name: aws-logs
description: Check the deployed Loudibly backend's CloudWatch logs for the AWS account linked to the current git branch (e.g. nodapay_ui → 471112580718 / eu-west-3 / profile nodaprod), find errors, trace them to source, and propose fixes. Use when asked to check logs, find production errors, debug a failing deployed endpoint, or investigate a request id.
argument-hint: "[since e.g. 1h | 1d] [endpoint, error text, or requestId to focus on]"
allowed-tools: Bash(.claude/skills/aws-logs/logs.sh:*), Bash(git log:*), Bash(git show:*), Bash(git diff:*), Read, Grep, Glob
---

# Check deployed logs and find errors

All AWS access goes through `.claude/skills/aws-logs/logs.sh` (run from the repo root). It
looks up the current git branch in `environments.tsv`, uses that branch's account, region and
profile, and **refuses to run if the profile's credentials belong to another account**. Never
call `aws` directly with a hand-picked profile or region; use the script, or for a branch other
than the checked-out one, `BRANCH=<name> .claude/skills/aws-logs/logs.sh ...`.

If the branch isn't in `environments.tsv`, stop and ask the user for the account id, region,
profile and Amplify app id (`aws amplify list-apps`) and add a row. Don't guess.

This is **read-only**. Don't change AWS resources, redeploy, purge queues or write to tables
as part of this skill. Code fixes go in the repo, and the user decides when to deploy.

## Commands

| Command | Purpose |
|---|---|
| `logs.sh env` | Show the resolved branch → account/region/profile and verify credentials |
| `logs.sh groups [filter]` | This stack's log groups and when each last got an event |
| `logs.sh errors [since] [limit]` | Error-looking lines across all stack log groups (default `1h`, `100`) |
| `logs.sh request <requestId> [since]` | Every line for one Lambda request id (default `1d`) |
| `logs.sh tail <group-filter> [since]` | Recent raw lines from matching groups, e.g. `tail mainapifn 30m` |
| `logs.sh query <since> '<insights query>' [group-filter]` | Custom CloudWatch Logs Insights query |
| `logs.sh deployed` | Recent Amplify deploy jobs for the branch: commit, status, time |

`since` is `15m`, `2h`, `3d` and so on. Output is one block per row: tab-separated
`@timestamp= @log= @requestId= @message=`. Multi-line stack traces stay intact.

## Which log group is which

- `/aws/lambda/amplify-<appId>-...-mainapifnlambda...`: `mainApiFn`, which runs every REST
  route through `amplify/service/router.ts`. Most errors land here.
- `/aws/lambda/custom-authorizer-fn`: `amplify/fn/authorizer/handler.js` (HMAC / Cognito JWT).
  Here, a deny looks like a 401/403 at the gateway with **no** matching mainApiFn invocation.
- `sqsV1WebhookProcessorFn`, `sqsV1GeneralProcessorFn`: `amplify/fn/sqs-processor/*`. If one
  doesn't appear under `groups`, it has never been invoked.
- `streamTopicHandlerFn`: `amplify/fn/stream/handler.ts` (DynamoDB Streams → SNS).
- `wsConnectHandlerFn` / `wsDisconnectHandlerFn`: `amplify/fn/websocket/*`.
- `...custommessagelambda...`: Cognito custom message trigger.
- `/aws/apigateway/LoudiblyRestApi`: access log (JSON: status, path, ip, requestId).
  `API-Gateway-Execution-Logs_<apiId>/v1`: gateway execution log, which includes authorizer results.

## Workflow

1. `logs.sh env`, then `logs.sh deployed`. Note the deployed commit and compare it with
   `git log -1`. If local HEAD differs, the deployed code may not match what's on disk, so read
   source at the deployed commit (`git show <commit>:<path>`) when tracing.
2. `logs.sh errors <since>` (start at `1h`, widen to `1d`/`7d` if it's empty). Use the user's
   window or focus if they gave one in `$ARGUMENTS`.
3. **Group the errors**: one bucket per distinct root cause, not per line. A single request
   often logs the same failure 2–3 times as it propagates (provider → service → router catch
   block). Count occurrences and note the first/last time and the affected route.
4. For each bucket, `logs.sh request <requestId>` on one example to get the whole story:
   incoming path/body (router `DEBUG:` lines), RBAC result, and the first error in the chain.
   The first error is usually the real one; later ones are often side-effects.
5. **Map to source.** The Lambdas are bundled and minified (`file:///var/task/index.mjs:332:…`),
   so stack frames don't point to files. Search the repo for the literal log strings instead
   (e.g. `Grep "Failed to create VA Account"`, `"FATAL CATCH BLOCK ERROR"`). Class names in
   messages like `(TatumProvider)` point to `amplify/providers/...`.
6. Classify each root cause:
   - **Code bug**, e.g. a `TypeError`, a missing function, or an `error_code` absent from
     `amplify/errors/http.ts` (calling `processError` with an unknown code throws instead of
     returning 400; see CLAUDE.md).
   - **Config/secret problem**, e.g. an invalid header char in an API key (often a trailing
     newline or space in an SSM parameter), a missing env var, or a wrong endpoint. Config comes
     from SSM via `amplify/service/utils/config.ts`. You may name the parameter, but **never
     print secret values**. Ask the user before reading any SSM value.
   - **Upstream/provider failure** (Tatum, Stripe, Clover, Didit, SES): a non-2xx from the
     provider, a timeout, or a rate limit.
   - **Client error / expected**: validation 4xx or auth denials from bad signatures. Report
     these but don't "fix" them.
   - **Infra noise**, e.g. cold-start warnings or `NodeVersionSupportWarning`. Mention it once
     at most.
   Check `docs/merchant-intake-onboarding.md` for gaps that are already known and deliberately
   left unfixed before you report one as new.
7. **Report** to the user, most severe first: root cause, evidence (timestamp, request id, a
   trimmed log excerpt), the source location (`path:line`), impact (which route or flow, how
   many hits), and the proposed fix. For clear code bugs, make the fix in the repo when the
   user asked for fixes. Otherwise propose it and ask first. Say that a fix only takes effect
   after `ampx pipeline-deploy` / an Amplify build, and that the e2e scripts in
   `amplify/service/routes/e2e/` can re-verify it afterwards.
8. If nothing is found, say so plainly, with the window and log groups you checked.

## Hygiene

- Logs contain request bodies, emails, JWT claims and principal ids. Quote only what's needed
  to show the bug and redact tokens, keys, signatures and card or PII data.
- Don't paste huge dumps. Summarize and give the request id so the user can pull the rest.

## Adding another branch / account

Add a row to `environments.tsv`:
```
<branch>   <account-id>   <region>   <aws-profile>   <amplify-app-id>
```
Then run `BRANCH=<branch> .claude/skills/aws-logs/logs.sh env` to confirm the credentials match.
