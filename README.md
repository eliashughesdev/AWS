# Loudibly

Loudibly is a payments and wallet platform on AWS Amplify Gen2. A merchant platform charges a
card on its own side, then calls Loudibly's B2B API to register the payer and, over time,
custody or move their balance — either through a Loudibly-managed (custodial) account backed
by a crypto ledger, or a non-custodial wallet where the user holds their own keys. Card
processing is pluggable (Stripe, Clover) and identity verification runs through Didit KYC.

> Status: early — only merchant onboarding intake (creating the payer's identity and a claim
> token) is fully wired up end to end. Password claiming, email delivery, and actually moving
> money are not live yet. See [`docs/merchant-intake-onboarding.md`](docs/merchant-intake-onboarding.md)
> for a full trace of what happens today.

## Structure

This repo contains three deployable pieces:

- **`amplify/`** — the backend: a single Lambda behind API Gateway that dispatches to route
  handlers, a custom HMAC/JWT Lambda authorizer, SQS processors, a DynamoDB Streams handler,
  and a WebSocket API. Infrastructure is defined as CDK in `amplify/backend.ts`.
- **`src/`** — a React app with the customer-facing checkout flows: KYC upload, add-card,
  process-payment, and an embeddable payment widget. Builds to `dist/` and deploys at `/`.
- **`web/`** — a yarn workspace for the Vue frontends. `web/core/` (`@loudibly/core`) holds
  the logic shared by every client app; `web/apps/<client>/` holds one app per client design.
  `web/apps/loudibly/` is the account dashboard: custodial views (balance, cards, deposit,
  withdraw, transfer) and non-custodial wallet views (dashboard, send, receive, ledger) that
  read straight from the chain with an in-session key. It is copied into `dist/v2` at deploy
  time, serving at `/v2/`.

## Tech stack

- **Backend**: AWS Amplify Gen2, AWS CDK, Lambda, API Gateway (REST + WebSocket), DynamoDB,
  SQS, Cognito, SES, SSM.
- **Payments**: Stripe, Clover, Evervault (client-side card-data encryption).
- **Crypto / ledger**: Tatum, Solana (`@solana/web3.js`), Tron (`tronweb`), `@noble/secp256k1`.
- **KYC**: Didit.
- **Frontend**: React 19 + Vite (`src/`), Vue 3 + Vite + Tailwind (`web/`).

## Configuration

### SSM parameters

`loadConfig()` (`amplify/utils/config.ts`) loads every parameter under the fixed prefix
`/loudibly/api/` (one level, e.g. `/loudibly/api/STRIPE_API_KEY`) into `process.env` on cold
start, re-fetching at most once a minute. The prefix is the same for every deployment, so
parameters are scoped per AWS account and region — the setup assumes **one brand per AWS
account**. `mainApiFn`, the SQS webhook processor, and `customMessageFn` all call it, so these
must exist in SSM Parameter Store for those functions to work:

