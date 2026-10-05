# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Loudibly is a payments/wallet platform on AWS Amplify Gen2. A merchant platform charges a
card on its own side, then calls Loudibly's B2B API to register the payer and, over time,
custody or move their balance — either through a Loudibly-managed (custodial) account backed
by a crypto ledger (Tatum, Solana/Tron), or a non-custodial wallet where the user holds their
own keys. Card processing is pluggable (Stripe, Clover). KYC runs through Didit.

There are three deployable pieces in this one repo:

- **`amplify/`** — the backend: a single Lambda (`mainApiFn`) behind API Gateway that
  dispatches to route handlers via `amplify/service/router.ts`, plus a custom HMAC/JWT
  Lambda authorizer, SQS processors, a DynamoDB Streams handler, and a WebSocket API. Defined
  as CDK inside `amplify/backend.ts`.
- **`src/`** (React, root `package.json`) — customer-facing checkout flows: KYC upload,
  add-card, process-payment, an embeddable payment widget. Builds to `dist/`.
- **`web/`** — a yarn-workspaces monorepo (own `package.json` and `yarn.lock`) for the Vue
  account dashboard:
  - `web/apps/loudibly/` (workspace `loudibly`) — the dashboard app: views, layouts, router,
    brand config (custodial: balance, cards, deposit, withdraw, transfer; non-custodial:
    wallet dashboard, send, receive, ledger, all read straight from the chain with an
    in-session key). Builds to `web/apps/loudibly/dist/`, which is copied into `dist/v2` in
    production (see `amplify.yml`).
  - `web/core/` (`@loudibly/core`) — shared, UI-free code imported by apps: backend API
    client (`api/`), Cognito auth (`auth/`), composables, realtime/WebSocket helpers, and the
    non-custodial chain code (`wallet/`: Solana, TRON, session keys).

  The old `vue-app/` directory is gone from git; a local copy holding only `dist/` and
  `node_modules/` may still exist and should be ignored.

Read `docs/merchant-intake-onboarding.md` for a step-by-step trace of the one flow that is
actually live today (merchant onboarding intake) — it also documents known gaps/bugs the
author found and deliberately didn't fix (authorizer never validates `bodyHash` against the
real body, `/webhook/*` has no authorizer at all, some error codes in `amplify/errors/http.ts`
are referenced but never defined). Treat that doc as current ground truth for that endpoint,
not aspirational.

## Commands

Root (React app + Amplify backend):
```
yarn dev                              # vite dev server for src/
yarn build                            # tsc && vite build
yarn lint                             # eslint . --ext ts,tsx --max-warnings 0
yarn ampx pipeline-deploy --branch <branch> --app-id <app-id>   # deploy backend (what CI runs)
```

Vue dashboard (run from `web/`):
```
cd web
yarn install                          # installs all workspaces
yarn workspace loudibly dev
yarn workspace loudibly build         # vue-tsc -b && vite build (what CI runs)
```

There is no unit/integration test runner (no jest/vitest config, no `test` script). Backend
verification is done with standalone scripts in `amplify/service/routes/e2e/**/*Test.ts` —
each one builds a signed request and `fetch()`s a **live, already-deployed** API Gateway URL
that's hardcoded in the file. Run one with `tsx`:
```
npx tsx amplify/service/routes/e2e/accounts/AccountsOnboardingTest.ts
```
These only work against a deployed stack (the target URL, e.g.
`https://<api-id>.execute-api.us-east-2.amazonaws.com`, is baked into each test file) — a
route added in code isn't reachable until `ampx pipeline-deploy` runs. Signing credentials for
these live in `amplify/service/routes/e2e/credentials.ts`.

Deployed logs: the `aws-logs` project skill (`.claude/skills/aws-logs/`) checks CloudWatch for
the AWS account linked to the current branch. The branch → account/region/profile map is in
`.claude/skills/aws-logs/environments.tsv`; add a row there when a branch gets its own stack.

## Backend architecture (`amplify/`)

**Everything goes through one Lambda.** `amplify/fn/api/handler.ts` → `router.ts` is a plain
`Map<path, { handler, requiredParams, method, allowedRoles }>` (see the `routes` map at the
top of `router.ts`). To add an endpoint: create a handler class with an `execute(event,
context)` method under `service/routes/<area>/`, then register it in that map. The router
does, in order: parse body (preserving `rawBody` for signature verification, e.g. Stripe
webhooks), RBAC check against `event.requestContext.authorizer.role` if `allowedRoles` is set,
then top-level-only required-param validation (`utils/params.ts`) — handlers must still
validate their own nested fields. `loadConfig()` (`utils/config.ts`) pulls parameters from SSM
into `process.env` on cold start / at most once a minute; env access after that is normal
`process.env.X`.

