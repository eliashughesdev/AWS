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
    production (see `amplify.yml`). Its `/merchants` page (`MerchantsView`, `staffOnly`, linked
    from `MainLayout` only when `getRole()` is `staff`) is for Loudibly employees: every merchant
    with its currencies, "Add currency" and, on a row left `provisioning`, "Finish" (the same
    request, which can be sent again). `RegisterMerchantDialog` registers one and keeps the
    answer, API key included, in its own state: the view mounts it with `v-if`, so the key goes
    when it closes, and once a key or an unknown result is on screen it closes only through its
    own button. A 4xx from `/merchants/register` is answered before anything is written, so the
    form can be sent again; any other failure is shown as unknown, with "Check the list" and no
    retry. `src/merchants.ts` holds the currency labels and status pills the two share.
  - `web/apps/noda/` (workspace `noda`) — NODA's own design. `amplify.yml` builds it with
    `--base=/noda/` into `dist/noda` on every branch, beside the root app and `/v2/`, so its files
    are always served from `/noda/`. Its addresses start there too, unless the branch sets
    `VITE_ROUTER_BASE` (`/` on `nodapay_ui`, so `my.noda.money` has them at the site root, with
    the console rules sending them to `/noda/index.html`). Nothing in the app names the
    prefix: the router takes `VITE_ROUTER_BASE`, or else the build's `import.meta.env.BASE_URL`.
    Built so far: the header, navigation
    and footer (`TopNavLayout`, which also draws each page's heading and subtitle from the
    route's `meta.title` / `meta.subtitle`; a view puts a control beside the heading by wrapping
    it in `PageAction`),
    Convert, Payments and Earn, whose
    content is all mockup data kept in `src/placeholders/`. Accounts is real: it lists the
    user's accounts with their value in USD, opens new ones from the New Account dialog, which
    takes an optional name, and renames one from the pencil on its card (a blank name goes back
    to the account number). An account is shown everywhere under `accountLabel()`
    (`src/format.ts`): the name its owner typed, whole, or the account number cut short when they
    typed none. The backend then answers the number as the name, which is how `typedName()`
    tells the two apart. A typed name can be 40 characters long, so a line that shows one must be
    able to end in "…" (`min-w-0 truncate`, with a little vertical padding where the line is
    `leading-none`, or the letters' tails are cut). In a `DataTable` its cell also takes
    `contain-inline-size`: the table is as wide as its content, and a long name would widen
    every column. `src/coins.ts`
    maps a backend `chain` to the symbol, name and coin art shown, and names its network
    (`networkName()`, the test network's name unless the build is for mainnet). `src/format.ts` formats
    money, coin amounts, dates and relative times, and cuts an id or an address short; a value in
    USD that may have no price, or not be read yet, goes through its `usdValue()`, `usdSum()` and
    `priced()`. The Dashboard is real where the backend has
    something to show: the total in USD, one asset row per currency held, Recent Activity and
    the "KYC Verified" row, which starts Didit. `src/activity.ts` says what each backend
    transaction `type` shows as; a type it does not have is not listed. A list of rows asks
    `activityKinds()`, which also decides each `FEE` row: one that shares its account and `txId`
    with a listed row (a withdrawal) goes in that row's Fee column, and one with no such row (the
    fee of a TRX or SOL sweep to the merchant's master, or of a USDT address's activation) is listed as "Fee" (Recent Activity:
    "Network fee"), Completed and outgoing, when it is above 0. A free-bandwidth sweep's `FEE`
    row of 0 is not shown. The
    Dashboard's 30-day line, % changes, Security Score, stat cards and other achievements are
    still mockup data (`placeholders/dashboard.ts`). Transactions is real: every listed row of
    the user's crypto accounts, a search, three filters, and four totals that cover the chosen
    date range. It opens on the type and range given in the address
    (`/transactions?type=Deposit&range=all`). The user's side of From/To is the account's name. Its Fee column is real: a
    row shows the `FEE` row of the same account and `txId`, and a dash when there is none (of the
    listed rows only a TRX or SOL withdrawal is charged one; its row arrives with the chain's
    webhook, or from the receipt when the merchant's master sent it). A TRX or SOL account is also
    charged for each sweep of its deposits to the merchant's master, and a USDT account once, for
    activating its address: that fee is a row of its own,
    with a brown "Fee" badge, a dash in its Fee column and "—" as its To, and it counts in the
    totals like any row. The %
    line under each total is still mockup data (`placeholders/transactions.ts`). Deposit is real for the Crypto method: a dropdown with one line
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
    and Failed; its colours are `pills` in `src/tones.ts`, which the Dashboard's `ActivityItem`
    uses too. A dialog goes in `AppDialog` (a modal `<dialog>`), and what a list shows while it
    loads, when it is empty and when its read failed goes in `ListState`. Sign-in and sign-up at `/auth` are
    real: `AuthView` is Loudibly's screen without the non-custodial mode. So are the two screens
    the backend's emails link to: `/confirm` (`ConfirmView`, the "Confirm my email" link) and
    `/set-password` (`SetPasswordView`, the claim link). The three are public routes outside
    `TopNavLayout` with no Figma design yet, drawn with the app's own parts and following the
    theme: `AuthFrame` gives each the header's logo, the layout's page heading, a `panel` and the
    footer; their fields, links and buttons are the classes in `src/authForm.ts`; a new password
    is `PasswordField` (the eye, and the strength bar); and a screen with nothing to fill in (a
    link being checked, or one that failed) is a `ListState`.
    `AuthView` reads `email` (typed into the form) and `verified=1` (a line saying the address
    was confirmed) from the address: that is how a link screen hands on a visitor with no
    session. Both link screens forward with `router.replace`, so Back does not run a link again.
    `SetPasswordView` takes the token out of the address with `router.replace` too, never
    `history.replaceState`: vue-router writes the address it remembers back into the history
    entry on the next navigation. It says "This link cannot be used" for `100034`, `100035` and
    `100036` only; when the link could not be checked for any other reason it offers the check
    again, and when the request that sets the password fails it stays on the form. Its button
    is disabled only while that request runs: the browser's own hints say which field is empty
    or that the terms box is unticked, and the form says when the passwords differ. The avatar in `TopNavLayout` shows the user's initial and opens the sign-out menu. The
    sun and moon switch beside it flips the theme (`src/theme.ts`): dark is `main.css` as it
    stands, and light is `<html data-theme="light">`, whose values are all in
    `src/assets/light.css`. The browser keeps the choice and `index.html` applies it before the
    first paint. Light is done for every view and the shell (`docs/noda-light-theme-plan.md` has the measurements and the choices; mobile has no design and uses the desktop tokens), so a new view must be built in both themes. A colour that differs between the themes is a token
    with a value in both files, never a literal in a view. `text-white` is for text on a
    coloured fill; text that follows the theme is `text-ink` or inherits. What a colour cannot
    say takes the `light:` variant. A card is the `card` class, which also carries its light
    shadow. A section box is `panel` (`lg:panel` when only desktop draws it): a `card` inside one
    takes the inset colours, which differ from a card's own in light only. A quick-action tile is
    `tile`, and a small box inside a card is `chip`. A value shown in a box with a hairline
    (Deposit's chosen account, its address) is `value-box`. A text input is `bg-field` inside a
    `card-line` hairline, with `light:shadow-(--shadow-card)`: light draws it flat with a card's shadow. The box
    that holds an `<input>` shows the focus (`focus-within:border-accent`, which an error's `border-red!` still
    beats) and the `<input>` takes `outline-none`: the browser's ring around a bare input covers the caret of an
    empty field. Convert's inputs and dropdown buttons are `slot` and `select`
    (white and `#F3F9F9` in light), and its swap button is `bg-swap`.
    A `bg-cta` button says `text-white`, and `light:border-0` when dark gives it a hairline. `AppDialog` and `DataTable` are
    `panel`s, and an open `DropdownList` is a `card`. The line under a
    title inside a panel is `border-rule`, and a warning's text and icon are `text-warn-ink` (its
    border stays `border-yellow`). A class with literal gradient stops in `main.css` gets its light look in `light.css`
    (`:root[data-theme="light"] .card-glow`). `.button-outline` is solid in light, except inside a
    dialog, where it stays an outline beside the main button. `.bg-cta` runs at 82deg unless an
    element sets `--cta-angle`. A
    table goes in `DataTable`, which scrolls sideways inside `ScrollX` when it does not fit and
    takes controls for its title line in a `tools` slot and a list state or a button under its
    rows in an `after` slot; `QrCode` draws a QR code as SVG. A
    `\n` in `meta.subtitle` breaks the line on mobile only. Its git-ignored
    `brand-source/` holds the brand book and, in `figma/`, the screen designs (2x exports of a
    1440px and a 320px page; `figma/lightTheme/` has the light ones, desktop only) — build only
    what an image there shows. The design has no SVG
    icons: they are cut from those images as mask PNGs (`src/assets/icons/`, sizes in
    `src/icons.ts`, drawn by `AppIcon` in the text colour; its `mobile` prop names a second
    cut for below the `lg` breakpoint). One icon is not from the design: `pencil`, Material
    Symbols' "edit" made into a mask by `brand-source/tools/pencil-mask.cjs`. The coins are masks too (`src/assets/coins/`, cut by
    `brand-source/tools/coin-masks.cjs`): each is one ink on a flat disc, so `src/coins.ts` gives
    a coin its mask and a tone (disc colour and ink), and `CoinImage` draws the disc, the mark
    and a 1px ring that light does not have.
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
  maps to its own routes. A route marked `staffOnly` is for Loudibly employees: anyone else
  signed in gets `needs-staff`. The role comes from `getRole()` in `@loudibly/core/auth/role`,
  which reads the access token's `cognito:groups` with the authorizer's precedence. It only
  decides what is shown (the API checks the role itself), and a group given after sign-in is
  not in the token until it is renewed. Views get their data and flows from `@loudibly/core/composables/*`
  (user, accounts, merchants, prices, transactions, KYC, transfer/deposit/withdraw, cards, wallet reads and sends,
  sign-up, the claim link; password sign-in is `auth/signIn`, key handling `wallet/keys`)
  instead of calling `api/*` themselves: a `load()` throws when the request itself fails and
  the view decides what to show. It does not throw when the server refuses the read:
  `useAccounts().failed` says so, and a view must check it before showing an empty list as the
  user's; `useTransactions().failed` and `useKyc().failed` say the same for theirs.
  `useAccounts().create()` and `rename()` only send the request: the view decides what counts as
  success and reads the list again with `refresh()`. `useMerchants` (staff) works the same way
  with `register()` and `addCurrency()`. The merchant's API key is in `register()`'s result
  only, and core keeps it nowhere; a throw from `register()` does not mean no merchant was
  made, so a view must not simply offer to send it again. The currencies a build offers are
  `LEDGER_CURRENCIES` in `@loudibly/core/config`, ids only (Loudibly's `ReceiveView` and NODA's
  `newAccountChains` still write the same list out). Opening a
  Didit session resets the stored KYC status, so a view offers `useKyc().start()` only when the
  status was read and is not approved or pending. `usePrices` gives a USD price per chain: 1 for USDT, `null` where there is none, so a
  value that cannot be priced is shown as unknown. Core holds no user-facing wording — a view passes its own text
  for each kind of failure (`FailureMessages` in `composables/queuedOperation.ts`) — and no
  routing. An operation the API only queues (`useWithdraw`, `useDeposit`) also says which kind
  of failure it was (`failure`: `rejected`, `failed`, `timeout`, `unexpected`) and the API's
  `errorCode` when it refused; a `timeout` is not a failed operation, so a view must not offer
  to send it again. Every sign-in goes through `startSession()` in `auth/signIn`
  (`signInWithPassword()`, `useSignUp().confirm()` and `useClaim().setPassword()` do), never
  `signIn` from `auth/cognito`: Amplify refuses to sign in while the browser holds a session,
  even one whose user is gone, and `startSession()` ends that session first. `isSignedIn()`
  asks the browser only, while `checkAccess()` also reads the user's attributes from Cognito,
  so the two disagree about a session whose user is gone. `useClaim().setPassword()` makes two requests, the password and then the
  sign-in, and throws when either fails: `passwordSet` says which, and a view must not send the
  user to sign-in while it is false. Its failure results, and `verify()`'s, carry the API's
  `errorCode`. Composables stop their own timers and sockets with `onScopeDispose`, so call them
  in `setup`. An account's `kycRequired` says which money operations its merchant's KYC policy
  gates; a form whose operation is gated for a user who is not verified shows its app's
  `KycNotice` instead of its submit button (`verificationNeeded()`, `canStartKyc()` in
  `useKyc`), and words the API's `KYC_REQUIRED` (`100059`) itself. A status that could not be
  read gates nothing: the API decides.

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

Backend unit and regression tests run with Jest (`jest.config.js`, root):
```
yarn test                             # every amplify/**/*.test.ts
yarn test amplify/service/router      # one file or folder
```
A test sits beside the code it covers as `<name>.test.ts` (a route's schema tests beside its
JSON in `amplify/service/schemas/`). New functionality comes with its tests, and a fixed bug
with a test that fails without the fix, its name or comment pointing at the commit or bug id.
Tests never reach AWS, Tatum or a chain: stub a route's handler with
`jest.spyOn(routes.get(path)!.handler.prototype, 'execute')`, or mock the module. SWC compiles
them without type-checking, so run `npx tsc --noEmit -p amplify` too. The frontends have no tests.

Live verification is done with standalone scripts in `amplify/service/routes/e2e/**/*Test.ts` —
each one builds a signed request and `fetch()`s a **live, already-deployed** API Gateway URL
that's hardcoded in the file. Run one with `tsx`:
```
npx tsx amplify/service/routes/e2e/accounts/AccountsOnboardingTest.ts
```
These only work against a deployed stack (the target URL, e.g.
`https://<api-id>.execute-api.us-east-2.amazonaws.com`, is baked into each test file) — a
route added in code isn't reachable until `ampx pipeline-deploy` runs. Signing credentials for
these live in `amplify/service/routes/e2e/credentials.ts`. The account routes refuse an HMAC key,
so their scripts call as a signed-in test user through `e2e/userSession.ts` (`callAsUser()`,
`accountFor()`): set `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` to a user of main's pool, never
written into a file. They read the user's own account numbers and saved cards from the API.

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

**Everything goes through one Lambda.** `amplify/fn/api/handler.ts` → `router.ts`, whose
`routeList` holds `[path, { handler, method, schema | requiredParams, allowedRoles, params }]`
and becomes the `routes` map keyed `<METHOD> <path>`, so a path can have one route per method.
A path may be a template (`/accounts/{id}`, `service/routeMatch.ts`): `params` gives each
placeholder a pattern (a value it refuses answers `100031`), the handler gets the values as
`event.pathParameters`, and a path written as it is always wins over a template. Tests find a
route with `routeAt(path)`. A route with `idempotency` takes an `Idempotency-Key` header
(`utils/idempotency.ts`): the first request claims `IDEM#<caller>#<key>` in `v2CustomerTable`, a
retry of the same request gets its stored answer, another request on the key or one still
running gets 409 `100061`, and a handler that throws leaves its key claimed until it expires
(24 h, the table's `ttl`), never run again on its own. Each withdrawal and card deposit also has a record
on its user, `OP#<transactionId>` in `v2CustomerTable` (`utils/operations.ts`): the route writes it
`pending` before queueing (a withdrawal in the same `transactWriteItems` as its debit), and the
queue processors move it on with `settleOperation()` (completed, failed, requires_action, or
pending with a `stage` of `uncertain` or `credit-failed`), forward only and never throwing. It is
what an API caller reads for an outcome the browser gets over the WebSocket. To add an endpoint: create a handler class with an `execute(event,
context)` method under `service/routes/<area>/`, then add it to `routeList`. The router
does, in order: parse body (preserving `rawBody` for signature verification, e.g. Stripe
webhooks), RBAC check against `event.requestContext.authorizer.role` if `allowedRoles` is set,
then body validation. A route either names a JSON schema (draft-07, Ajv, `utils/schema.ts`), one
file per route in `amplify/service/schemas/` mirroring its path (`/accounts/details` →
`schemas/accounts/details.json`): a missing required field answers `100029`, any other mismatch
`100031` with the field. A GET route's schema describes its query string
(`queryStringParameters`, every value a string) instead. Or it lists `requiredParams`, the older top-level-only check
(`utils/params.ts`), whose handlers must still validate their own nested fields. Routes are being
moved to schemas one at a time; a new route gets a schema and its tests. `loadConfig()` (`utils/config.ts`) pulls parameters from SSM
into `process.env` on cold start / at most once a minute; env access after that is normal
`process.env.X`. It only adds and overwrites: a parameter deleted in SSM stays in a warm Lambda,
so a setting is undone by writing its old value, never by deleting it.

**Emailed links go through `frontendAppUrl()`** (`utils/config.ts`): `FRONTEND_URL` plus the
folder in `FRONTEND_APP_PATH` (unset means `/v2`, `/` the site root), with no trailing slash, and
`undefined` when `FRONTEND_URL` is unset. The confirmation email (`auth/custom-message/handler.ts`)
and the claim invite (`utils/claimInvite.ts`, used by onboarding, its resend and
`/merchants/members-invite`) append `/confirm` and `/set-password` to it; a new link into a UI
does the same and never writes a folder itself. Stripe's 3-D Secure return uses `FRONTEND_URL`
alone (the React pages), and Didit returns to `DIDIT_CALLBACK_URL`, a whole address of its own.

**Two auth paths, one authorizer.** `amplify/fn/authorizer/handler.ts` is a CDK-defined
`RequestAuthorizer` (not part of the Amplify-managed backend, added directly to `apiStack`)
sitting in front of `/accounts/*`, `/payments/*` and `/merchants/*` (`resultsCacheTtl: 0`, so it
runs on every call — no caching). It accepts either a Cognito JWT (end users, role `user`; Cognito
group `staff` → role `staff`, Loudibly employees; group `merchant` → role `merchant`, a merchant's
own team who approve its treasury operations — precedence staff > admin > merchant > user) or an HMAC
`Signature <timestamp>:<bodyHash>:<sig>` over `X-Project` (B2B platform keys stored in
`v1UserKeysTable`, role `admin`). The context also says `authType` (`jwt` or `key`, with
`merchantId` for a key): role `admin` alone does not mean a key, since the Cognito group `admin`
has it too. The card routes (`/payments/*`) take the user from `resolvePayer()`
(`utils/payer.ts`), never from the request: a user acts for themselves, a key only for its own
merchant's payers, anyone else gets `100053` (403). The account routes (`/accounts/*` that act on a
user) take the user from `callerUser()` (`utils/caller.ts`): a signed-in person only, never an HMAC
key, whose `userId` is the merchant id; anything else gets `100053` (403). Onboarding and its resend
take the merchant from `callerMerchant()`, the HMAC key's merchant only. Withdraw, transfer and card deposit
call `checkKyc()` (`utils/kycPolicy.ts`) once the account is the caller's and before anything
moves: the account's merchant's `POLICY#KYC` row says, per currency and operation, whether KYC
must be `Approved`; only a switch set to `false` turns it off (staff: `/merchants/policy/kyc`). One key per merchant: `X-Project` is the merchant id —
onboarding takes `merchantId` from it (never the body), rejects unknown/inactive merchants with
`100040`, and stamps it on the payer's profile and account rows. Every account belongs to a
merchant: the system's own direct customers belong to `internal-001`, named `Internal001`
(`SYSTEM_MERCHANT_ID` in `utils/systemMerchant.ts`, no API key; it was `loudibly` before
2026-10-06, and accounts created before then keep that id and its seeds), which `/accounts/account` uses as the default. `/webhook/*` has **no authorizer at all** — routes that need
to be publicly callable but also need auth must live under `/accounts/` or `/payments/`
instead, not `/webhook/`.

**Two REST APIs, one Lambda.** `loudiblyRestApi` is the internal one: `{proxy+}` under
`/accounts`, `/payments`, `/merchants`, `/webhook` and `/onboarding`, used by staff tools and
provider webhooks (and, for now, the frontends). `loudiblyPublicApi` faces the public internet
for merchant platforms and signed-in users: it has one resource per route in
`amplify/service/publicRoutes.ts` and nothing else, with the same authorizer function and stage
name `v1` (HMAC callers sign the path, `/v1` included). Its stage variable
`API_SURFACE=public` makes the router answer 404 to any route not on that list. To expose a
route publicly, add it to `publicRoutes` with the permission an API key needs to call it
(`amplify/service/permissions.ts`; `any` for every key, `null` for none) and document it in
`docs/openapi/public-api.yaml`;
staff (`/merchants/*`) and `/webhook/*` routes never go there. That document is rendered per
branch, with the branch's URL, coins and brand, into `docs/openapi/branches/<branch>/` by the
`api-docs` project skill (`.claude/skills/api-docs/`; wording and look in its `branding.yaml`).

**Provider abstraction pattern.** Payment processing (`providers/payment/`), the crypto ledger
(`providers/ledger/`, Tatum), KYC (`providers/kyc/`, Didit), and email (`providers/email/`,
SES) are each defined as a TS interface plus one or more concrete implementations, selected at
runtime by config rather than hardcoded per route (see `PaymentProcessor` /
`PaymentProcessorConstructor` in `providers/payment/PaymentProcessor.ts` for the shape). When
adding a new payment or ledger provider, implement the existing interface rather than
special-casing the new provider in route handlers. TRON energy and bandwidth rental
(`providers/energy/`) has the same shape: an `EnergyProvider` per vendor (`catfee/`, energy only
and at least 65,000; `tronsave/`, both resources, at least 64,000 energy or 1,000 bandwidth) and
the shared logic in `ensureResources.ts`, which tries them in the order `TRON_ENERGY_PROVIDERS` names (SSM, default `catfee,tronsave`; a
name it does not know logs `CONFIG_ERROR`). `ensureEnergy` and `ensureBandwidth`, which a TRC-20
transfer's signer goes through, rent the address's shortfall plus 1%, raised to the provider's
`minimum()`, and poll the address until it arrives (2 s, up to the provider's `deliveryTimeoutMs`:
CatFee 60 s, TronSave 120 s); bandwidth is burned instead when the address's TRX covers it. A
provider's `rent()` answers `refused` only when it will deliver nothing (a missing setting, a
failed quote, a definite refusal), and the next provider is tried, as it is when a placed order's
`orderState()` says it failed (CatFee's `DELEGATE_FAIL`). A `rent()` that throws, or a wait that
runs out, may leave an order behind, and then no other provider is tried. CatFee answers its
errors as HTTP 200 with a `code`, and sends an unclear create once more with the same
`client_order_id`, which never makes a second order. Each rental logs `ENERGY_RENTED` and each
move to the next provider `ENERGY_FALLBACK`; CatFee's settings are `CATFEE_BASE_URL`,
`CATFEE_API_KEY` and `CATFEE_API_SECRET`. Nothing can be rented to an address that was never
activated: before renting, `ensureEnergy` checks it once (`isTronAccountActive`) and activates it
only when given `onActivated`, which only a token sweep passes (through `sendOnChain`); otherwise,
as for a master signing a withdrawal, it logs `CONFIG_ERROR` and throws. CatFee activates with the
order (`activate=true`; it charged `activate_amount_sun` when `activate_status` is `ACTIVATE` or
`ACTIVATED`). TronSave quotes, then runs its legacy v0 `is-active-address-check` and
`multi-active-address` (1.5 TRX) and reads the chain for up to 30 s before buying. A provider calls
the hook as soon as it has paid, whatever then happens to the order, and logs `ADDRESS_ACTIVATED`;
`activationSun` is each one's published price. When a master signs (token withdrawals, and
native ones once the merchant has a `ready` master for the coin), `withdrawFunds` debits both the
customer's VA and the master's VA (`masterAccountId`, `fee: 0`) and completes both with the same
txId, so `master VA = Σ customer VAs + fee VA` stays true; token debits record no fee (gas is rented
TRX). A master-signed native withdrawal's fee is read from its receipt instead, since a master has
no subscription and no fee webhook comes: after telling the user it was sent, the withdrawal handler
polls `getTransactionFee` every 3 s for up to 90 s, writes the customer's `FEE` row as the fee
webhook does, and takes the fee off both VAs with `debitFee` (an offchain withdrawal completed with
the same txId; none when the fee is 0). What it cannot settle is logged as `CRITICAL
FEE_UNSETTLED` and never rolled back. A native withdrawal sent from the customer's own address
still sends Tatum the fixed `WITHDRAWAL_FEES` and gets its `FEE` row from the webhook.
`/accounts/withdraw` rounds the amount to the coin's decimals (`decimalsFor()` in
`utils/currencies.ts`, which `withdrawFunds` uses too) and requires a native coin's available
balance to cover the amount plus its `FEE_RESERVES` (TRON 1, SOL 0.000005, core's
`withdrawalFeeReserve` numbers), while debiting only the amount. `withdrawFunds` reverts its Tatum debits only
when the tx provably never reached the chain (failed before broadcast, or the node refused it);
an ambiguous broadcast throws `BroadcastUncertainError` and nothing — ledger or app balance —
may be refunded automatically, since the coins may already have left. A native transfer's exact
fee comes from `chains/tron.ts` (`tronBandwidthBytes`, the bytes java-tron charges once signed,
and `tronBandwidthFeeSun`: 0 when staked or free bandwidth alone covers every byte, else bytes ×
the `getTransactionFee` chain parameter; activating an address costs 1.1 TRX on top) and
`chains/solana.ts`. `buildTronSweep` and `buildSolanaSweep` build, unsigned, the transfer of an
address's whole balance minus that fee, and the provider's `sweepAll` signs and broadcasts that
very transaction (`null` when the balance can't pay the fee). `estimateTronBandwidth` pads 100 bytes to size rentals and
is never a fee. What the chain did charge is `getTransactionFee({ chain, txId })`, in the
network's coin, and `null` until the transaction is in a block. `/accounts/transfer` moves
only the ledger, so it refuses two accounts of different merchants (compared as
`merchantId ?? SYSTEM_MERCHANT_ID`, so the pre-rename `loudibly` is not `internal-001`): coins
move to another merchant's customer as a withdrawal. The refusal is `100001`, the answer for an
account that does not exist, and comes before the currency check, so a caller cannot tell that
another merchant's account exists (D11).

**Account provisioning undoes itself.** `provisionCustodialAccount` (`utils/custodialAccount.ts`)
creates the Tatum VA, then takes the next address under the merchant's seed, and on any failure
cancels the subscription, removes the address and deactivates the VA (an unused address only skips
an index). It writes nothing, so a caller whose
own write then fails must call `discardProvisionedAccount(provider, account, writeError)`.

**An account's name is optional.** `name` is on the `ACCOUNT#` row only when its owner typed one:
`accountName` on `/accounts/account` (optional, 40 characters at most, trimmed), or
`/accounts/rename`, which is keyed on the caller's user id and removes the name when sent a blank
one. `/accounts/list` and `/accounts/details` answer `name ?? accountNo`, so a client never gets
a missing name. `accountName` no longer names the person: the profile a first account creates has
no `name` until `/accounts/profile/save` gives it one. `updateItem` (`utils/db.ts`) sends no
`ExpressionAttributeValues` when it has none, which a bare `REMOVE` needs.

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
treasury requests are `REQ#req_<epoch ms>_<rand>`, so they sort by time). The table has no
index: `/merchants/list` (staff) answers every merchant with its currencies by scanning it
(`scanItems` in `utils/db.ts`), which is fine only while it is small. Never call
`table.grant*(backend.mainApiFn…)`: `mainApiFn` is in the `data` nested stack while the tables are in
`loudibly-stack`, so a table-ARN grant creates a circular stack dependency and the deploy fails —
`mainApiFn` already has `dynamodb:*` on `*`. Writes that must
be atomic (e.g. idempotent transaction creation) go through `transactWriteItems` in
`utils/db.ts`, which supports a per-item `conditionExpression` (e.g.
`attribute_not_exists(id)`) — use this instead of a plain multi-item write whenever two records
must succeed or fail together. A balance in `v1AccountBalanceTable` only ever moves by a relative
update (`SET #balance = #balance + :delta`), never a value read and written back, which loses a
concurrent change (B4). A queue handler moves one with `applyBalanceChange` (`utils/balance.ts`),
which first claims `TX#<txId>` on the account, so a transaction applies once.

