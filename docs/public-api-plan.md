# Public API and API keys — implementation plan

**How to use this file.** Part 1 is the work, in the order to do it. Tick a step when it is
merged and its checks pass: `- [x] **2.3** … — done 2026-10-20, a1b2c3d`. A step in progress
gets `(in progress)` after its title. Part 2 is the design each step points to (`→ D6.3`);
change the design there, not in the steps. Part 3 is what stays out of the API and why.

Every step ends with `yarn test` and `npx tsc --noEmit -p amplify` (backend), the touched
apps' builds (`yarn workspace noda build`, `yarn workspace loudibly build`), a test beside
each new route, and its schema. A step that changes `amplify/` is deployed to `main` before the
next one that depends on it is started.

**Milestones**
- **M1 — API keys live** (end of phase 3): users create keys in NODA and Loudibly and call
  today's public routes with them.
- **M2 — Public API v1** (end of phase 5): everything a user can do in the web UI, as `/v1`
  endpoints with idempotency, polling for results and OpenAPI.

---

# Part 1 — Steps

## Phase 0 — Decide

- [x] **0.1 Confirm the decisions** in D1 (who owns keys, hash in SSM, Basic auth, rate
  limits, permissions, cards added by API or not). Anything changed is edited in Part 2 first. — done 2026-10-14
- [x] **0.2 Confirm the coverage table** (D0.2): every UI feature listed there gets an
  endpoint; nothing in Part 3 does. — done 2026-10-14

## Phase 1 — Foundations

- [x] **1.1 Who is calling: `utils/caller.ts`.** `callerUser(event)` for routes that act on a
  user; refuses `authType: 'key'` (the HMAC merchant id is not a user — the bug in D0.1).
  Switch `list`, `account`, `rename`, `details`, `transactions`, `transfer`, `deposit`,
  `withdraw`, `profile*`, `kyc*` to it; drop `account.ts`'s `?? crypto.randomUUID()`.
  Add `callerMerchant(event)` (merchant id from HMAC or a merchant key) and switch
  `onboarding.ts` and `onboarding-resend.ts` to it. Tests: each user handler refuses an HMAC
  caller; onboarding behaves as before with HMAC. → D3, D9 — done 2026-10-14, d57d316 (e2e scripts
  moved to a signed-in test user: 446d1c1); not deployed yet
- [x] **1.2 Permission catalogue.** `amplify/service/permissions.ts` (no imports)
  and a `permission` on each `PublicRoute` with `auth: 'custom'`: a permission name, `any` for a
  route every key may call (`GET /v1/me` only), or `null` for one no key may call
  (`/payments/save`, D1.9). Only on `PublicRoute`, not the router's `Route`: a key is refused
  off the public API (D2.4), so only public routes need one, and the router reads it from
  there in 2.5. Tests: every public route names a known permission, `any` or `null`; merchant
  routes name merchant permissions; money-moving routes name a Move money one. → D5 — done 2026-10-14, f0cd87e
- [x] **1.3 Path parameters in the router.** Match `event.path` against templates
  (`/accounts/{id}`, static paths first), check each value against the route's pattern
  (`params`, `100031`) and hand it on as `pathParameters`; exact paths keep working. Routes are
  keyed by method and path, so `GET` and `PATCH /accounts/{id}` can both exist; `PublicRoute`
  takes `PATCH`. Router tests. → D6.2 — done 2026-10-14, eda9040
- [x] **1.4 Idempotency helper.** `utils/idempotency.ts`: `Idempotency-Key` header →
  `id=<caller>#<key>`, `sk=IDEMPOTENCY` in `v2CustomerTable` with the first response, 24 h TTL;
  same key + different body → 409; a request still running → 409 "in progress". Today's
  `transactionId` is only a label, so a retried withdrawal sends twice. Tests. → D6.1 — done 2026-10-14, cf59092
- [x] **1.5 Operation records.** `/accounts/withdraw` and `/accounts/deposit` write
  `id=<userId>, sk=OP#<opId>` in `v2CustomerTable` (`kind`, `status: pending`, account, amounts,
  destination) before queueing — for a withdrawal in the same `transactWriteItems` as the debit;
  the withdrawal and payment processors set `status`, `txHash`, `fee`, `code` on it when they
  write their log row. Today nothing is written until the processor finishes, so a queued
  operation cannot be looked up; the web UI learns results over the WebSocket, an API caller
  has none. The UI is unchanged. Tests incl. queue failure (record marked failed with the
  rollback). → D6.4 — done 2026-10-14, 20a5490

- [x] **1.6 KYC policy, backend.** `POLICY#KYC` row per merchant in `v1MerchantTable`;
  `utils/kycPolicy.ts` (`kycRequired(merchantId, currency, operation)`, unset = required);
  `/accounts/withdraw`, `/accounts/transfer` and `/accounts/deposit` refuse with 403 `100059`
  when the account's merchant requires KYC for that currency and operation and the caller's KYC
  is not `approved`, before anything is debited or queued; staff `POST /merchants/policy/kyc`;
  `/merchants/list` answers each merchant's policy; `/accounts/list` answers `kycRequired` per
  account. Schemas, tests (each operation × required/not × approved/not; unset is required).
  Deploy together with 1.7: the default blocks every unverified user. → D11 — done 2026-10-14,
  0b78517; not deployed (waits for 1.7)
- [x] **1.7 KYC policy, frontends.** Loudibly Merchants: a KYC section per merchant, one switch
  per currency and operation. NODA and Loudibly Withdraw, Transfer and Deposit (card): when the
  chosen account has `kycRequired` for the operation and the user is not verified, say so and
  offer verification (`useKyc().start()` under its usual rule) instead of the submit button;
  `100059` from the API worded the same way. Both themes, mobile. → D11 — done 2026-10-14,
  37901dc; not deployed, and not yet checked in a browser (needs 1.6 on staging and a test user)

## Phase 2 — API keys, backend

- [x] **2.1 Infrastructure.** KMS key `alias/loudibly-api-keys`, SSM path
  `/loudibly/api-keys/*`, `apiKeyIssuerFn` + role, explicit DENY for `mainApiFn`, authorizer
  read/decrypt, tables `v1ApiKeysTable` (GSI `byOwner`) and `v1ApiKeyUsageTable` (TTL).
  Deploy to `main`. → D2.1 — done 2026-10-15, bfaac56