**Two auth paths, one authorizer.** `amplify/fn/authorizer/handler.ts` is a CDK-defined
`RequestAuthorizer` (not part of the Amplify-managed backend, added directly to `apiStack`)
sitting in front of `/accounts/*` and `/payments/*` (`resultsCacheTtl: 0`, so it runs on every
call — no caching). It accepts either a Cognito JWT (end users, role `user`) or an HMAC
`Signature <timestamp>:<bodyHash>:<sig>` over `X-Project` (B2B platform keys stored in
`v1UserKeysTable`, role `admin`). `/webhook/*` has **no authorizer at all** — routes that need
to be publicly callable but also need auth must live under `/accounts/` or `/payments/`
instead, not `/webhook/`.

**Provider abstraction pattern.** Payment processing (`providers/payment/`), the crypto ledger
(`providers/ledger/`, Tatum), KYC (`providers/kyc/`, Didit), and email (`providers/email/`,
SES) are each defined as a TS interface plus one or more concrete implementations, selected at
runtime by config rather than hardcoded per route (see `PaymentProcessor` /
`PaymentProcessorConstructor` in `providers/payment/PaymentProcessor.ts` for the shape). When
adding a new payment or ledger provider, implement the existing interface rather than
special-casing the new provider in route handlers.

**DynamoDB is single-table-ish per concern**, all defined in `amplify/backend.ts` (not in
`amplify/data/resource.ts` — that file only has an unrelated placeholder `User` model on the
Amplify Data/AppSync side, not the real schema). Key tables: `v2CustomerTable` (composite
`id`/`sk`, one row per fact — `USERPROFILE`, `MAPPING`, `CLAIM`, `IDEMPOTENCY` — see the
onboarding doc for the exact key shapes), `v1UserKeysTable` (B2B API keys),
`v1AccountBalanceTable`, `v1PaymentTransactionLogsTable` / `v1TransactionLogsTable`,
`v1WebSocketConnectionsTable`, `v1WebhookIPWhitelistTable`, `v2BinCacheTable`. Writes that must
be atomic (e.g. idempotent transaction creation) go through `transactWriteItems` in
`utils/db.ts`, which supports a per-item `conditionExpression` (e.g.
`attribute_not_exists(id)`) — use this instead of a plain multi-item write whenever two records
must succeed or fail together.

**Async work is queue-driven.** Four SQS queues (`v1WebhookQueue`, `v1GeneralQueue`,
`v1PaymentProcessingQueue`, `v1WithdrawalProcessingQueue`, `v1AccountBackfillQueue`) feed two
processor Lambdas (`fn/sqs-processor/webhook`, `fn/sqs-processor/general`); a DynamoDB Streams
Lambda (`fn/stream/handler.ts`) fans out changes from `v1UserKeysTable`, `v2CustomerTable`, and
`v1WebhookIPWhitelistTable` to an SNS topic. Anything persisted to those streamed tables is
logged in full by the stream handler — never write a secret (e.g. a plaintext claim token) into
one of them; store a hash instead (see how `utils/claimToken.ts` is used in
`routes/accounts/onboarding.ts`).

**Error codes are centralized but not exhaustive.** `amplify/errors/http.ts` maps numeric
`error_code`s to messages via `processError(code, params)`. Calling it with a code not in the
`httpErrors` map throws instead of returning a 400 — check the map before reusing a code, and
add new codes there rather than inlining error responses in handlers.

## Frontend notes

- `src/App.tsx` does manual path-based routing (`window.location.pathname`), no router
  library — it's wrapped in Amplify's `<Authenticator>` and an `EvervaultProvider` (Evervault
  handles card-data encryption client-side before it reaches the backend/Stripe).
- The Vue app uses `vue-router` with route `meta.custodialOnly` / `meta.walletOnly` guards
  (see `web/apps/loudibly/src/router/index.ts`) to separate the Cognito-backed custodial dashboard from
  the non-custodial, client-key wallet screens — check which mode a view belongs to before
  wiring in Cognito-only or chain-only calls.
- Root app deploys to `/`, the Vue app deploys to `/v2/` (`createWebHistory('/v2/')`); the
  Amplify build copies `web/apps/loudibly/dist` into `dist/v2` (`amplify.yml`).
- Calls to the backend go through `@loudibly/core/api/*` — add new endpoints there rather
  than calling `fetch` from a view.

## Conventions

- Lint config (`eslint.config.js`, based on `neostandard`) deliberately turns off
  space-before-function-paren, quote-props, and a few stylistic rules to match existing code
  style — don't "fix" those in unrelated diffs.
- `evFunctions/` holds Evervault-hosted functions, deployed independently via the Evervault
  CLI only when files under that path changed (see the conditional block in `amplify.yml`).
