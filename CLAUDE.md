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
- **`web/`** — a yarn-workspaces monorepo (own `package.json`; one lockfile, `web/yarn.lock`,
  for every frontend) for the Vue frontends: one app per client design plus shared logic
  (plan: `docs/frontend-layout-plan.md`).
  - `web/apps/loudibly/` (workspace `loudibly`) — the account dashboard: views, layouts, router,
    brand config (custodial: balance, cards, deposit, withdraw, transfer; non-custodial:
    wallet dashboard, send, receive, ledger, all read straight from the chain with an
    in-session key). Builds to `web/apps/loudibly/dist/`, which is copied into `dist/v2` in
    production (see `amplify.yml`).
  - `web/apps/noda/` (workspace `noda`) — NODA's own design, to be served at `/` on its own
    domain. Until it has one, `amplify.yml` builds it with `--base=/noda/` into `dist/noda`, so
    it is served at `/noda/` beside `/v2/`. Nothing in the app names that prefix: the router
    takes its base from the build (`import.meta.env.BASE_URL`). Built so far: the header, navigation
    and footer (`TopNavLayout`, which also draws each page's heading and subtitle from the
    route's `meta.title` / `meta.subtitle`; a view puts a control beside the heading by wrapping
    it in `PageAction`),
    Convert, Payments and Earn, whose
    content is all mockup data kept in `src/placeholders/`. Accounts is real: it lists the
    user's accounts with their value in USD and opens new ones from the New Account dialog.
    Only an account's name is made up (`placeholders/accountNames.ts`, picked from the account
    number), because the backend stores none; storing one waits for the client. `src/coins.ts`
    maps a backend `chain` to the symbol, name and image shown, and names its network
    (`networkName()`, the test network's name unless the build is for mainnet). `src/format.ts` formats
    money, coin amounts, dates and relative times, and cuts an id or an address short; a value in
    USD that may have no price, or not be read yet, goes through its `usdValue()`, `usdSum()` and
    `priced()`. The Dashboard is real where the backend has
    something to show: the total in USD, one asset row per currency held, Recent Activity and
    the "KYC Verified" row, which starts Didit. `src/activity.ts` says what each backend
    transaction `type` shows as; a type it does not have, such as `FEE`, is not listed. The
    Dashboard's 30-day line, % changes, Security Score, stat cards and other achievements are
    still mockup data (`placeholders/dashboard.ts`). Transactions is real: every listed row of
    the user's crypto accounts, a search, three filters, and four totals that cover the chosen
    date range. It opens on the type and range given in the address
    (`/transactions?type=Deposit&range=all`). The user's side of From/To is the account's made-up name. Its Fee column and
    the % line under each total are still mockup data (`placeholders/transactions.ts`); the
    real fee waits for a backend change (`fee` on the withdrawal rows of
    `/accounts/transactions`). Deposit is real for the Crypto method: a dropdown with one line
    per account (two accounts can share a coin), the chosen account's network, address and QR
    code, and Recent Deposits, the four newest `DEPOSIT` rows of every account. Nothing tells
    the browser that a deposit arrived, so while the page is in view it reads `/accounts/list`
    every 15 seconds, and reads the rows again only when a balance changed. Its Card and Bank
    tiles, the minimum deposit and the confirmations line are still mockup data
    (`placeholders/deposit.ts`). Withdraw is real: a chip per coin the user holds, a dropdown of
    accounts under the chips only when the chosen coin has several, the available amount
    (`availableBalance`, the number the backend checks), Max, the destination address, and
    "Withdraw now" with its result dialog, which cannot be closed while the withdrawal is
    processed and never says "failed" when no result arrived (it may still go through). Max and
    the form leave what the backend sets aside for the fee of TRX and SOL
    (`withdrawalFeeReserve()` in core), and the address must have the shape of its network's
    (`looksLikeAddress()`). The dialog words each outcome itself from `useWithdraw().failure` and
    `errorCode`, never from the server's message. Your Wallets lists every account with its
    balance. History at `/withdraw/history` is the ten newest withdrawals of every account (sent,
    failed, and uncertain as Pending) and reads when it is opened. The network fee and the
    Withdraw Limits card are still mockup data (`placeholders/withdraw.ts`), shown in the chosen
    coin. `src/accountChoices.ts` turns the accounts into the sorted list Deposit and Withdraw
    choose from, and `useReread()` in `src/reread.ts` is the 15-second re-read both pages use.
    A dropdown is `FilterButton` (`options`, `v-model`); on mobile
    its list is placed by an ancestor that is positioned only while it is open, because an
    always-`relative` one moved pixels of the drawn page. The open list itself is `DropdownList`,
    which any button can hang under a positioned wrapper (Deposit's does). `StatusPill` draws Completed, Pending
    and Failed. A dialog goes in `AppDialog` (a modal `<dialog>`), and what a list shows while it
    loads, when it is empty and when its read failed goes in `ListState`. Sign-in and sign-up at `/auth` are
    real: `AuthView` is a copy of Loudibly's screen without the non-custodial mode, kept until
    the client supplies its own. Only that view uses the Loudibly colour, spacing and type names
    in `src/assets/auth.css` and the two extra font requests in `index.html`; they go when it
    goes. The avatar in `TopNavLayout` shows the user's initial and opens the sign-out menu. The
    sun and moon switch beside it flips the theme (`src/theme.ts`): dark is `main.css` as it
    stands, and light is `<html data-theme="light">`, whose values are all in
    `src/assets/light.css`. The browser keeps the choice and `index.html` applies it before the
    first paint. Light is built one view at a time (`docs/noda-light-theme-plan.md` says which
    are done; so far the header, tab bar, heading and footer), and a view not yet done shows
    dark boxes with black text in light. A colour that differs between the themes is a token
    with a value in both files, never a literal in a view. `text-white` is for text on a
    coloured fill; text that follows the theme is `text-ink` or inherits. What a colour cannot
    say takes the `light:` variant. A card is the `card` class, which also carries its light
    shadow. The sign-in screen is dark in both themes. A
    table goes in `DataTable`, which scrolls sideways inside `ScrollX` when it does not fit and
    takes controls for its title line in a `tools` slot and a list state or a button under its
    rows in an `after` slot; `QrCode` draws a QR code as SVG. A
    `\n` in `meta.subtitle` breaks the line on mobile only. Its git-ignored
    `brand-source/` holds the brand book and, in `figma/`, the screen designs (2x exports of a
    1440px and a 320px page; `figma/lightTheme/` has the light ones, desktop only) — build only
    what an image there shows. The design has no SVG
    icons: they are cut from those images as mask PNGs (`src/assets/icons/`, sizes in
    `src/icons.ts`, drawn by `AppIcon` in the text colour; its `mobile` prop names a second
    cut for below the `lg` breakpoint).
  - `web/core/` (`@loudibly/core`) — the headless shared package imported by apps: backend API
    client (`api/`), Cognito auth (`auth/`), composables, realtime/WebSocket helpers, and the
    non-custodial chain code (`wallet/`: Solana, TRON, session keys). Consumed as source (no
    build step; `vue` is a peer dependency so apps and core share one Vue runtime).

  Core rules: import it as `@loudibly/core/<dir>/<file>` (no extension — `exports` maps `./*` to
  `./src/*.ts`); declare every package core imports in `web/core/package.json`, not the app's
  (e.g. core needs `bs58` v6 while the hoisted copy is v4); keep Tailwind class names out of
  core — Tailwind only scans the app, so a class written in core is never generated. API calls
  go through `@loudibly/core/api/*`; `request()` returns `{ ok, status, data }` and never throws
  on an HTTP error status (views branch on `ok`), only on network failure. Apps never import
  `aws-amplify`: Cognito goes through `@loudibly/core/auth/cognito`, and route access through
  `checkAccess()` in `@loudibly/core/auth/guards`, which returns a reason that each app's router
  maps to its own routes. Views get their data and flows from `@loudibly/core/composables/*`
  (user, accounts, prices, transactions, KYC, transfer/deposit/withdraw, cards, wallet reads and sends,
  sign-up, the claim link; password sign-in is `auth/signIn`, key handling `wallet/keys`)
  instead of calling `api/*` themselves: a `load()` throws when the request itself fails and
  the view decides what to show. It does not throw when the server refuses the read:
  `useAccounts().failed` says so, and a view must check it before showing an empty list as the
  user's; `useTransactions().failed` and `useKyc().failed` say the same for theirs. Opening a
  Didit session resets the stored KYC status, so a view offers `useKyc().start()` only when the
  status was read and is not approved or pending. `usePrices` gives a USD price per chain: 1 for USDT, `null` where there is none, so a
  value that cannot be priced is shown as unknown. Core holds no user-facing wording — a view passes its own text
  for each kind of failure (`FailureMessages` in `composables/queuedOperation.ts`) — and no
  routing. An operation the API only queues (`useWithdraw`, `useDeposit`) also says which kind
  of failure it was (`failure`: `rejected`, `failed`, `timeout`, `unexpected`) and the API's
  `errorCode` when it refused; a `timeout` is not a failed operation, so a view must not offer
  to send it again. Composables stop their own timers and sockets with `onScopeDispose`, so call them
  in `setup`.

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

Vue frontends (run from `web/`):
```
cd web
yarn install                          # one install for core + every app
yarn workspace loudibly dev
yarn workspace loudibly build         # vue-tsc -b && vite build (what CI runs)
yarn workspace noda dev               # same scripts for the NODA app
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

Four checks run locally with no deployed stack, all around custody keys:
`npx tsx scripts/checks/hdWallet.ts` (the derivation module, against published test vectors
and other libraries), `npx tsx scripts/checks/hdSigner.ts` (the signer),
`npx tsx scripts/checks/provisioning.ts` (account and master provisioning) and
`npx tsx scripts/checks/signing.ts` (withdrawals and sweeps, verifying whose key signed). The
last three run against in-memory stand-ins for AWS, Tatum and the chains
(`scripts/checks/standIns.ts`). Run them after touching
provisioning, signing, the withdrawal or sweep handlers, or upgrading `@noble/*` or `@scure/*`.

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
sitting in front of `/accounts/*`, `/payments/*` and `/merchants/*` (`resultsCacheTtl: 0`, so it
runs on every call — no caching). It accepts either a Cognito JWT (end users, role `user`; Cognito
group `staff` → role `staff`, Loudibly employees; group `merchant` → role `merchant`, a merchant's
own team who approve its treasury operations — precedence staff > admin > merchant > user) or an HMAC
`Signature <timestamp>:<bodyHash>:<sig>` over `X-Project` (B2B platform keys stored in
`v1UserKeysTable`, role `admin`). One key per merchant: `X-Project` is the merchant id —
onboarding takes `merchantId` from it (never the body), rejects unknown/inactive merchants with
`100040`, and stamps it on the payer's profile and account rows. Every account belongs to a
merchant: the system's own direct customers belong to `internal-001`, named `Internal001`
(`SYSTEM_MERCHANT_ID` in `utils/systemMerchant.ts`, no API key; it was `loudibly` before
2026-10-06, and accounts created before then keep that id and its seeds), which `/accounts/account` uses as the default. `/webhook/*` has **no authorizer at all** — routes that need
to be publicly callable but also need auth must live under `/accounts/` or `/payments/`
instead, not `/webhook/`.

**Provider abstraction pattern.** Payment processing (`providers/payment/`), the crypto ledger
(`providers/ledger/`, Tatum), KYC (`providers/kyc/`, Didit), and email (`providers/email/`,
SES) are each defined as a TS interface plus one or more concrete implementations, selected at
runtime by config rather than hardcoded per route (see `PaymentProcessor` /
`PaymentProcessorConstructor` in `providers/payment/PaymentProcessor.ts` for the shape). When
adding a new payment or ledger provider, implement the existing interface rather than
special-casing the new provider in route handlers. When a master signs (token withdrawals),
`withdrawFunds` debits both the customer's VA and the master's VA (`masterAccountId`, `fee: 0`) and
completes both with the same txId, so `master VA = Σ customer VAs + fee VA` stays true; token debits
record no fee (gas is rented TRX). `withdrawFunds` reverts its Tatum debits only
when the tx provably never reached the chain (failed before broadcast, or the node refused it);
an ambiguous broadcast throws `BroadcastUncertainError` and nothing — ledger or app balance —
may be refunded automatically, since the coins may already have left.

**Account provisioning undoes itself.** `provisionCustodialAccount` (`utils/custodialAccount.ts`)
creates the Tatum VA, then takes the next address under the merchant's seed, and on any failure
cancels the subscription, removes the address and deactivates the VA (an unused address only skips
an index). It writes nothing, so a caller whose
own write then fails must call `discardProvisionedAccount(provider, account, writeError)`.

**DynamoDB is single-table-ish per concern**, all defined in `amplify/backend.ts` (not in
`amplify/data/resource.ts` — that file only has an unrelated placeholder `User` model on the
Amplify Data/AppSync side, not the real schema). Key tables: `v2CustomerTable` (composite
`id`/`sk`, one row per fact — `USERPROFILE`, `MAPPING`, `CLAIM`, `IDEMPOTENCY` — see the
onboarding doc for the exact key shapes; `USERPROFILE` carries `merchantId`, KYC and tier, so
update it in place — never `putItem` over it), `v1UserKeysTable` (B2B API keys),
`v1AccountBalanceTable`, `v1PaymentTransactionLogsTable` / `v1TransactionLogsTable`,
`v1WebSocketConnectionsTable`, `v1WebhookIPWhitelistTable`, `v2BinCacheTable`, `v1MerchantTable`
(`id` = merchant id, `sk` = `PROFILE`; registered by staff via `/merchants/register`; plus
`MASTER#<currency>` and `FEEVA#<currency>` per currency, created by the resumable
`provisionMerchantMaster` in `utils/merchantMaster.ts` — masters have a Tatum VA with their
address assigned but deliberately **no** webhook subscription; sweeps and token withdrawals find
them with `getMasterAccount(account.merchantId, currency)`, `ready` rows only — the old SSM
`USDT_TRON_MASTER_ACCOUNT_NUMBER` is no longer read; team members are `MEMBER#<sub>` (roles,
status — the only place roles live) plus `USER#<sub>`/`MEMBERSHIP` (their one merchant, looked
up from the caller, never the body); `POLICY#TREASURY_SEND` holds per-currency thresholds;
treasury requests are `REQ#req_<epoch ms>_<rand>`, so they sort by time). Never call
`table.grant*(backend.mainApiFn…)`: `mainApiFn` is in the `data` nested stack while the tables are in
`loudibly-stack`, so a table-ARN grant creates a circular stack dependency and the deploy fails —
`mainApiFn` already has `dynamodb:*` on `*`. Writes that must
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

**Queue messages are not trusted.** The webhook processor (`fn/sqs-processor/webhook/handler.ts`)
routes each record by the queue it was delivered from (`eventSourceARN`), not by the `queue` field
in its body, and drops a body that names another queue. Routes build queue messages field by
field — never spread a request body into one (see `routes/payments/process.ts`). The withdrawal and
sweep handlers load the account from DynamoDB (`findAccountForUser`, `findAccountByAddress` in
`utils/custodialAccount.ts`) and take the key, address, merchant and chain from it; never sign with
a key reference taken from a message.

**Custody keys are derived (HD) wallets.** Every custodial account and merchant master is a numbered
address under its merchant's seed: one seed per merchant per network, `internal-001` for direct
customers. A record has `keyModel: 'hd'` and `derivationIndex`; there are no per-account KMS keys
any more, and a leftover record with only a `kmsKeyId` has nothing that can sign for it.
`utils/hdWallet.ts` derives addresses and signs from a seed (pure code). `fn/hd-signer/handler.ts`
is the only code that reads a seed: a recovery phrase kept as an SSM SecureString under
`/loudibly/hd-seed/` under its merchant's KMS key (one per merchant, shared by its networks),
whose policy lets only `HdSignerRole` decrypt. `v1MerchantTable` holds that key's id on a
`SEEDKEY` row and `SEED#<network>` rows with the key id, parameter name and `nextIndex`, never
secret material. Two Lambdas run that handler: `hdAddressFn` (`createSeed`, `allocateAddress`;
only `mainApiFn` may invoke it) and `hdSignerFn` (`sign`; only the queue processor may); callers
go through `utils/hdSigner.ts`. A merchant's seeds are created at `/merchants/register`, and
otherwise the first time one of its accounts or masters needs one, so no script has to be run.
The `internal-001` `PROFILE` row is created by each deploy if it is missing (`SystemMerchant` custom
resource in `backend.ts`). What a fresh environment still needs by hand is one
`/merchants/masters/provision` call per token. Anything that signs
goes through `utils/signing.ts`: `accountKeyRef(record)` (or `getMasterAccount(...).key`) names the
record, and `signTron` / `signSol` ask the signer, which reads the seed and index itself. Never
build that reference from a queue message. A token account needs its merchant's master (its
deposits are swept there, its withdrawals are signed by it): routes call `canHoldCurrency()`
(`utils/masterAccount.ts`) before creating anything and answer `100050` when there is none, and
`provisionCustodialAccount` refuses too. Keep the split between the two Lambdas: the API must
never be able to obtain a signature, and nothing outside the handler may read the seed path. A
seed has no backup copy yet (B31 step 7), which must exist before any mainnet seed.

**Error codes are centralized but not exhaustive.** `amplify/errors/http.ts` maps numeric
`error_code`s to messages via `processError(code, params)`. Calling it with a code not in the
`httpErrors` map throws instead of returning a 400 — check the map before reusing a code, and
add new codes there rather than inlining error responses in handlers.

## Frontend notes

- `src/App.tsx` does manual path-based routing (`window.location.pathname`), no router
  library — it's wrapped in Amplify's `<Authenticator>` and an `EvervaultProvider` (Evervault
  handles card-data encryption client-side before it reaches the backend/Stripe).
- `web/apps/loudibly` uses `vue-router` with route `meta.custodialOnly` / `meta.walletOnly` guards
  (see `web/apps/loudibly/src/router/index.ts`) to separate the Cognito-backed custodial dashboard from
  the non-custodial, client-key wallet screens — check which mode a view belongs to before
  wiring in Cognito-only or chain-only calls.
- Root app deploys to `/`, the Loudibly Vue app deploys to `/v2/` (`createWebHistory('/v2/')`);
  the Amplify build copies `web/apps/loudibly/dist` into `dist/v2` (`amplify.yml`). The NODA app
  is copied to `dist/noda` the same way, for testing. Each sub-folder app needs its own rewrite
  rule in the Amplify console, above the general rule that sends every address without a dot to
  the root app (NODA's: `</^/noda(/[^.]*)?$/>` to `/noda/index.html`, type 200). Without it,
  that app's addresses show the root app.
- Calls to the backend go through `@loudibly/core/api/*` — add new endpoints there rather
  than calling `fetch` from a view.

## Conventions

- Lint config (`eslint.config.js`, based on `neostandard`) deliberately turns off
  space-before-function-paren, quote-props, and a few stylistic rules to match existing code
  style — don't "fix" those in unrelated diffs.
- `evFunctions/` holds Evervault-hosted functions, deployed independently via the Evervault
  CLI only when files under that path changed (see the conditional block in `amplify.yml`).
- Standalone scripts live under `scripts/`, not the repo root: `setup/`, `migrations/`,
  `cleanup/`, `incidents/` are CloudShell runbooks against live AWS/Tatum (dry run by default,
  `--commit` to write); `tron-lab/` holds local testnet experiments run with `npx tsx`;
  `checks/` holds checks that run locally with no deployed stack (see Commands).