- [x] **2.2 Issuer Lambda.** `create` (id + secret, hash to SSM, row, secret returned once) and
  `revoke` (delete parameter, mark row). Tests with SSM/DynamoDB mocked. → D2.1, D2.2 — done
  2026-10-15, fe79afe. Permissions are a sorted list, not a set.
- [ ] **2.3 Authorizer `Basic` branch.** Row check, IP allowlist, cached hash, constant-time
  compare, owner still active (user, or merchant `active`), context `authType: 'apikey'`,
  `ownerType`, `permissions`, `keyId` (+ `merchantId` for a merchant key). Audit the
  authorizer's logs (no headers, no `res` objects). Tests incl. the old JWT/HMAC cases. → D2.3
- [ ] **2.4 Rate limiting.** Conditional counters in the authorizer, `throttled` in context,
  SSM default `API_KEY_DEFAULT_RPS`, public stage throttle 50/100 → 500/1000 (agreed
  2026-10-14). → D2.5
- [ ] **2.5 Router checks.** Key only on the public API (404), 429 with `Retry-After` and
  `X-RateLimit-*`, missing permission → 403 `100055`; `resolvePayer()` accepts a merchant
  `apikey` like HMAC (own payers only); `callerUser()` refuses a merchant key. KYC is not the
  router's: the routes check the KYC policy for keys and users alike (1.6). Error codes
  `100054`–`100062` (`100059` already from 1.6). Tests per check. → D2.4, D2.6, D5
