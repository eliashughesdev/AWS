# Bug Fix Plan

**Scope:** code review of the backend (`amplify/`), the Evervault function, and the money
and auth paths of both frontends. Review date: 2026-10-01, at commit `6869729`.
**Companion:** security issues tied to PCI DSS are tracked in `pci-remediation-plan.md`
(F1–F12) and are only cross-referenced here. Do **P0** of both plans before any real money
moves through the system.

Each bug lists where it is, a concrete failure scenario, the fix, and how to verify it.
Line numbers are as of the commit above.

---

## How to Track Progress

This uses the same convention as `pci-remediation-plan.md`:
- Tick `- [ ]` → `- [x]` in the same PR as the fix. A step that turns out not to apply is
  struck through with a reason: `- [x] ~~step~~ — N/A: <why>`.
- A bug is **✅ Done** only when its fix is ticked **and** its **Verified** box is ticked
  against a deployed stack.
- Update the tracker row: ⬜ Not started · 🟡 In progress · 🔵 Deployed (not yet verified)
  · ✅ Done · ⛔ Blocked (say on what in Notes).

## Priority Levels

| Priority | Meaning | Target |
|---|---|---|
| **P0 — Critical** | Funds can be stolen, created from nothing, or wrongly charged; accounts can be taken over | Before any real-money traffic. Ship each as its own hotfix |
| **P1 — High** | Money is lost, stuck or double-counted in normal use; ledgers drift | Within 2 weeks |
| **P2 — Medium** | Wrong results, crashes or abuse paths with limited impact | Within the next month |
| **P3 — Low** | Cleanup, dead code, edge cases | When touching the area |

---

## 1. Summary & Tracker