| Parameter | Description |
|---|---|
| `STRIPE_API_KEY` | Stripe secret API key, used to create charges/payment intents |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret, verifies `/webhook/stripe` requests |
| `CLOVER_PRIVATE_TOKEN` | Clover private API token for Clover card payment processing |
| `CLOVER_PUBLIC_KEY` | Clover public key for Clover card payment processing |
| `EVERVAULT_APP_ID` | Evervault app id, used to build the Evervault client that decrypts card data during payment processing |
| `EVERVAULT_API_KEY` | Evervault API key, paired with `EVERVAULT_APP_ID` |
| `DIDIT_API_KEY` | Didit KYC API key, used to create verification sessions |
| `DIDIT_WORKFLOW_ID` | Didit workflow/template id to run for identity verification |
| `DIDIT_CALLBACK_URL` | URL Didit redirects the user back to after completing a KYC session |
| `DIDIT_WEBHOOK_SECRET` | Secret used to verify Didit KYC webhook signatures |
| `EMAIL_PROVIDER` | Which email provider implementation to use; defaults to `AWS_SIMPLE_EMAIL_SERVICE` if unset |
| `SES_FROM_EMAIL` | "From" address used when sending email through Amazon SES |
| `FRONTEND_URL` | Base URL of the frontend; used to build password-claim/verification links and Stripe 3-D-Secure return URLs |
| `BRAND_NAME` | Product name used in every user-facing email (e.g. `NODA`). No default: the email senders throw if it is missing. Must match the frontend's `VITE_BRAND`, which is set separately in the Amplify console — otherwise payers get an email for one brand and land on a site skinned as another |
| `CLAIM_TOKEN_TTL_SECONDS` | How many seconds a password-claim link (onboarding + resend) stays valid before `100035`. Optional — falls back to `604800` (7 days) if unset or not a positive number |
| `TATUM_BASE_URL` | Base URL for the Tatum API; defaults to `https://api.tatum.io/v3` if unset |
| `TATUM_WEBHOOK_URL` | Callback URL registered with Tatum for deposit/transaction webhooks |
| `TATUM_API_KEY` | Tatum ledger API key used by `mainApiFn` (the SQS webhook processor instead gets this from an AWS Secrets Manager secret of the same name — see the environment variable table below) |
| `TRON_MASTER_ADDRESS` | TRON address token deposits (e.g. USDT_TRON) are swept to after crediting the customer's balance. A single address for the whole chain — one TRON address natively holds TRX and any number of TRC-20 tokens |

### Environment variables

These are wired directly into each Lambda's environment in CDK (`amplify/backend.ts` and the
per-function `resource.ts` files) rather than read from SSM, either because they're
infrastructure identifiers only known at deploy time or because they come from the
Amplify/Lambda runtime itself:

| Variable | Description |
|---|---|
| `COGNITO_USER_POOL_ID` | Cognito user pool id, set on `mainApiFn` so onboarding can call `AdminCreateUser` / `AdminAddUserToGroup` |
| `CONNECTIONS_TABLE_NAME` | DynamoDB table name for WebSocket connections (`v1WebSocketConnectionsTable`) |
| `WEBSOCKET_STAGE` | API Gateway WebSocket stage name (`v1`) |
| `WEBSOCKET_API_ID` | WebSocket API Gateway id, used by the SQS webhook processor to push messages to connected clients |
| `TATUM_API_KEY` | Tatum ledger API key, injected into the SQS webhook processor directly from the `TATUM_API_KEY` AWS Secrets Manager secret (separate from the SSM parameter of the same name used by `mainApiFn`) |
| `V1_WEBHOOK_QUEUE_URL` | SQS queue URL for general webhook events |
| `V1_GENERAL_QUEUE_URL` | SQS queue URL for the general-purpose async queue |
| `PAYMENT_PROCESSING_QUEUE_URL` | SQS queue URL for payment-processing messages |
| `WITHDRAWAL_QUEUE_URL` | SQS queue URL for withdrawal-processing messages |
| `WEBHOOK_QUEUE_URL` | Read (without the `V1_` prefix) by `amplify/service/routes/webhook/tatum/accountTransactions.ts`; not set anywhere in `backend.ts`, so it always falls back to a hardcoded queue URL unless added manually |
| `AWS_REGION` | Provided automatically by the Lambda runtime; used as the SDK client region for DynamoDB/SSM |
| `AWS_APP_ID` / `AWS_BRANCH` | Provided automatically by the Amplify Console build environment; used only by the `ampx pipeline-deploy` CI command |

## Getting started

Install and run the React app + backend tooling from the repo root, and the Vue frontends
from `web/` separately — they have independent `package.json` files and lockfiles.

```bash
# React app (src/)
yarn install
yarn dev              # vite dev server

# Vue frontends (web/) — one install for every app
cd web
yarn install
yarn workspace loudibly dev
```

### Build

```bash
yarn build             # root: tsc && vite build -> dist/
cd web && yarn workspace loudibly build   # vue-tsc -b && vite build -> web/apps/loudibly/dist/
```

### Lint

```bash
yarn lint
```

### Backend deploy

The Amplify backend (Lambdas, API Gateway, DynamoDB tables, queues, Cognito) is deployed via
the Amplify CDK pipeline:

```bash
yarn ampx pipeline-deploy --branch <branch> --app-id <app-id>
```