- [ ] **2.6 Key-management routes.** `/accounts/api-keys/{permissions,create,list,update,revoke}`
  and staff `/merchants/api-keys/{create,list,rate-limit,revoke}` (staff create a merchant's
  keys), JWT only, schemas, tests. The owner is emailed when one of their keys is created or
  revoked (SES provider; a merchant key: the merchant's contact email). The email names the
  key and its id, never the secret; a failed send is logged and does not fail the request.
  → D2.6, D9
- [ ] **2.7 e2e** `amplify/service/routes/e2e/apiKeys/ApiKeysTest.ts` on `main`: create (JWT) →
  call `/accounts/list` with the key → missing permission 403 → burst 429 → revoke → refused;
  staff create a merchant key → `/accounts/onboarding` with it → the same key on
  `/accounts/list` refused.

## Phase 3 — API keys, frontends → **M1**

- [ ] **3.1 Core.** `api/apiKeys.ts`, `useApiKeys()`, `useStaffApiKeys()` (secret returned,
  kept nowhere). → D4
- [ ] **3.2 NODA API keys screen** — list, Create (form → secret once → unknown result), Edit,
  Revoke; avatar menu entry; both themes, mobile. → D7.1, D7.2
- [ ] **3.3 Loudibly** — the same for custodial users; staff `/api-keys` page (all keys,
  rate limit, revoke with reason) and an API keys section on each merchant in `/merchants`
  (create, list, revoke). → D7.3
- [ ] **3.4 Docs.** `apiKey` security scheme and rate-limit section in
  `docs/openapi/public-api.yaml`, `api-docs` per branch; CLAUDE.md (key model, secret rules,
  permission file, new views).
- [ ] **3.5 Production.** Deploy `nodapay_ui`, create a key, run the e2e against production.

## Phase 4 — Public API v1: reading

Each step: route(s) on the internal router and in `publicRoutes`, schema, permission, tests,
OpenAPI section. The old paths stay (HMAC callers sign them).

- [ ] **4.1 Conventions.** `utils/v1Response.ts`: `{ data }` / `{ data, nextCursor }`,
  errors `{ error: { code, message, field? } }`, `X-Request-Id`; cursor helper (opaque, base64
  of the last key). Tests. → D6.1
- [ ] **4.2 Me, profile, KYC.** `GET /v1/me`, `GET /v1/profile`, `GET /v1/kyc`. → D6.3
- [ ] **4.3 Accounts.** `GET /v1/accounts`, `GET /v1/accounts/{id}` (balance, available
  balance, address, network, name or `null`, `withdrawalFeeReserve`). → D6.3
- [ ] **4.4 Deposit address.** `GET /v1/accounts/{id}/deposit-address` (address, network,
  currency; a QR is the client's job). → D6.3
- [ ] **4.5 Transactions.** `GET /v1/transactions` across all the caller's accounts with
  `account`, `type`, `from`, `to`, `limit`, `cursor` (what NODA's Transactions page filters on),
  fee joined onto its withdrawal as `fee`; `GET /v1/transactions/{id}`. A paging query helper
  in `utils/db.ts`, also used by `/accounts/transactions`. → D6.3, D6.5
- [ ] **4.6 Rates.** `GET /v1/rates?currencies=TRON,SOL` from `utils/exchangeRate.ts` (the rate
  the withdrawal by fiat amount uses; the UI's Binance prices stay in the browser). → D6.3
- [ ] **4.7 Payment methods.** `GET /v1/payment-methods` (saved cards: id, brand, last four).
  → D6.3

## Phase 5 — Public API v1: acting → **M2**

- [ ] **5.1 Profile and KYC.** `PATCH /v1/profile` (name, email), `POST /v1/kyc/session`
  (Didit `verificationUrl`; refused when status is approved or pending, as the UI does). → D6.3
- [ ] **5.2 Accounts.** `POST /v1/accounts` (`currency`, optional `name`; `canHoldCurrency`
  answers `100050`), `PATCH /v1/accounts/{id}` (name; blank clears). Idempotent create. → D6.3
- [ ] **5.3 Transfers.** `POST /v1/transfers` (`from`, `to`, `amount` as a decimal string,
  same currency) with `Idempotency-Key`; `GET /v1/transfers/{id}`. → D6.3
- [ ] **5.4 Withdrawals.** `POST /v1/withdrawals/estimate` (fee reserve, rate, amount received,
  available); `POST /v1/withdrawals` (`account`, `amount` or `cryptoAmount`, `address`,
  `Idempotency-Key`) → `202 { id, status: 'pending' }`; `GET /v1/withdrawals[/{id}]` with
  `pending | completed | failed`, where an uncertain broadcast stays `pending`. Address shape
  checked server-side (the UI's `looksLikeAddress()`, moved to the backend). → D6.3, D6.4
- [ ] **5.5 Card deposits** (Loudibly's Deposit by card). `POST /v1/deposits/card` (`account`,
  `amount`, `currency`, `paymentMethod`, `Idempotency-Key`) → `202 { id, status }`;
  `GET /v1/deposits[/{id}]`. 3-D Secure: answer `requires_action` with the redirect URL the
  React page uses today. → D6.3, D6.4
- [ ] **5.6 Merchant endpoints.** `POST /v1/users`, `POST /v1/users/{id}/invite`,
  `GET /v1/users/{id}`, `GET /v1/users/{id}/payment-methods` over onboarding and
  `payments/list`, called with a merchant key (Basic). The HMAC paths stay as they are. → D6.3, D9
- [ ] **5.7 e2e** `amplify/service/routes/e2e/v1/PublicApiTest.ts` on `main` with a key: me →
  accounts → create account → deposit address → transactions page 2 → transfer (same
  idempotency key twice = one transfer) → withdrawal estimate → small testnet withdrawal →
  poll to `completed`; with a merchant key: create a user → invite → read it → another
  merchant's user is refused.
- [ ] **5.8 OpenAPI and production.** Every `/v1` endpoint in `docs/openapi/public-api.yaml`
  with examples (`curl -u`), regenerate per branch with `api-docs`, deploy `nodapay_ui`, run 5.7
  against production with a read-only key plus one small withdrawal.

## Phase 6 — Next, after M2

- [ ] **6.1 Outgoing webhooks** + `GET /v1/events` (signed, retried), so callers stop
  polling. → D8
- [ ] **6.2 Sandbox for API-key users** (`lk_test_`, simulated deposits and withdrawals).
- [ ] **6.3 Merchant self-service keys:** a merchant team member (`MEMBER#` admin) creates
  and revokes the merchant's keys, which needs a merchant UI. → D9
- [ ] **6.4 HMAC secrets out of DynamoDB** into SSM (migration with dry run / `--commit`). → D10
- [ ] **6.5 Each UI mockup that gets a backend** (Part 3) gets its `/v1` endpoint in the same
  change.

---

# Part 2 — Design

## D0. Where we start

### D0.1 Today

- One authorizer (`amplify/fn/authorizer/handler.js`) runs on every call (`resultsCacheTtl: 0`)
  and accepts a Cognito JWT (`authType: 'jwt'`, role from `cognito:groups`) or an HMAC/RSA
  signature over `X-Project` (`authType: 'key'`, role `admin`, `userId = merchantId`).
- The HMAC secret is stored **in plaintext** in `v1UserKeysTable.key`, created only by staff at
  `/merchants/register` and returned once.
- `loudiblyPublicApi` (stage `v1`) exposes 17 routes from `amplify/service/publicRoutes.ts`;
  the only throttle is its stage-wide `50 rps / 100 burst`, shared by every caller of it. The
  web apps call the internal API (`api.noda.money` in production), which has none.
- **Bug:** account routes read `requestContext.authorizer.userId` directly, so with an HMAC key
  `/accounts/list` or `/accounts/withdraw` acts on a "user" whose id is the merchant id (fixed
  in 1.1). Card routes go through `resolvePayer()`, which only knows `jwt` and `key`.
- The router matches exact paths only. `transactionId` on withdraw/deposit is a label, not an
  idempotency key. Withdrawal and deposit results reach the browser over the WebSocket only.

### D0.2 What the web UI does, and where it lands in the API

*Confirmed 2026-10-14.*

Custodial features only: the non-custodial wallet (Loudibly `/wallet*`) runs in the browser
against the chain and has no backend to expose.

| UI (app · screen) | What the user does | Route today | `/v1` endpoint | Permission | Step |
|---|---|---|---|---|---|
| both · avatar, Dashboard | see who they are | `GET /accounts/profile` | `GET /v1/me`, `GET /v1/profile` | any key / `profile:read` | 4.2 |
| Loudibly · profile | change name, email | `POST /accounts/profile/save` | `PATCH /v1/profile` | `profile:write` | 5.1 |
| both · Dashboard "KYC Verified" | read KYC status | `GET /accounts/kyc/status` | `GET /v1/kyc` | `kyc:read` | 4.2 |
| both · Dashboard | start Didit | `POST /accounts/kyc/didit/session` | `POST /v1/kyc/session` | `kyc:write` | 5.1 |
| both · Dashboard, Accounts, Wallets | list accounts and balances | `GET /accounts/list` | `GET /v1/accounts` | `accounts:read` | 4.3 |
| — (route exists, UI unused) | one account | `POST /accounts/details` | `GET /v1/accounts/{id}` | `accounts:read` | 4.3 |
| NODA · New Account; Loudibly · Receive | open an account | `POST /accounts/account` | `POST /v1/accounts` | `accounts:write` | 5.2 |
| NODA · Accounts pencil | rename / clear name | `POST /accounts/rename` | `PATCH /v1/accounts/{id}` | `accounts:write` | 5.2 |
| both · Deposit (crypto), Receive | address + network | from `/accounts/list` | `GET /v1/accounts/{id}/deposit-address` | `accounts:read` | 4.4 |
| both · Transactions, Recent Activity, Recent Deposits, Withdraw History | rows, filters, totals, fee per withdrawal | `POST /accounts/transactions` (one account) | `GET /v1/transactions[/{id}]` | `transactions:read` | 4.5 |
| Loudibly · Transfer | move between accounts | `POST /accounts/transfer` | `POST /v1/transfers`, `GET /v1/transfers/{id}` | `transfers:create` / `transactions:read` | 5.3 |
| both · Withdraw | Max, fee reserve, available | computed in core | `POST /v1/withdrawals/estimate` | `withdrawals:read` | 5.4 |
| both · Withdraw | send coins out | `POST /accounts/withdraw` + WebSocket | `POST /v1/withdrawals`, `GET /v1/withdrawals[/{id}]` | `withdrawals:create` / `withdrawals:read` | 5.4 |
| Loudibly · Cards | list saved cards | `GET /payments/list` | `GET /v1/payment-methods` | `payment-methods:read` | 4.7 |
| Loudibly · Cards | add a card | `POST /payments/save` via Evervault relay | **not in v1** (D1.9) | — | — |
| Loudibly · Deposit | charge a saved card into an account | `POST /accounts/deposit` + WebSocket | `POST /v1/deposits/card`, `GET /v1/deposits[/{id}]` | `deposits:create` / `deposits:read` | 5.5 |
| — (withdraw by fiat amount) | USD rate | `utils/exchangeRate.ts` inside withdraw | `GET /v1/rates` | `rates:read` | 4.6 |
| merchant platform (HMAC today) | register a payer, resend invite, payer's saved cards | `/accounts/onboarding[/resend]`, `/payments/list` | `POST /v1/users`, `…/{id}/invite`, `GET /v1/users/{id}`, `…/{id}/payment-methods` | merchant key: `users:*` | 5.6 |
| Loudibly · Merchants (staff) | register merchant, currencies | `/merchants/*` | **never public** | — | — |
| sign-up, confirm, claim | account access | Cognito, `/onboarding/*` | stay as they are (`/onboarding/*` already public) | — | — |

## D1. Decisions

| # | Question | Decision | Why | Status |
|---|---|---|---|---|
| D1.1 | Who owns a key? | **The signed-in user**; the key acts as that user. Merchants have their own keys (D1.8, D9). | "User creates the key himself"; account routes already act on `userId`. | Confirmed 2026-10-14 |
| D1.2 | What is stored? | **SHA-256 of the secret** in an SSM SecureString under its own KMS key; the secret is stored nowhere. | "Keys in SSM" and "nobody may know the secret": even a decrypted parameter is only a hash. A 256-bit random secret needs no slow hash. | Confirmed 2026-10-14 |
| D1.3 | How is it sent? | `Authorization: Basic base64(<keyId>:<secret>)` (Airtm style, `curl -u`). Key id `lk_live_<16 hex>`, secret `lks_<43 base64url>`. | Every client supports it; does not clash with `Bearer` or `Signature`. HMAC was weighed and refused: it needs the secret recoverable on our side, against D1.2. | Confirmed 2026-10-14 |
| D1.4 | Rate limits | Per-key counters in DynamoDB, checked by the authorizer, limit on the key row; router answers 429. Default **10 requests/second** per key; **no daily limit**. | Exact, per key, changeable without a deploy; usage plans are best-effort and capped. | Confirmed 2026-10-14 |
| D1.5 | Who changes a limit? | Staff (per key, or a user's default). | Commercial / abuse control. | Confirmed 2026-10-14 |
| D1.6 | Where are keys managed? | Only from the dashboards (JWT); management routes are not public and refuse keys. | A leaked key can never mint or widen keys. | Confirmed 2026-10-14 |
| D1.7 | Permissions | Fixed catalogue `<resource>:<action>`; each public route declares one; default read-only. | "Restrict by route permission name". | Confirmed 2026-10-14 |
| D1.8 | Merchants | **Basic keys for merchants too in v1** (`ownerType: 'merchant'`, created by staff, D9). HMAC stays unchanged on today's paths and is not offered on `/v1`. | One scheme for every `/v1` caller; requirement 8 keeps today's integrations working. | Confirmed 2026-10-14 |
| D1.9 | Adding a payment card by API | **No.** Cards are added in the UI only; the API charges cards already saved. | Card data reaches us only encrypted by Evervault in the browser; a server-to-server add would put the caller's systems in PCI scope and need a relay setup per caller. | Confirmed 2026-10-14 |
| D1.10 | Results of queued operations | **Polling** `GET /v1/withdrawals/{id}` / `/deposits/{id}` in v1; webhooks next (6.1). | The WebSocket is a browser channel; polling needs no new infrastructure. | Confirmed 2026-10-14 |
| D1.11 | KYC for moving money | **A policy per merchant, currency and operation** (withdraw, transfer, card deposit), switched on and off by staff; unset means required. It applies to everyone — web UI and API — and is checked in the route, not tied to a key's permissions (D11). | Merchants and currencies carry different risk; one rule for every channel. | Confirmed 2026-10-14 |

## D2. API keys — backend

### D2.1 Infrastructure (`amplify/backend.ts`)

*Confirmed 2026-10-14.*

1. KMS key `ApiKeyHashKey` (`alias/loudibly-api-keys`): `kms:Encrypt` for `ApiKeyIssuerRole`,
   `kms:Decrypt` for the authorizer's role only.
2. SSM `/loudibly/api-keys/<keyId>` — SecureString, value `sha256(secret)` hex.
3. `apiKeyIssuerFn` (`amplify/fn/api-key-issuer/handler.ts`) under `ApiKeyIssuerRole`:
   `ssm:PutParameter`/`DeleteParameter` on the path, `kms:Encrypt`, the key table — nothing else.
   Only `mainApiFn` may invoke it (ARN built from the name, like `hdAddressFn`).
4. Explicit DENY `ssm:*` on `/loudibly/api-keys/*` for `mainApiFn`.
5. Authorizer: `ssm:GetParameter` on the path + `kms:Decrypt`.
6. Tables (never `table.grant*(mainApiFn)`):
   - `v1ApiKeysTable` — `id` = keyId; `ownerType`, `ownerId`, `merchantId`, `name`,
     `permissions` (set), `status`, `rateLimit {perSecond}`, `ipAllowlist?`,
     `expiresAt?`, `createdAt`, `createdBy`, `lastUsedAt`, `revokedAt?`, `revokedBy?`;
     GSI `byOwner` (`ownerId`, `createdAt`).
   - `v1ApiKeyUsageTable` — `id` = `<keyId>#<epochSecond>`,
     `count`, `ttl`.

### D2.2 Secret rules (go into CLAUDE.md)

*Confirmed 2026-10-14.*

- The secret exists only in `apiKeyIssuerFn` during `create`, in the responses to the browser,
  and in the dialog that shows it.
- No log names the `Authorization` header, secret, hash or parameter value; the public stage
  keeps `dataTraceEnabled: false`.
- Compare with `crypto.timingSafeEqual`. Rotation = new key, then revoke the old one (a key's
  hash never changes, which is what makes caching it safe).

### D2.3 Authorizer branch

*Confirmed 2026-10-14.*

```
Authorization: Basic …  →  keyId, secret
  1. GetItem v1ApiKeysTable(keyId)          → missing / revoked / expired → Deny
  2. ipAllowlist non-empty and sourceIp not in it → Deny   (empty or absent: any IP)
  3. hash = cache[keyId] ?? SSM GetParameter(WithDecryption)   (memory, 10 min)
  4. timingSafeEqual(sha256(secret), hash)  → no → Deny
  5. owner still active (USERPROFILE exists, not deleted)
  6. rate check (D2.5)
  7. Allow: { userId: ownerId, role: 'user', authType: 'apikey', keyId,
              permissions: 'accounts:read,…', throttled: 'false', rateRemaining }
  8. lastUsedAt, at most once a minute per key
```

Revocation is immediate (step 1 every call). SSM `GetParameter` is 40 TPS standard; the cache
keeps us far below it. Standard tier holds 10,000 parameters; revoke deletes the parameter.

**IP allowlist.** The owner may list IP addresses when creating a key and change the list at
any time with update (staff do the same for a merchant key). An empty or missing list means any
IP may use the key; a non-empty list means only those IPs. Entries are single IPv4 or IPv6
addresses (no ranges), at most 20, checked and normalised by the route (`100062` for a bad
one); duplicates are dropped. `sourceIp` is API Gateway's `requestContext.identity.sourceIp`,
never a header such as `X-Forwarded-For`, which the caller controls. A change applies on the
next call (the row is read every call; only the hash is cached).

### D2.4 Router order (before schema validation)

*Confirmed 2026-10-14.*

1. `authType === 'apikey'` and not via the public API → 404.
2. `throttled` → 429 `100056`, `Retry-After`, `X-RateLimit-*`.
3. `apikey` and `route.permission` missing or not granted → 403 `100055` (`any` passes).
4. The existing `allowedRoles` check (keys are role `user`).

KYC is checked by the money routes themselves, for every caller (D11).

### D2.5 Rate limiting

*Confirmed 2026-10-14.*

One conditional update in the authorizer per call (`ADD count :1`, condition
`attribute_not_exists(count) OR count < :limit`) on the current second's row; a failed
condition sets `throttled` (an authorizer Deny can only give 401/403). Default in SSM:
`API_KEY_DEFAULT_RPS=10`. There is no daily limit (D1.4).

**The public stage's own throttle.** `loudiblyPublicApi`'s stage sets `throttlingRateLimit: 50`,
`throttlingBurstLimit: 100` (`amplify/backend.ts`): one bucket shared by every request to the
public API — all users' keys, all merchants' keys, HMAC merchants and JWT callers. It does not
cover the web apps: they call the internal `loudiblyRestApi` (production `VITE_API_BASE` is
`https://api.noda.money/v1`, mapped to it; checked 2026-10-14), which has no stage throttle.
At 10/s per key, five busy keys fill the bucket, and then API Gateway answers 429 to everyone,
before the authorizer runs, without our `Retry-After`/`X-RateLimit-*` headers. Raise it to
`500` / `1000` in step 2.4 (agreed 2026-10-14) so our per-key limit is what callers meet; the region's account limit
(10,000/s, burst 5,000, shared by both APIs) stays the ceiling. Raise it again when the sum of
staff-granted limits nears it.

### D2.6 Management routes and error codes

*Confirmed 2026-10-14. Recent sign-in: not in v1. Owner email: yes.*

| Route | Role | Does |
|---|---|---|
| `GET /accounts/api-keys/permissions` | user | The catalogue (name, description, group). |
| `POST /accounts/api-keys/create` | user | `{ name, permissions[], expiresAt?, ipAllowlist? }` → `{ keyId, secret, … }`; ≤ 10 active keys, known permissions. Money-moving ones may be granted without KYC: each use is checked against the KYC policy (D11). |
| `GET /accounts/api-keys/list` | user | Own keys, never secret or hash. |
| `POST /accounts/api-keys/update` | user | Name, permissions, `ipAllowlist` (an empty list allows any IP again). Not the rate limit. |
| `POST /accounts/api-keys/revoke` | user | Own key; idempotent. |
| `POST /merchants/api-keys/create` | staff | `{ merchantId, name, permissions[], expiresAt?, ipAllowlist? }` → `{ keyId, secret }`, shown once; merchant must be `active`; ≤ 10 active keys per merchant. |
| `GET /merchants/api-keys/list` | staff | All keys, filters (scan while small). |
| `POST /merchants/api-keys/rate-limit` | staff | `{ keyId \| userId, perSecond }`. |
| `POST /merchants/api-keys/revoke` | staff | Any key, with `reason`. |

All refuse `authType !== 'jwt'`. The owner is emailed when one of their keys is created or
revoked: key name and id, who did it (the owner, or staff with the reason), never the secret; a
failed send does not fail the request. A recent sign-in (< 5 min) for create and widening is
not in v1 (Part 3).

Codes (last used today is `100053`): `100054` key limit reached, `100055` key lacks permission
(403), `100056` rate limited (429), `100057` keys are managed from a signed-in session (403),
`100058` unknown permission, `100059` this operation in this currency needs a verified identity
(403; from 1.6, D11), `100060` key not
found, `100061` idempotency key reused with another body / still in progress (409), `100062`
not a valid IP address (with the entry) or more than 20.

## D3. Callers (`utils/caller.ts`)

*Confirmed 2026-10-14.*

```ts
type Caller =
  | { kind: 'user', userId, via: 'jwt' | 'apikey', keyId? }
  | { kind: 'merchant', merchantId, via: 'hmac' | 'apikey', keyId? }
  | { kind: 'staff' | 'merchant-member' | 'admin-group', userId }
```

`callerUser(event)` returns the user or refuses with `100053`. Every key-authorized request is
logged with `keyId` (`utils/requestLog.ts`). A deleted or blocked user's keys stop working
(authorizer step 5) and are revoked by the deletion path.

## D4. Frontend core (`web/core`)

*Confirmed 2026-10-14.*

`api/apiKeys.ts` (`listApiKeys`, `createApiKey`, `updateApiKey`, `revokeApiKey`,
`listPermissions`; staff `listAllApiKeys`, `createMerchantApiKey`, `setRateLimit`,
`staffRevokeApiKey`);
`useApiKeys()` (`keys`, `permissions`, `failed`, `load`, `create`, `update`, `revoke`,
`refresh`) — `create()` only sends, returns the secret, keeps it nowhere, and a throw does not
mean no key was made; `useStaffApiKeys()` (`keys`, `failed`, `load`, `createForMerchant`,
`setRateLimit`, `revoke`, `refresh`), whose `createForMerchant()` follows the same rules as
`create()` and as `useMerchants().register()`. No wording, Tailwind or routing in core.

## D5. Permission catalogue (`amplify/service/permissions.ts`)

*Confirmed 2026-10-14, with `GET /v1/me` open to any key. KYC moved out of permissions on
2026-10-14 into the KYC policy (D1.11, D11).*

`read` never moves money; anything that moves money is its own permission (group *Move
money*). Whether a use needs approved KYC is decided per operation by the KYC policy (D11),
checked in the route for keys and signed-in users alike, so a permission carries no KYC rule.
`GET /v1/me` takes any key (`permission: 'any'`), so a key can always be tested. `null` marks a
public route no key may call (`/payments/save`, D1.9).

| Permission | Endpoints | Moves money |
|---|---|---|
| any key | `GET /v1/me` | |
| `profile:read` | `GET /v1/profile` | |
| `profile:write` | `PATCH /v1/profile` | |
| `kyc:read` / `kyc:write` | `GET /v1/kyc`, `POST /v1/kyc/session` | |
| `accounts:read` | `GET /v1/accounts[/{id}]`, `…/deposit-address` | |
| `accounts:write` | `POST /v1/accounts`, `PATCH /v1/accounts/{id}` | |
| `transactions:read` | `GET /v1/transactions[/{id}]`, `GET /v1/transfers/{id}` | |
| `transfers:create` | `POST /v1/transfers` | yes |
| `withdrawals:read` | `GET /v1/withdrawals[/{id}]`, `POST /v1/withdrawals/estimate` | |
| `withdrawals:create` | `POST /v1/withdrawals` | yes |
| `payment-methods:read` | `GET /v1/payment-methods` | |
| `deposits:read` / `deposits:create` | `GET /v1/deposits[/{id}]`, `POST /v1/deposits/card` | create |
| `rates:read` | `GET /v1/rates` | |
| `webhooks:manage` (6.1) | `/v1/webhook-endpoints` | |
| `users:create` / `users:invite` / `users:read` — merchant keys only (D9) | `POST /v1/users`, `…/{id}/invite`, `GET /v1/users/{id}[/payment-methods]` | |

Groups for the screens: *View* (every `:read`), *Manage* (`profile:write`, `kyc:write`,
`accounts:write`), *Move money* (`transfers:create`, `withdrawals:create`, `deposits:create`).

## D6. Public API v1

### D6.1 Conventions

*Confirmed 2026-10-14.*

- Base `https://<host>/v1`; API key (Basic, user's or merchant's) or user JWT (Bearer). HMAC
  (Signature) only on today's paths (D1.8).
- Plural resource paths; `GET` reads, `POST` creates/actions, `PATCH` updates.
- `Idempotency-Key` required on `POST /v1/transfers`, `/withdrawals`, `/deposits/card`, and
  accepted on `POST /v1/accounts` (1.4).
- Cursor pagination `?limit=50&cursor=…` → `{ data, nextCursor }`; `limit` ≤ 200.
- Errors `{ error: { code, message, field? } }`; our numeric codes stay.
- Amounts are decimal strings; currencies are our ids (`TRON`, `SOL`, `USDT_TRON`,
  `TUSDT_TRON`); times ISO 8601 UTC.
- `X-Request-Id` and rate-limit headers on every response.
- An uncertain withdrawal is `pending`, never `failed` (`BroadcastUncertainError` rule).

### D6.2 Path parameters

*Confirmed 2026-10-14.*

The `/v1` in every URL is the public API's **stage name**, as it already is for today's
`…/v1/accounts/onboarding`. So routes and `publicRoutes` entries are written without it —
`/accounts/{id}`, `/transactions`, `/withdrawals/{id}` — and `resourceForPath` (which accepts
`{id}`) builds one resource each. Writing `/v1/accounts` would serve at `…/v1/v1/accounts`.

The router matches `event.path` (it already strips a leading `/v1`) against its templates,
static paths first, and hands the captured values to the schema check as `pathParameters`. It
cannot use `event.resource`: on the internal API every request arrives as
`/accounts/{proxy+}`. A static path wins over a template (`/accounts/list` is never
`/accounts/{id}`), as API Gateway does. `{id}` of an account is its account number; the handler
finds it among the caller's rows, never trusts it. New top-level paths (`/transactions`,
`/withdrawals`, `/me`, …) exist on the public API only: the internal API has proxies under
`/accounts`, `/payments`, `/merchants`, `/webhook` and `/onboarding` alone.

### D6.3 Endpoints and what backs them

*Confirmed 2026-10-14.*

| `/v1` endpoint | Backed by | Notes |
|---|---|---|
| `GET /v1/me` | `profile.ts` + key info | id, email, KYC status, key name and permissions (connectivity check, Airtm `/me`). |
| `GET/PATCH /v1/profile` | `profile.ts`, `profile-save.ts` | |
| `GET /v1/kyc`, `POST /v1/kyc/session` | `kyc-status.ts`, `kyc-didit-session.ts` | Session refused when approved or pending (opening one resets status). |
| `GET /v1/accounts`, `GET /v1/accounts/{id}` | `list.ts`, `details.ts` | `{ id, name, currency, network, address, balance, availableBalance, withdrawalFeeReserve, kycRequired, createdAt }` (`kycRequired` from D11); `name` is `null` when none was typed (read from the row, not `list.ts`'s `name ?? accountNo`); balances, stored as numbers, are sent as decimal strings (D6.1). |
| `POST /v1/accounts`, `PATCH /v1/accounts/{id}` | `account.ts`, `rename.ts` | Provider and accounting currency set by us, not the caller. |
| `GET /v1/accounts/{id}/deposit-address` | `list.ts` row | |
| `GET /v1/transactions[/{id}]` | `transactions.ts`, generalised (D6.5) | |
| `POST /v1/transfers`, `GET /v1/transfers/{id}` | `transfer.ts` | Any account number of the same currency, as today. `id` is the ledger reference `transfer.ts` already returns as `transactionId`. |
| `POST /v1/withdrawals/estimate` | `WITHDRAWAL_FEES` (`providers/ledger/tatum/tatum.ts`, which core's `withdrawalFeeReserve()` copies) + `exchangeRate.ts` | |
| `POST /v1/withdrawals`, `GET /v1/withdrawals[/{id}]` | `withdraw.ts` + `OP#` records (1.5) | |
| `GET /v1/payment-methods` | `payments/list.ts` | |
| `POST /v1/deposits/card`, `GET /v1/deposits[/{id}]` | `deposit.ts` / `payments/process.ts` + 1.5 | |
| `GET /v1/rates` | `utils/exchangeRate.ts` | |
| `POST /v1/users`, `POST /v1/users/{id}/invite`, `GET /v1/users/{id}`, `GET /v1/users/{id}/payment-methods` | `onboarding.ts`, `onboarding-resend.ts`, profile by id, `payments/list.ts` via `resolvePayer()` | Merchant key only; a user of another merchant is `100053`. |

### D6.4 Queued operations

*Confirmed 2026-10-14.*

A withdrawal or card deposit answers `202 { id, status: 'pending' }`. `id` is the operation id
(`wdr_…` / `dep_…`), bound to the `Idempotency-Key`. Today the withdrawal route only debits and
queues; the log row (`WITHDRAWAL`, `_FAILED`, `_UNCERTAIN`) appears when the processor finishes
(`fn/sqs-processor/webhook/withdrawalHandler.ts`). So 1.5 adds an operation record, keyed on the
user (`OP#<opId>`), written before queueing and updated by the processor. `GET …/{id}` reads it
by key, which is also the ownership check: `pending` (queued, broadcast, or uncertain),
`completed` (with `txHash`, `fee`), `failed` (with our `code`, only when provably not sent).
Same rules the Withdraw dialog follows: never `failed` without an answer. `GET /v1/withdrawals`
and `/v1/deposits` list the user's `OP#` records, newest first.

### D6.5 Transactions across accounts

*Confirmed 2026-10-14.*

Today `/accounts/transactions` reads one account: every `TX#` row under its `vAccountId` in
`v1TransactionLogsTable`, sorted by `createdAt` in memory. Two facts shape v1:

- The sort keys are not all time-ordered: withdrawals and transfers write
  `TX#<createdAt>#<id>`, chain deposits, fees and sweeps (`balanceUpdateHandler.ts`,
  `accountBackfillHandler.ts`) write `TX#<txId>`. A range query by time is not possible yet.
- `queryRecord` (`utils/db.ts`) reads one page only (DynamoDB's 1 MB), so a long history is
  cut short today without a sign.

So `GET /v1/transactions` reads every page of each of the caller's accounts (a paging query
helper, used by `/accounts/transactions` too), filters and sorts in memory, newest first; the
cursor is the last `(createdAt, id)` returned, opaque to the caller. That is fine while a user
has hundreds of rows; when it is not, write every row as `TX#<createdAt>#<id>` (migration with
dry run / `--commit`) and query by range instead (Part 3).

Filters: `account`, `type` (`deposit`, `withdrawal`, `transfer`), `status` (`completed`,
`pending`, `failed`), `from`, `to` — mapped from the log's types as `activity.ts` does (`DEPOSIT[_FAILED]`,
`WITHDRAWAL[_FAILED|_UNCERTAIN]`, `TRANSFER_SENT|_RECEIVED`), with `direction` `in`/`out`.
`FEE`, `SWEEP`, `SWEEP_FEE` and `TREASURY_SEND` rows are not listed; each withdrawal carries its
`fee` (the `FEE` row with the same `txId`), as NODA's Fee column does.

## D7. Screens

*Confirmed 2026-10-14.*

Built like the sign-in screen: no Figma, the app's own parts (`panel`, `card`, `chip`,
`value-box`, `DataTable`, `AppDialog`, `ListState`, `StatusPill`, `DropdownList`, `PageAction`,
`AppIcon`, `authForm.ts`), both themes, tokens only, mobile first.

### D7.1 NODA navigation

The avatar menu gains **API keys** above Sign out.

### D7.2 NODA — API keys (`/developers/api-keys`, "API keys", "Let your own software use your NODA account")

```
┌ panel ─────────────────────────────────────────────────────────────────────────── [ + Create key ] ┐
│ Name            Key            Permissions        Allowed IPs     Rate limit  Last used  Status    │
│ Accounting bot  lk_live_8f…a2  View · Move money  203.0.113.7 +1  10/s        2 min ago  Active    │
│ Old script      lk_live_31…7c  View               Any IP          10/s        never      Revoked   │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
  mobile: one `card` per key, name + status on the first line, the rest as label/value rows
```
- Row menu (`DropdownList`): Edit, Revoke; revoked keys stay listed, greyed, no menu.
- Empty: "No API keys yet", one line on what a key does, "Create key".
- **Create key** (`AppDialog`, mounted with `v-if`):
  1. Form: name; permissions in three `chip` groups — *View*, *Manage*, *Move money* — View
     ticked; under *Move money* a `text-warn-ink` line when the user is not verified: some
     currencies need a verified identity, with a link to verification; expiry (Never / 30 / 90 / 365 days); allowed IPs (optional, one per line; "Leave empty to allow any IP").
  2. Secret: key id and secret in `value-box`es with copy buttons, a `border-yellow` warning
     ("shown once — nobody, including NODA, can show it again"), a `curl -u` example, one
     button "I've stored it" (the only way to close).
  3. Unknown result: "We could not confirm the key was created. Check the list before trying
     again." + "Check the list".
- **Edit**: name, permissions, allowed IPs (emptying the list allows any IP; the list and the
  table's row show "Any IP" then). **Revoke**: names the key, says it stops at once.

### D7.3 Loudibly

Custodial users get the same view (`custodialOnly`). Staff (`staffOnly`, from `MainLayout`):
**API keys** — all keys, filter by owner (user or merchant) / status, rate limit per key or
per user default, revoke with reason. **Merchants** — each merchant gets an API keys section:
Create key (`users:*` permissions, the secret shown once in the same three-state dialog as
`RegisterMerchantDialog`), list, revoke.

## D8. Outgoing webhooks (6.1)

*Confirmed 2026-10-14.*

`v1WebhookEndpointsTable` (owner, url, events, status); signing secret in SSM SecureString,
encrypted (the sender needs it), decryptable only by the sender's role. Events:
`deposit.received`, `deposit.card.completed|failed`, `withdrawal.completed|failed|pending`,
`transfer.completed`, `kyc.updated`. Sent from `v1GeneralQueue`,
`X-Loudibly-Signature: t=<ts>,v1=<hmac>`, retried with backoff; `GET /v1/events` for replay.

## D9. Merchant-owned API keys (v1, D1.8)

*Confirmed 2026-10-14.*

`ownerType: 'merchant'`, `ownerId` = merchant id. In v1 staff create them
(`/merchants/api-keys/create`, Loudibly's Merchants page); a merchant's own team does it later
(6.3). The authorizer checks the merchant is `active` and gives `authType: 'apikey'`,
`role: 'admin'`, `merchantId`; `resolvePayer()` accepts it like HMAC and onboarding takes
`merchantId` from it (never the body), so it acts on the merchant's own payers only.
`callerUser()` refuses it: a merchant key is not a user. Permissions: `users:*` only — a
merchant key cannot move a payer's money. Same rate limit default (10/s), changed by staff.
The HMAC key from `/merchants/register` is untouched.

Onboarding today takes the merchant from `authorizer.userId`, which HMAC sets to the merchant id
(`onboarding.ts`, `platform`), and keys its `MAPPING` rows on it, so an `externalId` is unique
per merchant. It moves to a `callerMerchant(event)` beside `callerUser()` (D3), which answers the
merchant id for both HMAC and a merchant key. `platform` stays the merchant id, never the key
id, so a payer registered with HMAC is the same payer when read or invited with a key, and
revoking a key loses nothing.

## D10. HMAC secrets out of DynamoDB (6.4)

*Confirmed 2026-10-14.*

Move each from `v1UserKeysTable.key` to `/loudibly/hmac-keys/<merchantId>` (encrypted — HMAC
needs the secret itself — authorizer-only decrypt), switch the authorizer, remove the attribute;
CloudShell migration in `scripts/migrations/` with dry run / `--commit`.

## D11. KYC policy (1.6, 1.7)

*Confirmed 2026-10-14 (D1.11).*

**What it decides.** Whether a money operation needs the caller's KYC `approved`, per merchant,
currency and operation:

| Operation | Route | Currency | Merchant |
|---|---|---|---|
| `withdraw` | `/accounts/withdraw` (`/v1/withdrawals`) | the account's | the account's `merchantId` |
| `transfer` | `/accounts/transfer` (`/v1/transfers`) | the sender's | the sender account's |
| `cardDeposit` | `/accounts/deposit` (`/v1/deposits/card`) | the account credited | the account's |

Crypto arriving at a deposit address is not gated: coins on the chain cannot be refused.

**Where.** `v1MerchantTable`, `id` = merchant id, `sk` = `POLICY#KYC`, one top-level attribute
per switch: `{ 'USDT_TRON#withdraw': false, 'SOL#transfer': true, …, updatedAt, updatedBy }`.
Only an explicit `false` turns KYC off; a merchant, currency or operation with no attribute
requires it. `internal-001` holds NODA's direct users'. Each switch is its own `SET`, so two staff
changes do not overwrite each other (a nested map cannot be written key by key in DynamoDB
before its parents exist). Accounts made before 2026-10-06 belong to `loudibly`, which needs
its own policy.

**The check** (`utils/kycPolicy.ts`, `checkKyc()`), in each route after the account is loaded
and owned, before any debit, charge or queueing: read the policy (one `GetItem`, not cached, so
a switch applies on the next call) and, only when it requires KYC, the caller's
`USERPROFILE.kyc.status`; anything but Didit's `Approved` → 403 `100059` "withdrawals in
USDT_TRON need a verified identity". A failed read answers 500 and never lets the operation
through. The same for a key and a signed-in user,
since both reach the same route.

**Staff.**
- `POST /merchants/policy/kyc` (staff): `{ merchantId, currency, withdraw?, transfer?,
  cardDeposit? }` — the given switches only; currency one of `LEDGER_CURRENCIES`; logged with
  the staff user.
- `/merchants/list` answers each merchant's effective policy per currency (unset shown as
  required).
- Loudibly Merchants: a KYC section per merchant, a row per currency, three switches.

**Users.** `/accounts/list` answers `kycRequired: { withdraw, transfer, cardDeposit }` per
account, so Withdraw, Transfer and Deposit can say before submitting that the user must verify,
with `useKyc().start()` offered under its usual rule. A view still words `100059` from the
server, which decides.

**Rollout.** Unset means required, so the deploy blocks every unverified user from withdrawing,
transferring and card deposits in every currency until staff switch some off. 1.6 and 1.7 go out
together, and staff set `internal-001`'s policy right after the deploy.

---

# Part 3 — Not in the API, and why

**UI mockups with no backend yet** (`src/placeholders/`): each gets its endpoint when it gets a
backend (6.5).

| Mockup | Would become |
|---|---|
| NODA Convert | `POST /v1/quotes`, `POST /v1/conversions` |
| NODA Earn | `/v1/earn/*` |
| NODA Payments page | depends on what it becomes |
| NODA Deposit — Card and Bank tiles, minimum deposit, confirmations | `POST /v1/deposits/card` for NODA users; bank deposits |
| NODA Withdraw — network fee, Withdraw Limits | `fee` in the estimate; `GET /v1/limits` |
| Dashboard 30-day line, % changes, Security Score, stat cards | `GET /v1/balance-history` |

**Scaling later:** time-ordered `TX#` sort keys for every row, so transactions are read by
range instead of whole (D6.5).

**Kept out on purpose**

- Adding a payment card (D1.9).
- API key management — dashboards only (D1.6).
- A recent sign-in (< 5 min) to create or widen a key — not in v1 (D2.6); later, with step-up
  codes for moving money.
- Staff (`/merchants/*`) and merchant-team treasury operations — internal API only.
- Sign-up, email confirmation, password — Cognito and the existing `/onboarding/*` links.
- The non-custodial wallet — client-side keys, no backend.

# Sources

- Airtm Enterprise API (Basic key/secret, 10 req/s per key, two-step payouts):
  https://api.enterprise.airtm.com/docs/ , https://apis.io/apis/airtm/airtm-payouts-api/ ,
  https://apis.io/security/airtm/airtm-authentication/
- Wirex BaaS: https://docs.wirexapp.com/reference/post_api-v1-user ,
  https://docs.wirexapp.com/llms.txt