**Async work is queue-driven.** Four SQS queues (`v1WebhookQueue`, `v1GeneralQueue`,
`v1PaymentProcessingQueue`, `v1WithdrawalProcessingQueue`, `v1AccountBackfillQueue`) feed two
processor Lambdas (`fn/sqs-processor/webhook`, `fn/sqs-processor/general`); a DynamoDB Streams
Lambda (`fn/stream/handler.ts`) reads changes from `v1UserKeysTable`, `v2CustomerTable`, and
`v1WebhookIPWhitelistTable`; it only logs each one's event, table and keys, and publishes nothing
yet. The streams are `KEYS_ONLY` (PCI F4): a stream that carries images hands merchant keys and
card rows to whatever reads it, so a consumer that needs a row reads it from the table itself.
The handler must return for every batch, or Lambda retries the same records for 24 hours. Still
never write a secret (e.g. a plaintext claim token) into a table; store a hash instead (see how
`utils/claimToken.ts` is used in `routes/accounts/onboarding.ts`).

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
`provisionCustodialAccount` refuses too. A token sweep sends the address's whole token balance
(`getOnChainBalance`, a `balanceOf` dry run), so coins an earlier sweep left go with the next. A
deposit address that was never activated is activated by its sweep, and the customer pays for it
(`docs/energy-rental-plan.md` D6, D7). Before claiming, the sweep handler reads the TRX price from
Binance.US (`fetchCryptoPrice`) and the customer's `availableBalance`. While that balance is below
the dearest provider's activation (`maxActivationSun()`) at that price, it logs `SWEEP_WAITING` and
claims nothing, and the coins wait for the next deposit's sweep. Once a provider has paid, the
activation's sun × that price, rounded up, becomes a `FEE` row keyed `activation-<address>` and comes
off the balance (`applyBalanceChangeOnce`, so a second report charges nothing). `transferFunds` then
moves it from the customer's VA to the merchant's fee VA (`getFeeAccountId`). It logs
`ACTIVATION_CHARGED`, or `CRITICAL FEE_UNSETTLED` for what it could not settle. A native coin needs none yet, but a `ready` TRON or SOL
master (`/merchants/masters/provision` takes both) switches that coin over for its merchant: it
signs the withdrawals, and each deposit queues a sweep. A native sweep sends the address's whole
balance minus the exact fee (`sweepAll`), leaving 0, and the customer pays the fee: the fee
webhook writes their `FEE` row and `debitFee` takes it off their VA (Tatum credits the master VA
by itself). It runs only once a person has activated the TRON master, or put the rent-exempt
minimum on the SOL one (`canReceiveSweep`); until then it logs `CONFIG_ERROR` and claims nothing.
What the person sent stays on the master as its `float`, recorded on the `MASTER#` row. Coins
already on a customer's address move with its next deposit, or when
`scripts/migrations/cutover-native-sweep.sh` queues a sweep for them. Run it in each environment
right after its native masters are provisioned and funded. It also prints the provision calls and
what to send, records the `float`, and reports the master plus the coins still on addresses
against DynamoDB and against Tatum. Until those coins are swept, a withdrawal is signed by a
master that may hold too little (it fails cleanly and is refunded; `docs/native-sweep-plan.md`).
Keep the split between the two Lambdas: the API must
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
  is copied to `dist/noda` the same way. Every branch builds all three, and each Amplify console's
  rewrite rules decide which one an address shows. The rules are kept in each console only; no
  file in the repo holds them. Order matters: the first matching rule wins.