This is what CI (`amplify.yml`) runs on every push; a route or backend change isn't reachable
until this deploy completes.

### Testing

There's no unit/integration test runner in this repo. Backend flows are verified with
standalone scripts under `amplify/service/routes/e2e/**/*Test.ts`, each of which builds a
signed request and calls a **live, already-deployed** API Gateway endpoint. Run one with:

```bash
npx tsx amplify/service/routes/e2e/accounts/AccountsOnboardingTest.ts
```

## Known issues

A backend bug audit (routes, providers, utils under `amplify/`) turned up the following,
ranked by severity. None of these are fixed yet — flagging them here so they aren't
rediscovered from scratch.

**Money-correctness**

- `amplify/service/routes/accounts/transfer.ts:98-104` — the sender's debit has no
  balance-sufficiency condition (unlike `withdraw.ts`, which has one). Any user can transfer
  more than they hold, driving their balance negative while the recipient is credited in
  full.
- `amplify/fn/sqs-processor/webhook/balanceUpdateHandler.ts:86-111` — balance updates are
  read-then-write (`getRecord` → compute → `updateItem`) instead of an atomic
  `SET balance = balance + :delta`. Two concurrent SQS messages for the same account race on
  the read and one write silently overwrites the other.
- `amplify/service/routes/accounts/transfer.ts:60-112` — no check that sender and recipient
  currencies match before applying the same raw amount to both sides.
- `amplify/service/routes/accounts/transfer.ts:77-112` — the ledger transfer plus the two
  balance updates and two tx-log writes run via `Promise.all` with no transaction/rollback;
  a partial failure leaves the external transfer done but local state inconsistent.
- `amplify/service/routes/accounts/withdraw.ts:172-184` and
  `amplify/fn/sqs-processor/webhook/withdrawalHandler.ts:58-70` — failure rollback restores
  `balance` but never `availableBalance`, permanently locking that slice of funds after any
  failed withdrawal.

**Authorization (IDOR)**

- `amplify/service/routes/accounts/details.ts:8-9,22` — the ownership check is commented out
  (`// todo ensure that customer have enough right to get this account`); any authenticated
  caller can fetch any account's profile and balance by ID.
- `amplify/service/routes/payments/process.ts:14-19` and
  `amplify/service/routes/payments/save.ts:15-19` — `userId` is taken from the request body
  with no check against the authorizer's own `userId` (unlike withdraw/deposit, which do
  check), letting a caller charge or save a card against an arbitrary victim's account.
- `amplify/service/routes/webhook/cb.ts:6-12` — the Tatum webhook IP allowlist trusts the
  client-settable `X-Forwarded-For` header instead of API Gateway's verified source IP.
- `amplify/service/routes/accounts/account.ts:18` — falls back to
  `crypto.randomUUID()` when the authorizer context has no `userId`, which would silently
  provision a real custodial account under an anonymous identity instead of rejecting the
  request.

**Crash / malformed response**

- `amplify/service/routes/accounts/deposit.ts:83-124` — no fallback branch when
  `sendToQueue` resolves `{ success: false }` without throwing; the handler falls through and
  returns `undefined`.
- `amplify/service/routes/webhook/cb.ts:29` — `types[queryStringParameters.type]()` calls
  `undefined()` for any unrecognized `type`, throwing an uncaught `TypeError` instead of a
  clean 4xx.

See also [`docs/merchant-intake-onboarding.md`](docs/merchant-intake-onboarding.md) for
issues found specifically in the onboarding flow (authorizer not validating `bodyHash`
against the real body, `/webhook/*` having no authorizer at all, undefined error codes in
`amplify/errors/http.ts`, and the concurrent-retry 500).

## Documentation

- [`docs/merchant-intake-onboarding.md`](docs/merchant-intake-onboarding.md) — step-by-step
  trace of the merchant onboarding intake flow (`POST /v1/accounts/onboarding`), including
  known issues that were found but deliberately left unfixed pending a design decision.
- [`CLAUDE.md`](CLAUDE.md) — deeper architecture notes for working in this codebase (routing
  pattern, auth, provider abstractions, DynamoDB schema, async/queue wiring, conventions).