| ID | P | Bug | Status | Owner | PR | Done on | Notes |
|---|---|---|---|---|---|---|---|
| B1 | P0 | `/payments/process` lets the caller inject any queue message: forged withdrawals signed with any account's key, minted balances | ⬜ | | | | |
| B2 | P0 | `/accounts/details` returns any account's KMS key id, ledger id and balance (no ownership check) | ⬜ | | | | Enables B1 theft |
| B3 | P0 | Clover is sent dollars as cents (100× undercharge) and always `usd` | ⬜ | | | | |
| B4 | P0 | Balance updates from deposits overwrite concurrent withdrawals (double spend); a failed update loses the credit forever | ⬜ | | | | |
| B5 | P0 | SQS consumer never reports failures, so nothing is ever retried and there is no dead-letter queue | ⬜ | | | | Hides B4, B9, B22 |
| B6 | P0 | Onboarding adopts existing Cognito users and hands the merchant a token that sets their password (account takeover) | ⬜ | | | | |
| B7 | P0 | Card endpoints trust `userId` from the request (list or charge anyone's cards) | ⬜ | | | | = PCI **F3** |
| B8 | P1 | Card deposits credit only the local balance, not the Tatum ledger, so that money can't be withdrawn or transferred | ⬜ | | | | Needs decision D1 |
| B9 | P1 | Deposits that need 3-D Secure are charged but never credited | ⬜ | | | | |
| B10 | P1 | Transfers: no amount validation, non-atomic unchecked balance writes, can spend funds reserved for a pending withdrawal | ⬜ | | | | |
| B11 | P1 | Withdrawals: no amount validation, rollback leaves `availableBalance` short, double-submit withdraws twice | ⬜ | | | | |
| B12 | P1 | TRX network fees are debited from USDT accounts | ⬜ | | | | |
| B13 | P1 | Processor failover can charge the card twice | ⬜ | | | | |
| B14 | P1 | Error codes 100002 / 100004 / 100030 are not defined, so 8 error paths return 500 | ⬜ | | | | |
| B15 | P1 | Merchant master currency case isn't normalized, so its sweeps and withdrawals fail | ⬜ | | | | |
| B16 | P1 | A failed queue send in deposit / process / guest returns nothing (502) | ⬜ | | | | |
| B22 | P1 | Tatum webhook answers 200 even when enqueueing failed, so the deposit is lost | ⬜ | | | | |
| B17 | P2 | WebSocket subscribe is unauthenticated, so others can read payment results (incl. 3DS `clientSecret`) | ⬜ | | | | |
| B18 | P2 | Didit KYC webhook trusts unsigned `vendor_data`, has no replay window, and can crash on bad signatures | ⬜ | | | | |
| B19 | P2 | Unlimited account creation per user (each one costs a KMS key, ledger account and subscription); merchant keys create accounts under the merchant id | ⬜ | | | | |
| B20 | P2 | Fixed 1 TRX Tatum withdrawal fee isn't mirrored locally, so ledgers drift and full-balance withdrawals fail | ⬜ | | | | |
| B21 | P2 | Withdrawal rounding: 8 decimals locally vs 6 at Tatum | ⬜ | | | | |
| B23 | P2 | Tatum webhook route crashes without `X-Forwarded-For` or with an unknown `type`; router crashes on a missing body; `/health` returns 404 | ⬜ | | | | |
| B24 | P2 | KYC webhook creates phantom `USERPROFILE` rows for unknown user ids | ⬜ | | | | |
| B25 | P3 | `accountBackfillHandler` is dead code keyed on the wrong id (`accountNo` vs `vAccountId`) | ⬜ | | | | Reachable via B1 |
| B26 | P3 | Hardcoded SQS URLs with the AWS account id as fallbacks | ⬜ | | | | |
| B27 | P3 | Transactions and cards lists aren't paginated, so they are silently cut off past 1 MB | ⬜ | | | | |
| B28 | P3 | Withdraw screen estimates with the USDT price; the backend uses USD | ⬜ | | | | |

(B22 is listed with P1 on purpose; IDs follow the order bugs were found.)

---

## 2. P0 — Critical

### B1. Queue-message injection through `/payments/process`

**Where:** `amplify/service/routes/payments/process.ts:14`, `:26-37`;
`amplify/fn/sqs-processor/webhook/handler.ts:35-50`; `withdrawalHandler.ts:7-9`.

**What goes wrong:** the route copies every unknown body field into the SQS message
(`...additionalParams`, spread *after* `queue`). The worker routes on `body.queue`, and one
Lambda consumes all five queues, so a caller can pick the handler and supply its inputs.
Any signed-in user can:
- **Steal funds.** Send `queue: 'v1-withdrawal-processing-queue'` with another account's
  `kmsKeyId` and `senderAddress` (both obtainable through B2). The worker signs with that
  KMS key and sends the coins to the attacker's address. The local balance check in
  `withdraw.ts` is skipped completely.
- **Mint balance.** Send `depositMode: true, vAccountId: <any>, cryptoAmount: 1000000`
  with a $1 charge to their own card. `paymentHandler.ts:269-278` credits 1,000,000 to
  that account.
- **Overwrite balances.** Send `queue: 'v1-account-backfill-queue'`, which seeds a balance
  from any on-chain address (see B25).

**Fix:**
- [ ] **1.** Build the queue message from an explicit allowlist in `process.ts` (`paymentId`,
  `transactionId`, `amount`, `currency`, `provider`, `offSession`, `bin`, `clientIp`). Never
  spread the body. Take `userId` from the authorizer (B7).
- [ ] **2.** Route in the worker by **event source** (`record.eventSourceARN` → queue name),
  not by a field inside the body. Reject a message whose `body.queue` doesn't match its
  source queue.
- [ ] **3.** Withdrawal and sweep handlers: re-load the account from DynamoDB by
  `vAccountId` and take `kmsKeyId`, `depositAddress`, `merchantId` and `chain` from the
  stored record. Never sign with key material taken from a message.
- [ ] **4.** Payment handler: accept `depositMode`, `vAccountId` and `cryptoAmount` only from
  `deposit.ts`. Either use a separate deposit queue or sign the deposit fields, then
  re-check that the `vAccountId` belongs to `userId`.
- [ ] **5.** Restrict the SQS processor's role to `kms:Sign` on keys tagged
  `service=loudibly`, instead of `resources: ['*']` (`backend.ts`).
- [ ] **6.** Check CloudWatch for past abuse: payment-queue messages whose body carries
  `queue`, `depositMode`, `kmsKeyId` or `vAccountId` that didn't come from `deposit.ts`.

- [ ] **Verified:** a `/payments/process` body containing `queue`, `kmsKeyId` or `depositMode`
  is either rejected or has those fields ignored. No withdrawal, credit or backfill happens.

### B2. `/accounts/details` has no ownership check

**Where:** `amplify/service/routes/accounts/details.ts:8-55`.

**What goes wrong:** any authenticated caller who knows an account number gets the full
account record and balance. That includes `kmsKeyId`, `userId`, `merchantId`, the deposit
address, and (through the balance row's `id`) the `vAccountId`. Account numbers are shared
when people transfer money, so they aren't secret. Together with B1 this is enough to
drain the account. Separately, an unknown account returns an empty array, which passes the
`!account.res` check, so `accountDet` is `undefined` and the handler crashes with a 500.

**Fix:**
- [ ] **1.** Check `accountDet.id === authorizer.userId`. For the `admin` role, only allow
  users mapped to the calling platform.
- [ ] **2.** Return an explicit field list (balance, chain, deposit address, status). Never
  return `kmsKeyId`, `vAccountId`, `providerId` or the raw balance `id`.
- [ ] **3.** Treat an empty result as not found (`!account.res?.length`).
- [ ] **4.** Normalize the input: accept the bare account number and add `ACCOUNT#` on the
  server, like `transactions.ts` does.

- [ ] **Verified:** user A asking for user B's account gets a 403. No response contains
  `kmsKeyId`. An unknown account gets a 400 or 404, not a 500.

### B3. Clover is sent major-unit amounts

**Where:** `amplify/providers/payment/CloverPaymentProcessor.ts:59`, `:110`. Stripe converts
correctly (`StripePaymentProcessor.ts:8-10`).

**What goes wrong:** Clover's `/v1/charges` expects the smallest currency unit (cents).
`params.amount` is in major units, so a $50.00 deposit is charged as **$0.50**, while the
account is credited crypto worth $50. Card deposits always use Clover
(`deposit.ts:91`), and US/CA cards are routed to Clover by BIN, so this hits the main
path. The currency is also hardcoded to `'usd'`, so a EUR request is charged in USD.

**Fix:**
- [ ] **1.** Share one `toMinorUnits(amount, currency)` helper between both processors.
- [ ] **2.** Pass `params.currency.toLowerCase()` to Clover. Reject currencies Clover doesn't
  support instead of quietly charging USD.
- [ ] **3.** Reconcile past Clover charges against the credited amounts. List affected
  deposits so finance can decide whether to re-collect or write them off.

- [ ] **Verified:** a $12.34 Clover sandbox deposit shows `amount: 1234` in the Clover
  dashboard, and the charged currency matches the request.

### B4. Lost-update race on balances, and credits lost on failure

**Where:** `amplify/fn/sqs-processor/webhook/balanceUpdateHandler.ts:61-121`.

**What goes wrong:**
1. `applyBalanceChange` reads the balance (`getRecord`), adds the change in JavaScript, and
   writes back an **absolute** value. If a withdrawal deducts atomically
   (`withdraw.ts:103`) between that read and write, the write puts the old balance back.
   The withdrawal is erased and the customer keeps both the coins sent on-chain and the
   balance (double spend). Two concurrent deposits lose one of them the same way.
2. The idempotency claim (`TX#<txId>`) is written **before** the balance update. If the
   update fails, a retry sees the claim, logs `DUPLICATE_TX` and skips, so the credit is
   lost for good.

**Fix:**
- [ ] **1.** Do the claim and the balance change in **one** `TransactWriteItems`: a Put of
  the `TX#` row with `attribute_not_exists(sk)`, plus an Update on the balance with
  `ADD balance :d, availableBalance :d` (or `SET x = x + :d`). Extend `utils/db.ts`
  `transactWriteItems` to support `Update` items.
- [ ] **2.** For debits, add `availableBalance >= :amt` where the business requires it.
- [ ] **3.** Apply the same pattern to `transfer.ts` (B10) and the withdrawal rollbacks
  (B11). Every balance write should be atomic and relative.
- [ ] **4.** One-off reconciliation: compare each `v1AccountBalanceTable` row with
  (sum of `TX#` rows) and with the Tatum ledger balance, and list any differences.

- [ ] **Verified:** a script fires 20 concurrent deposit messages plus 5 withdrawals at
  one account, and the final balance equals the expected sum exactly. Forcing the update
  to fail rolls back the claim, and a retry then credits.

### B5. The SQS consumer never reports failures

**Where:** `amplify/fn/sqs-processor/webhook/handler.ts:35-71`; queue definitions in
`amplify/backend.ts:104-138`.

**What goes wrong:** every handler returns `false` to mean "retry me", but `routeMessage`
throws that value away and catches every exception. The Lambda then returns `undefined`.
With `reportBatchItemFailures: true` that counts as "all succeeded", so **every message is
deleted after one attempt**. Failed deposit credits, sweeps and payments are never retried.
None of the queues has a dead-letter queue, so nothing records the loss. Separately,
`JSON.parse(record.body)` at `:65` sits outside the try block, so one malformed message
fails the whole batch of 10 and re-runs messages that already succeeded.

**Fix:**
- [ ] **1.** Return `{ batchItemFailures: [{ itemIdentifier: record.messageId }] }` for each
  record whose handler returned `false` or threw.
- [ ] **2.** Add a DLQ to every queue (`deadLetterQueue: { queue, maxReceiveCount: 5 }`)
  and a CloudWatch alarm when it isn't empty.
- [ ] **3.** Decide per handler which outcomes must **not** be retried and make them return
  `true`, for example `BroadcastUncertainError` in `withdrawalHandler.ts:78-95` (which needs
  manual review, not a retry). Make sure every retried handler is idempotent: payments
  (B13) and withdrawals (B11) aren't yet. **Do this step before turning retries on.**
- [ ] **4.** Move the per-record `JSON.parse` inside the try block.

- [ ] **Verified:** a handler forced to fail is retried up to `maxReceiveCount`, then lands
  in the DLQ, and the alarm fires.

### B6. Account takeover through onboarding "orphan adoption"

**Where:** `amplify/service/routes/accounts/onboarding.ts:219-234`;
`onboarding/claim.ts:53-54`.

**What goes wrong:** when the email already exists in Cognito but has no `USERPROFILE`,
the intake assumes it is an orphan from its own earlier failed attempt. It adopts the
user and returns a `claimToken` to the **merchant** in the API response. But a person who
signed up directly and confirmed their email also has no `USERPROFILE` until they create an
account (`account.ts`). Any merchant key can submit that person's email, receive a token,
and call `/onboarding/claim` to set their password. `AdminSetUserPassword` works on
`CONFIRMED` users too.

**Fix:**
- [ ] **1.** Adopt only users whose Cognito status is `FORCE_CHANGE_PASSWORD` and who were
  created by onboarding. Tag them at creation, for example with the custom attribute
  `custom:onboarding=EXTERNAL_MERCHANT`. Otherwise return `100032`.
- [ ] **2.** In `claim.ts`, refuse when the Cognito user's status isn't
  `FORCE_CHANGE_PASSWORD` (`resend` already checks this).
- [ ] **3.** Audit existing `CLAIM` rows: list adopted users whose Cognito status was
  `CONFIRMED` when they were adopted.

- [ ] **Verified:** onboarding with the email of a self-registered, confirmed user returns
  `100032` and no token. Claiming a token for a `CONFIRMED` user is refused.

### B7. Card endpoints trust `userId` from the request

Tracked as **F3** in `pci-remediation-plan.md`. It's listed here so the P0 set is complete.
Fix it in the same PR as B1, because both touch `process.ts`.

---

## 3. P1 — High

### B8. Card deposits never reach the Tatum ledger

**Where:** `paymentHandler.ts:269-278` → `creditAccountByVAccountId` (local table only).
Withdrawals debit the Tatum VA first (`tatum.ts:183`); transfers move Tatum ledger funds
(`transfer.ts:65`).

**What goes wrong:** a card deposit raises the local balance only. Withdrawing or
transferring that money fails at Tatum ("insufficient balance"). The withdrawal is rolled
back, so the customer sees a balance they can never use, and the two ledgers disagree from
the first deposit. There is also no on-chain asset behind the credit.

**Fix (needs decision D1):**
- [ ] **1.** Decide where card-deposit liquidity comes from. Options: a Tatum ledger
  transfer from the merchant's master or treasury VA to the customer VA at deposit time,
  or an actual purchase and on-chain transfer.
- [ ] **2.** Implement it inside the deposit success path, idempotent on the payment id.
- [ ] **3.** Choose one balance as the source of truth and reconcile the other on a
  schedule, with alerts on any difference.

- [ ] **Verified:** a card deposit followed by a withdrawal of the same amount succeeds
  end to end.

### B9. Deposits that need 3-D Secure are never credited

**Where:** `paymentHandler.ts:252-264` returns on `requires_action`;
`routes/webhook/stripe.ts:68-103` marks the order succeeded but never credits.

**Fix:**
- [ ] **1.** Store `depositMode`, `vAccountId` and `cryptoAmount` on the `ORDER#META` row when
  it is created.
- [ ] **2.** In `handlePaymentIntentSucceeded`, if the order is a deposit, credit it through
  `creditAccountByVAccountId` with `txId = paymentIntent.id`, so it stays idempotent with
  the synchronous path.

- [ ] **Verified:** a Stripe test card that requires 3DS, once authenticated, credits the
  account exactly once (the webhook delivered twice still credits once).

### B10. Transfers

**Where:** `amplify/service/routes/accounts/transfer.ts`.

**What goes wrong:**
- `amount` is never validated. Negative, zero or non-numeric values go to Tatum and into
  the local writes.
- The four writes (`:77-112`) are separate, unconditional and non-atomic, and `updateItem`
  returns `{success:false}` instead of throwing, so failures are silently ignored. Ledgers
  drift, and a balance can go negative.
- Tatum doesn't know about funds that `withdraw.ts` has already reserved locally. A user can
  start a withdrawal and then transfer the same funds before the worker runs.
- The currency of sender and recipient isn't compared.
- `provider` comes from the body.

**Fix:**
- [ ] **1.** Validate `amount` as a positive finite number with no more decimals than the
  chain allows.
- [ ] **2.** Reject transfers between accounts with different `chain` values.
- [ ] **3.** Reserve locally first, with a conditional `availableBalance >= :amt` debit.
  Then call Tatum, then post both `TX#` rows and the credit in one transaction. Reverse
  the reservation if Tatum fails.
- [ ] **4.** Fix `provider` server-side to `ProviderName.Tatum`.
- [ ] **5.** Make it idempotent on a client `transactionId`.

- [ ] **Verified:** negative, zero and over-balance transfers are rejected. A forced failure
  of the third write leaves both ledgers unchanged.

### B11. Withdrawals

**Where:** `amplify/service/routes/accounts/withdraw.ts`.

**What goes wrong:**
- `amount` and `cryptoAmount` aren't validated (`:89-98`). A negative value passes the
  `availableBalance >= :amount` check and *raises* the balance.
- If the queue send fails, the rollback (`:180-192`) restores `balance` but **not**
  `availableBalance`, so the funds stay locked permanently.
- There is no idempotency: a double-click or client retry creates two withdrawals. The
  client sends a UUID `transactionId` that is never used for this.

**Fix:**
- [ ] **1.** Require a positive finite amount, within the chain's minimum and maximum.
- [ ] **2.** Restore both fields in the rollback (make it atomic, as in B4).
- [ ] **3.** Write a `WDR#<transactionId>` claim in the same transaction as the deduction,
  and return the original result when it repeats.

- [ ] **Verified:** a negative amount gets a 400. A simulated SQS failure restores both
  balance fields. Two identical requests produce one withdrawal.

### B12. TRX fees debited from USDT accounts

**Where:** `balanceUpdateHandler.ts:192-222`.

**What goes wrong:** sweeps send from the customer's USDT_TRON deposit address, and the
TRX network fee for that transaction is paid by that address. `handleFeeEvent` finds the
account by address and debits the TRX amount from the **USDT** balance. Principal events
have a currency check (`:284`); fee events don't.

**Fix:**
- [ ] **1.** Skip (or book against the merchant's fee VA) any fee whose asset doesn't match
  `account.chain`.
- [ ] **2.** Correct balances already affected: find `FEE` rows on token accounts and reverse
  them.

- [ ] **Verified:** a USDT deposit plus sweep leaves the USDT balance equal to the
  deposited amount.

### B13. Processor failover can double charge

**Where:** `utils/PaymentOrchestrator.ts:433-458`; Stripe and Clover processors.

**What goes wrong:** network errors and timeouts are marked `retryable: true`. The
orchestrator then tries the next processor, even though the first charge may have
succeeded. Neither processor sends an idempotency key. With B5 fixed, SQS retries would
also repeat charges.

**Fix:**
- [ ] **1.** Send `Idempotency-Key: <paymentOrderId>-<provider>` to Stripe, and Clover's
  equivalent (`external_reference_id` with a stable value plus an idempotency header).
- [ ] **2.** Fail over only on errors that *prove* no charge happened (4xx before
  authorization, explicit "processor unavailable"). On timeouts, query the first processor
  before trying the second.
- [ ] **3.** Make `paymentHandler` idempotent on `transactionId`: claim it in DynamoDB before
  charging.

- [ ] **Verified:** a Stripe call with a simulated timeout followed by a retry produces one
  charge.

### B14. Undefined error codes turn 400s into 500s

**Where:** `processError(100002 …)` ×6, `100004` ×1, `100030` ×1. The full list is in
`grep -rn "processError(10000[24]\|processError(100030" amplify`. `errors/http.ts:31`
calls `httpErrors[code](params)`, which throws for a missing code.

- [ ] **1.** Add `100002`, `100004` and `100030` to `httpErrors` with sensible messages.
- [ ] **2.** Make `processError` fall back to a generic message instead of throwing on an
  unknown code, and log it.
- [ ] **Verified:** each of the 8 call sites returns a 400 with an `error_code`.

### B15. Merchant master currency case

**Where:** `utils/merchantMaster.ts:41` (saves `MASTER#${currency}` as given);
`utils/masterAccount.ts:343` (looks it up upper-cased); `merchants/register.ts`,
`provision-master.ts` (accept any case through `networkFor`).

- [ ] **1.** Upper-case the currency at the start of `provisionMerchantMaster` and in both
  routes.
- [ ] **2.** Migrate any existing lower- or mixed-case `MASTER#` and `FEEVA#` rows.
- [ ] **Verified:** provisioning with `usdt_tron` creates `MASTER#USDT_TRON`, and a token
  sweep for that merchant succeeds.

### B16. A failed queue send returns no response

**Where:** `accounts/deposit.ts:104-124`, `payments/process.ts:43-59`,
`payments/processGuest.ts:44-60`. When `sendToQueue` returns `{success:false}`, nothing
is returned, and API Gateway answers 502.

- [ ] **1.** Return an explicit error after the `if (result.success)` block in all three.
- [ ] **Verified:** with the queue URL pointed at a non-existent queue, each route returns a
  defined error code.

### B22. Tatum webhook acknowledges deposits it failed to queue

**Where:** `routes/webhook/tatum/accountTransactions.ts:29-42` swallows the enqueue
failure; `cb.ts:20-31` always returns 200.

**What goes wrong:** when the SQS send fails, Tatum still gets 200 and won't redeliver.
The on-chain deposit is never credited locally, and no alert fires.

- [ ] **1.** Return 500 when the enqueue fails, so Tatum retries. The worker is idempotent
  per `txId` once B4 is fixed.
- [ ] **2.** Add a daily reconciliation that compares Tatum VA balances with local balances
  as a backstop.
- [ ] **Verified:** a forced SQS failure returns 500, and Tatum's redelivery is credited
  exactly once.

---

## 4. P2 — Medium

### B17. Unauthenticated WebSocket subscriptions

**Where:** `amplify/fn/websocket/connect.ts:6-29`; `utils/websocket.ts:121-156`.
`userId` and `paymentId` come from the query string, with no auth. Payment results include
the 3DS `clientSecret` and `authenticationUrl`. Fallback transaction ids such as
`dep_${Date.now()}` and `txn_${Date.now()}` can be guessed.

- [ ] **1.** Add a WebSocket `$connect` authorizer that checks the Cognito JWT, and take
  `userId` from it.
- [ ] **2.** Generate transaction ids on the server (UUID) and drop the timestamp
  fallbacks in `deposit.ts:62`, `withdraw.ts:100` and `processGuest.ts:18`.
- [ ] **Verified:** connecting with another user's `userId` is rejected.

### B18. Didit KYC webhook

**Where:** `providers/kyc/DiditKycProvider.ts:46-63`;
`routes/accounts/kyc-webhook-didit.ts`.

- [ ] **1.** Resolve the user from the stored `kyc.sessionId`, not from `vendor_data`. The
  signed string doesn't cover `vendor_data`.
- [ ] **2.** Reject timestamps older than 5 minutes.
- [ ] **3.** Compare lengths before `timingSafeEqual` (it throws on a mismatch, which becomes
  a 500).
- [ ] **Verified:** a signed webhook with a changed `vendor_data` doesn't change another
  user. A bad-length signature returns 401.

### B19. Uncontrolled account creation

**Where:** `routes/accounts/account.ts:17-54`. There are no `allowedRoles`. `userId` falls
back to the merchant key id or a random UUID. `provider` comes from the body. There is no
limit per user, and each account costs about $1 a month in KMS plus a Tatum VA and a
subscription.

- [ ] **1.** Set `allowedRoles: ['user']`, and require the authorizer `userId` (no fallback).
- [ ] **2.** Fix `provider` server-side, and validate `accounting_currency`.
- [ ] **3.** Allow at most one account per user per chain (a conditional put on a
  `CHAIN#<chain>` marker).
- [ ] **Verified:** a second account for the same chain gets a 400. A merchant key gets a
  403.

### B20. Tatum withdrawal fee is not mirrored locally

**Where:** `tatum.ts:143-146`, `:182` (fixed `TRON: '1'` fee debited from the Tatum VA);
local side `withdraw.ts:103` (principal only) plus the later real-fee debit
(`balanceUpdateHandler.ts:192`).

- [ ] **1.** Charge the same fee in both ledgers: include it in the local reservation, and
  stop the separate on-chain fee debit for withdrawals, or the reverse. Document which.
- [ ] **2.** Show "maximum withdrawable = balance − fee" in the withdraw screen.
- [ ] **Verified:** after a native withdrawal, local and Tatum balances are equal.

### B21. Rounding mismatch

**Where:** `withdraw.ts:90`, `:96` (`toFixed(8)`) against `tatum.ts:176` (6 decimals for TRON).
- [ ] Round to the chain's decimals (`DECIMAL_PLACES`) in the route, before reserving.
- [ ] **Verified:** reserved, sent and debited amounts match exactly.

### B23. Crashes on edge inputs

- [ ] `cb.ts:6`: a missing `X-Forwarded-For` causes `undefined.split`. Use
  `requestContext.identity.sourceIp` (as in PCI F10).
- [ ] `cb.ts:28`: an unknown `?type=` calls `undefined()`. Return 400.
- [ ] `utils/params.ts:3`: `body` is `null` → `hasOwnProperty` throws. Treat a missing body
  as `{}`.
- [ ] `/health` is wired in `backend.ts` but not registered in `router.ts`, so it returns 404.
  Add a trivial handler.
- [ ] **Verified:** each case returns a 4xx or 200, never a 500.

### B24. KYC webhook creates phantom profiles

**Where:** `kyc-webhook-didit.ts:28-36` (`updateItem` upserts).
- [ ] Add `conditionExpression: 'attribute_exists(id)'`.
- [ ] **Verified:** a webhook for an unknown user writes nothing.

---

## 5. P3 — Low / Cleanup

- [ ] **B25.** Delete `accountBackfillHandler.ts` and its queue (nothing enqueues to it),
  or fix it to key balances by `vAccountId`. Either way, remove it from the worker's
  routing table until it has a legitimate producer.
- [ ] **B26.** Remove the hardcoded `https://sqs.us-east-2.amazonaws.com/129364817855/...`
  fallbacks (`deposit.ts:100`, `process.ts:40`, `processGuest.ts:40`,
  `accountTransactions.ts:33`). Fail fast when the environment variable is missing.
- [ ] **B27.** Paginate `queryRecord` (follow `LastEvaluatedKey`) or return pages to the
  client for transactions and saved cards.
- [ ] **B28.** `WithdrawView.vue:78`: estimate with the same `<CHAIN>USD` pair the backend
  uses, or get the quote from the backend.

---

## 6. Decisions Needed

| # | Decision | Recommendation | Decision | Date |
|---|---|---|---|---|
| D1 | Where card-deposit liquidity comes from (B8): ledger transfer from a treasury VA, or an actual on-chain purchase | Ledger transfer from the merchant's master VA now; on-chain settlement as a batched treasury job | | |
| D2 | What to do about undercharged Clover deposits (B3) | Finance review of the reconciliation list before deciding | | |
| D3 | Which balance is the source of truth, local or Tatum (B4, B8, B20) | Tatum ledger for funds, local table as a fast cache that is reconciled daily | | |

---

## 7. Execution Plan

The order follows four rules:

1. **Contain before you cure.** Stop ongoing damage with small, reversible changes first,
   then do the real fixes.
2. **Close attack paths before correctness bugs.** A theft path matters more than a rounding
   error.
3. **Build shared foundations once.** Atomic balance writes, amount validation and safe error
   codes are needed by many fixes. Build them first and reuse them.
4. **Turn on retries last.** Retries (B5) redeliver messages, which is only safe once every
   handler is idempotent. Enabling them earlier turns lost messages into double charges and
   double withdrawals.

PCI items (`pci-remediation-plan.md`, F-numbers) are scheduled where they share files with
a bug, so each file is changed once.

### Overview

| Stage | Duration (indicative) | Goal | Items |
|---|---|---|---|
| **0. Contain** | Day 0 (hours) | Stop live damage with reversible changes | Freeze money routes, Clover off, F1, F2, F4 (logging only), preserve evidence |
| **1. Close attack paths** | Days 1–3 | No theft, minting or account takeover | B14 → B1 + B7/F3 + B25 → B2 → B6 → investigate → rotate keys, purge logs |
| **2. Foundations** | Days 3–5 | Shared building blocks and a baseline | Atomic writes, amount validator, redacting logger, reconciliation, decisions D1/D3 |
| **3. Ledger integrity** | Week 2 | Balances are correct under concurrency and failure | B4 → B11 + B21 → B10 → B12 → B13 → B5 → B22 → B16 → data repair |
| **4. Payments correctness** | Weeks 2–3 | Charges and credits match | B3 → F5 + F6 → B9 → B8 → B20 → B15 → B3 reconciliation |
| **Gate** | — | Re-open money routes | All exit criteria of Stages 0–4 met |
| **5. Hardening** | Weeks 3–4 | Remaining auth and abuse paths | F8, F9, F10 + B23, B17, B18, B24, B19, F7, F11 |
| **6. Cleanup** | Ongoing | Tidy up | B26, B27, B28, F12 |

```
Stage 0 ──► Stage 1 ──► Stage 2 ──┬──► Stage 3 (ledger) ──┐
                                  │                        ├──► Gate ──► Stage 5 ──► Stage 6
                                  └──► Stage 4 (payments) ─┘
                                       (starts after 3.1 is merged)
```

---

### Stage 0 — Contain (day 0)

Nothing here needs a redesign. Each step is small and can be undone.

- [ ] **0.1 Freeze money movement in production.** Temporarily set
  `allowedRoles: ['staff']` on `/accounts/withdraw`, `/accounts/transfer`,
  `/accounts/deposit`, `/payments/process` and `/payments/process/guest` in `router.ts`.
  Merchant onboarding stays live. *Why first:* this one change neutralizes B1, B3, B4, B10
  and B11 in production while they are fixed properly. Agree it with the product owner.
- [ ] **0.2 Turn Clover off.** Make `getProviderByCountry` return `'stripe'` and change the
  provider in `deposit.ts:91` to `'stripe'`. This stops B3 undercharging even for staff
  testing.
- [ ] **0.3 Stop writing secrets and card data to logs:** PCI F1 steps 1–4, F2 step 1, and
  F4 steps 1–2. Logging changes only.
- [ ] **0.4 Preserve evidence *before* anything is purged.** Export the CloudWatch log groups
  (`mainApiFn`, the authorizer, the SQS processor, the stream processor) and ask Evervault
  for a copy of the `payments` function logs. Store them in a restricted S3 bucket. Stage 1
  needs these logs for the abuse check and the incident decision. Purging first would
  destroy them.

**Exit:** money routes return 403 for non-staff; new logs contain no keys, card data or
`Authorization` headers; the evidence export exists.

### Stage 1 — Close the attack paths (days 1–3)

- [ ] **1.1 B14 first.** Define 100002, 100004 and 100030 and make `processError` safe
  for unknown codes. *Why first:* every fix in this stage adds new 4xx paths, and today an
  unknown code turns them into 500s.
- [ ] **1.2 B1 (steps 1–5) together with B7 / PCI F3 and B25.** One PR:
  - allowlist the payment message fields,
  - take `userId` from the authorizer in all four card routes,
  - route queue messages by event source,
  - make the withdrawal and sweep handlers re-load key material from the database,
  - remove the backfill queue from the worker's routing,
  - narrow the processor's `kms:Sign` permission.

  These overlap in `process.ts` and the worker, so splitting them would mean editing the
  same lines twice.
- [ ] **1.3 B2.** Ownership check and a field allowlist on `/accounts/details`. This removes
  the source of the key material B1 needed.
- [ ] **1.4 B6.** Adopt only `FORCE_CHANGE_PASSWORD` users created by onboarding; `claim.ts`
  refuses `CONFIRMED` users.
- [ ] **1.5 Investigate**, using the Stage 0.4 export:
  - B1 step 6 (signs of injected queue messages),
  - B6 step 3 (adopted users who were already `CONFIRMED`),
  - PCI D1 (did real card data reach the logs; is notification required).

  Escalate anything found before going on.
- [ ] **1.6 Rotate merchant keys** (PCI F2 step 2, decision PCI D2). This has to come after
  0.3: rotating while the authorizer and stream handler still log keys would leak the new
  keys too.
- [ ] **1.7 Purge old logs** (PCI F1 step 5, F2 step 3, F4 step 3). Only after 1.5 is
  finished and the compliance owner signs off.

**Exit:** e2e regression scripts for B1, B2, B6 and B7 pass on a deployed non-production
stack. All merchant keys created before Stage 0 are revoked.

### Stage 2 — Foundations (days 3–5)

Shared pieces that Stages 3 and 4 depend on. Without them, each fix would invent its own
version.

- [ ] **2.1 `transactWriteItems` supports `Update` and `ConditionCheck`** (`utils/db.ts`).
  Needed by B4, B10, B11 and B9.
- [ ] **2.2 Shared amount validator:** `parseAmount(value, chain)` checks for a positive,
  finite number with at most the chain's decimals. Needed by B10, B11, B21 and B3.
- [ ] **2.3 Redacting logger** (`utils/log.ts`, PCI F7 step 1). All new code from here on
  uses it.
- [ ] **2.4 Reconciliation script and concurrency test script.** Run the reconciliation
  **now** and save the report as the baseline. Without a "before" snapshot, the ledger
  fixes and the B3 undercharging can't be measured.
- [ ] **2.5 Decide D1 and D3** (deposit liquidity, source of truth). This blocks 4.4 and
  4.5, so book the meeting now rather than when Stage 4 starts.

**Exit:** the baseline reconciliation report is saved; D1 and D3 are decided, or have an
owner and a date.

### Stage 3 — Ledger integrity (week 2)

The order inside this stage matters: each step relies on the one before it.

- [ ] **3.1 B4.** Atomic, relative balance changes, with the idempotency claim in the same
  transaction. Everything below uses this pattern.
- [ ] **3.2 B11 + B21.** Withdraw validation, a rollback that restores both fields, a
  `WDR#` idempotency claim, and chain-decimal rounding. All in `withdraw.ts`.
- [ ] **3.3 B10.** Transfer: reserve, then call Tatum, then post. Reuses 3.1 and 2.2.
- [ ] **3.4 B12.** Check the currency on fee events.
- [ ] **3.5 B13.** Payment idempotency: claim the `transactionId`, send processor idempotency
  keys, and only fail over when the first charge provably didn't happen. This makes the
  payment handler safe to retry.
- [ ] **3.6 B5. Turn on retries.** Report `batchItemFailures`, add DLQs and alarms, and mark
  the outcomes that must not be retried. Only now is every retried handler idempotent
  (balance updates 3.1, withdrawals 3.2, payments 3.5, sweeps already claim first,
  backfill removed in 1.2).
- [ ] **3.7 B22.** The Tatum webhook returns 500 when enqueueing fails. This is safe now
  that the consumer is idempotent (3.1).
- [ ] **3.8 B16.** Explicit errors when a queue send fails.
- [ ] **3.9 Data repair.** Re-run the reconciliation from 2.4, fix differences
  (B4 step 4), and reverse `FEE` rows on token accounts (B12 step 2).

**Exit:** the concurrency script ends with exact balances; failures land in the DLQ and
alert; the reconciliation shows no unexplained differences.

### Stage 4 — Payments correctness (weeks 2–3)

This can run **in parallel** with Stage 3 once 3.1 is merged, if a second engineer is
available.

- [ ] **4.1 B3.** Clover minor units and real currency. Verify with a sandbox charge, then
  undo containment step 0.2 to turn Clover routing back on.
- [ ] **4.2 PCI F5 + F6.** Verify cards when they are saved (no stored CVC), and encrypt in
  the browser. This reworks how processor credentials are created, so do it **before** 4.3,
  which touches the same handler.
- [ ] **4.3 B9.** Credit 3DS deposits from the Stripe webhook, idempotent through 3.1.
- [ ] **4.4 B8.** Move card-deposit liquidity into the Tatum ledger (needs D1, D3 and 3.1).
- [ ] **4.5 B20.** Mirror the withdrawal fee in both ledgers (needs D3).
- [ ] **4.6 B15.** Normalize the merchant master currency case and migrate existing rows.
  Doing it here means the sweep and withdrawal tests in this stage run against correct
  rows.
- [ ] **4.7 B3 reconciliation** (step 3) and the finance decision D2. Close this last, once
  amounts are proven correct going forward.

**Exit:** card deposit → withdrawal works end to end in the sandbox, with both ledgers
equal; Clover charge amounts match the request.

### Gate — re-open money movement

- [ ] Stages 0–4 exit criteria all met.
- [ ] The P0 regression scripts pass against **production** configuration.
- [ ] Undo containment step 0.1 (restore the original `allowedRoles`), one route at a time:
  deposit, then transfer, then withdraw. Watch the DLQ and the reconciliation for 24 hours
  between each.

### Stage 5 — Hardening (weeks 3–4)

These are independent of each other, so take them in any order or in parallel.

- [ ] PCI **F8**: body-bound signatures and replay protection. Coordinate with merchants
  if the signed string changes.
- [ ] PCI **F9**: MFA, with a separate staff user pool.
- [ ] PCI **F10 + B23**: verify Tatum webhook signatures, read the client IP from API
  Gateway, fix the crash paths, add `/health`.
- [ ] **B17**: WebSocket authorizer and server-generated transaction ids.
- [ ] **B18 + B24**: Didit webhook resolves the user by session, checks timestamp
  freshness, compares lengths safely, and doesn't create phantom profiles.
- [ ] **B19**: account creation limits and role checks.
- [ ] PCI **F7** (rest): move all remaining logging to the redacting logger.
- [ ] PCI **F11**: log retention policy.

### Stage 6 — Cleanup (ongoing)

- [ ] B26 (hardcoded queue URLs), B27 (pagination), B28 (withdraw estimate pair),
  PCI F12 (stray header). Do these whenever the area is touched again.

### Working rules for every stage

- One bug per PR, except the deliberate bundles marked above (1.2, 3.2, 4.2). Tick the
  plan's checkboxes in the same PR.
- Deploy to a non-production branch, run the bug's verification check there, then promote
  to production.
- Add each bug's e2e check to `amplify/service/routes/e2e/` as a permanent regression test.
- Update the tracker in §1 when a stage's exit criteria are met.

---

## 8. Verification Notes

There is no unit test runner. Verify each fix with:
- new e2e scripts under `amplify/service/routes/e2e/` against a non-production stack (one
  per P0 bug, kept as regression tests),
- a concurrency script for B4, B10 and B11 (parallel `fetch` calls against one account),
- the Tatum and Clover sandboxes for B3, B8, B12 and B20,
- a reconciliation query (local balance compared with `TX#` sums and with Tatum VA
  balance), run before and after each ledger fix.

Things this review could **not** confirm, and should be checked:
- Clover's amount unit in the live API version you use (B3 assumes cents, per Clover's
  e-commerce API docs). Check one sandbox charge before shipping.
- Whether TRON rejects high-S ECDSA signatures. KMS doesn't normalize S
  (`awsKms.ts:150`). If TRON enforces low-S, about half of signatures would fail. Look
  for intermittent withdrawal broadcast rejections in the logs.
