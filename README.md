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
- **`vue-app/`** — a Vue app for the account dashboard: custodial views (balance, cards,
  deposit, withdraw, transfer) and non-custodial wallet views (dashboard, send, receive,
  ledger) that read straight from the chain with an in-session key. Builds independently and
  is copied into `dist/v2` at deploy time, serving at `/v2/`.

## Tech stack

- **Backend**: AWS Amplify Gen2, AWS CDK, Lambda, API Gateway (REST + WebSocket), DynamoDB,
  SQS, Cognito, SES, SSM.
- **Payments**: Stripe, Clover, Evervault (client-side card-data encryption).
- **Crypto / ledger**: Tatum, Solana (`@solana/web3.js`), Tron (`tronweb`), `@noble/secp256k1`.
- **KYC**: Didit.
- **Frontend**: React 19 + Vite (`src/`), Vue 3 + Vite + Tailwind (`vue-app/`).

## Getting started

Install and run the React app + backend tooling from the repo root, and the Vue dashboard
from `vue-app/` separately — they have independent `package.json` files and lockfiles.

```bash
# React app (src/)
yarn install
yarn dev              # vite dev server

# Vue dashboard (vue-app/)
cd vue-app
yarn install
yarn dev
```

### Build

```bash
yarn build             # root: tsc && vite build -> dist/
cd vue-app && yarn build   # vue-tsc -b && vite build -> vue-app/dist/
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

## Documentation

- [`docs/merchant-intake-onboarding.md`](docs/merchant-intake-onboarding.md) — step-by-step
  trace of the merchant onboarding intake flow (`POST /v1/accounts/onboarding`), including
  known issues that were found but deliberately left unfixed pending a design decision.
- [`CLAUDE.md`](CLAUDE.md) — deeper architecture notes for working in this codebase (routing
  pattern, auth, provider abstractions, DynamoDB schema, async/queue wiring, conventions).