- Staging (`main`): `/` answers 302 to `/noda/`; `</^/v2/[^.]+$/>` goes to `/v2/index.html` and
  `</^/noda(/[^.]*)?$/>` to `/noda/index.html` (type 200), both above the general rule that sends
  every other address without a dot to the root app. The old UI's rule wants a character after the
  slash, so the bare `/v2/` shows the root app. `FRONTEND_APP_PATH` is `/noda`.
- Production (`nodapay_ui`, `my.noda.money`, since 2026-10-13): NODA at the site root, no `/v2`.
  In order: `</^/noda(/[^.]*)?$/>` 301 to `/` (old links); `</^/(customer|payment)(/[^.]*)?$/>`
  to `/index.html` (the root app's card and KYC pages, 200); `</^[^.]*$/>` to `/noda/index.html`
  (200, `/` included); `/<*>` to `/noda/index.html` (404-200). The branch sets
  `VITE_ROUTER_BASE=/`, and SSM has `FRONTEND_URL=https://my.noda.money` and `FRONTEND_APP_PATH=/`.
  The two go together: a build with the variable under the old rules, or the reverse, breaks the
  site. CloudFront keeps each answer for a year (`s-maxage`), and only a deployment clears it, so
  after changing the rules start a build of the branch, or addresses already opened keep their old
  answer.
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
  `checks/` holds checks that run locally with no deployed stack (see Commands); `ci/` holds what
  `amplify.yml` runs. `ci/backend.sh` deploys the backend only when `amplify/`, the root
  `package.json` or `yarn.lock` changed since the branch's last deploy (a hash of them is kept in
  SSM at `/amplify/ci/<appId>/<branch>/backend-inputs`); otherwise it only writes
  `amplify_outputs.json`. So nothing in `amplify/` may read the environment at synth time, or a
  console change would go undeployed: when one must, set `FORCE_BACKEND_DEPLOY=true` on the branch.
  `ci/node.sh` picks the image's Node 20 instead of installing one.
