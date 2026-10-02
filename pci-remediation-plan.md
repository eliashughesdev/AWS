# PCI DSS Remediation Plan

**Scope:** fixes for the PCI DSS issues found while writing Chapter 12 of `overview.md`,
plus four more found while tracing the code for this plan (F2, F4, F5 and F8 below).
**Goal:** no card data or credentials in logs or storage beyond what PCI DSS v4.0 allows,
access control on every card operation, and a verifiable state before a QSA gap
assessment.

> **Correction to `overview.md` §12.5, item 7.** The `X-Project: e2e-hmac` header that the
> React pages send is not a leaked credential. It is a key *id*, and the authorizer ignores
> `X-Project` on the Bearer (JWT) path. It is still worth removing (see F12), but it is
> cosmetic, not a security gap. The report should be updated to say so.

## How to Track Progress

This file is the tracker. Update it in the same PR as the fix, so the plan and the code
change together and git history shows who marked what and when.

**1. Tick steps as they are done.** Every fix step and acceptance check is a checkbox:

```
- [ ] **1.** Not done yet
- [x] **1.** Done
```

GitHub and most editors render these as clickable boxes and show a progress count on the
PR. A step that turns out not to apply is struck through with a reason:
`- [x] ~~**3.** …~~ — N/A: <why>`.

**2. A finding is Done only when all of this is true:**
- every fix step is ticked (or struck through as N/A),
- the **Verified** checkbox is ticked: the acceptance check was run against a deployed
  stack, not just reviewed in code,
- the related evidence item in §6 is ticked.

**3. Update the Progress Tracker (§1)** for that finding:

| Status | Meaning |
|---|---|
| ⬜ Not started | No work yet |
| 🟡 In progress | Branch or PR open; some steps ticked |
| 🔵 Deployed | Fix merged and deployed; acceptance check not run yet |
| ✅ Done | All steps ticked, verified in a deployed stack, evidence filed |
| ⛔ Blocked | Waiting on a decision (§7) or an outside party; name the blocker in Notes |

Fill in **Owner**, **PR** (link or number), and **Done on** (YYYY-MM-DD) as you go.

**4. Close a phase (§2)** when every finding in it is ✅. Tick its exit-criteria box and
record the date.

**5. Record decisions (§7)** by filling in the *Decision* and *Date* columns. Decisions
D1 and D2 block Phase 0.

---

## 1. Findings at a Glance

| ID | Severity | Finding | Where | PCI DSS v4.0 |
|---|---|---|---|---|
| F1 | **Critical** | Evervault Function logs the decrypted card number, expiry and CVC on every charge | `evFunctions/payments/index.js:32`, `:38`, `:83` | 3.3.1, 3.4, 10.3 |
| F2 | **Critical** | Authorizer logs every merchant's HMAC secret key and the full `Authorization` header | `amplify/fn/authorizer/handler.js:30`, `:36`, `:57`, `:113`, `:122` | 3.5, 8.3.2, 8.6.2 |
| F3 | **Critical** | Any authenticated caller can list and charge another user's saved cards (`userId` is taken from the request, not from the authorizer) | `amplify/service/routes/payments/list.ts:15`, `process.ts:14`, `save.ts`, `processGuest.ts:16` | 7.2, 8.2 |
| F4 | **Critical** | Stream handler logs every row change in full. That includes merchant API keys (`v1UserKeysTable`) and saved card rows (`v2CustomerTable`, `PAYMENT#`) | `amplify/fn/stream/handler.ts:15` | 3.5, 10.3 |
| F5 | **High** | Saved cards keep the CVC (inside the encrypted `cardData`) for as long as they exist | `amplify/service/routes/payments/save.ts:25`; frontends `src/pages/AddCard.tsx:74`, `vue-app/src/views/CardsView.vue:133` | 3.3.1.2 |
| F6 | **High** | The "add card" flows send plaintext card JSON and rely on an Evervault Relay config that isn't in the repo and hasn't been checked | `src/pages/AddCard.tsx:39-74`, `vue-app/src/views/CardsView.vue:125-133` | 3.5, 4.2 |
| F7 | **High** | API router and payment worker log full request bodies and messages | `amplify/service/router.ts:68`, `:106`; `paymentHandler.ts:22`, `:191`; `StripePaymentProcessor.ts:153` | 3.4, 10.3 |
| F8 | **High** | HMAC signature allows replay: `bodyHash` is never checked against the body, and future-dated timestamps are never rejected | `amplify/fn/authorizer/handler.js:68`, `:76` | 6.2.4, 8.3 |
| F9 | **High** | No MFA on Cognito. The `staff` group can register merchants and issue API keys with a password only | `amplify/auth/resource.ts` | 8.4.1, 8.4.2 |
| F10 | **Medium** | Tatum callback (`/webhook`) is protected only by an IP allowlist that trusts `X-Forwarded-For[0]`. Its signature check is a TODO | `amplify/service/routes/webhook/cb.ts:23` | 6.2.4 |
| F11 | **Medium** | Log retention isn't defined per log type. Lambda log groups default to "never expire" | `amplify/backend.ts` | 10.5.1, 3.2.1 |
| F12 | **Low** | Hardcoded `X-Project: e2e-hmac` on Bearer requests in 8 React pages | `src/pages/*.tsx` | hygiene |

### Progress Tracker

| ID | Status | Owner | PR | Done on | Notes |
|---|---|---|---|---|---|
| F1 | ⬜ Not started | | | | |
| F2 | ⬜ Not started | | | | |
| F3 | ⬜ Not started | | | | |
| F4 | ⬜ Not started | | | | |
| F5 | ⬜ Not started | | | | |
| F6 | ⬜ Not started | | | | |
| F7 | ⬜ Not started | | | | |
| F8 | ⬜ Not started | | | | |
| F9 | ⬜ Not started | | | | |
| F10 | ⬜ Not started | | | | |
| F11 | ⬜ Not started | | | | |
| F12 | ⬜ Not started | | | | |

---

## 2. Phased Plan

| Phase | When | Findings | Exit criteria | Met | Date |
|---|---|---|---|---|---|
| **0. Stop the leak** | Days 1–2 | F1, F2, F4, F3 | No secrets or card data written to any log; card endpoints enforce ownership; exposed keys rotated | ⬜ | |
| **1. Card storage** | Week 1–2 | F5, F6, F7 | No CVC at rest; encryption enforced in the browser; existing data cleaned | ⬜ | |
| **2. Authentication** | Week 2–3 | F8, F9, F10 | Signatures bind the body and can't be replayed; MFA for staff; webhooks verified | ⬜ | |
| **3. Hygiene & evidence** | Week 3–4 | F11, F12 | Retention policy in code; evidence pack ready for the QSA | ⬜ | |

Phase 0 should ship as its own small deploy and not wait for the rest.

---

## 3. Phase 0 — Stop the Leak

### F1. Remove card data from Evervault Function logs

**Problem.** Inside an Evervault Function the payload is already decrypted.
`index.js:32` logs `_cardData` (the full card JSON), `:38` logs it again on validation
failure, and `:83` logs the outgoing processor request *after* the card number, expiry and
CVC have been put into it. This happens on every first-time charge through Stripe and
Clover.

**Fix.**
- [ ] **1.** Delete the log statements at lines 32, 38 and 83, and the `proxyConfig` dumps at 21–26.
   Keep only the request method, URL host, response status and last-4 digits.
- [ ] **2.** Change `:94` (`Payment provider response`) to log only `id`, `status` and the error code.
   Stripe and Clover responses can include billing details.
- [ ] **3.** Remove the leftover test line at `:7`.
- [ ] **4.** Deploy with the Evervault CLI (the `amplify.yml` conditional only fires when
   `evFunctions/` changes, so this will trigger it).
- [ ] **5.** **Purge existing logs.** Open a ticket with Evervault to delete the `payments` function
   logs back to its first deploy, and get written confirmation (it is needed as evidence).
- [ ] **6.** **Assess exposure.** Decide with the compliance owner whether real (non-test) cards went
   through this function. If they did, this may count as a cardholder-data incident under
   the acquirer agreements. Escalate before anything else.

- [ ] **Verified:** A test charge runs and the Evervault logs for that run contain no 13–19
digit sequences and no `cvc`/`CVC` values.

### F2. Stop logging merchant secrets in the authorizer

**Problem.** `handler.js:57` logs `keys`, which is the full `v1UserKeysTable` row,
including the HMAC secret `key`. `authenticateWithHmacWithKey` logs it again at `:113`,
along with the expected signature (`:122`). `:30` and `:36` log the `Authorization` header
and the whole event. Anyone with CloudWatch read access can impersonate any merchant.

**Fix.**
- [ ] **1.** Remove the log statements at `:30`, `:36`, `:57`, `:60`, `:65`, `:79`, `:87`, and every
   `DEBUG HMAC` line in `authenticateWithHmacWithKey` (`:112-123`). Keep: key id, auth type, allow/deny, and the deny
   reason.
- [ ] **2.** **Rotate every merchant key.** Treat all existing HMAC/RSA keys as compromised. Issue
   new keys through a rotation path (see the decision in §7), send them to merchants
   out of band, and revoke the old ones after a short overlap window.
- [ ] **3.** Delete or expire the authorizer's existing CloudWatch log streams (log group of
   `custom-authorizer-fn`).

- [ ] **Verified:** A signed request produces authorizer logs with no `key`, `Authorization`
or signature values. All keys created before the deploy are revoked.

### F4. Stop the stream handler from logging raw rows

**Problem.** `stream/handler.ts:15` runs `console.log(JSON.stringify(record))` on every
change to `v1UserKeysTable`, `v2CustomerTable` and `v1WebhookIPWhitelistTable`. The streams
use `NEW_AND_OLD_IMAGES`. Merchant registration therefore writes the new API key to
CloudWatch, and every card save writes the encrypted `cardData` (CVC included).

**Fix.**
- [ ] **1.** Replace the log line with metadata only:
   `eventName`, table name (from `eventSourceARN`), and `Keys`. Never log `NewImage` or
   `OldImage`.
- [ ] **2.** The handler doesn't use images for anything yet (its one branch is a TODO). Switch the
   key and customer table streams to `KEYS_ONLY` in `backend.ts` (`:340`, `:354`, `:387`,
   `:397`) until a consumer actually needs the images. This removes the risk at the source.
- [ ] **3.** Purge the stream function's existing log group.
- [ ] **4.** Update `CLAUDE.md`. Its rule "never write a secret into a streamed table" stops being
   the only safeguard.

- [ ] **Verified:** Registering a merchant and saving a card produce stream logs with keys
only.

### F3. Enforce ownership on card endpoints

**Problem.** `/payments/list` reads `userId` from the query string. `/payments/process`,
`/payments/save` and `/payments/process/guest` read it from the body. None of them compare
it with `event.requestContext.authorizer.userId`. Any signed-in customer can list another
customer's cards (which reveals the `paymentId`s) and then charge them.

**Fix.**
- [ ] **1.** In all four handlers, use `event.requestContext.authorizer.userId` as the only source
   of the user identity for `role: 'user'`. Ignore or reject a body or query `userId` that
   differs from it.
- [ ] **2.** For the `admin` role (B2B keys), allow acting on behalf of a user only if that user is
   mapped to the calling platform. Check that `EXT#<platform>#…` maps to the user, or that
   `USERPROFILE.platform` matches.
- [ ] **3.** Add `allowedRoles` to all four routes in `router.ts` (`['user', 'admin']`). Today they
   have none.
- [ ] **4.** Add a new error code to `amplify/errors/http.ts` for "not your resource". Don't reuse
   one blindly (see `CLAUDE.md`).
- [ ] **5.** In `paymentHandler.ts`, add a second check: re-confirm that the `PAYMENT#` row belongs
   to the `userId` in the message. The queue currently trusts its input completely.

- [ ] **Verified:** E2E: user A's JWT calling `/payments/list?userId=<B>` gets a 403 (or only
A's cards). User A calling `/payments/process` with B's `paymentId` gets a 403. A merchant
key acting on a user from another platform gets a 403.

---

## 4. Phase 1 — Card Storage

### F5. Stop keeping the CVC

**Problem.** The saved-card row stores `{ number, cvc, expiry }` (encrypted) indefinitely.
The CVC is read back for the first charge on each processor. Credentials are stored per
provider (`stripeCredentials`, `cloverCredentials`), so a later failover to the other
processor reuses the stored CVC again. PCI DSS 3.3.1.2 doesn't allow keeping the CVC after
authorization, and keeping it until an open-ended future charge doesn't hold up.

**Target design: verify at save time, never store the CVC.**
- [ ] **1.** Make `/payments/save` synchronous for the card-verification step:
   - Pass the encrypted card (with CVC) to the Evervault Function once, in the save
     request.
   - Create the processor credential right away. For Stripe, create a `PaymentMethod` and
     confirm a `SetupIntent` (zero-amount verification, 3DS if needed). For Clover, tokenize
     and create a Customer.
   - Store only `stripeCredentials` / `cloverCredentials`, `lastFour`, `bin`, `cardType`, and
     `expiry`.
- [ ] **2.** **Failover.** Run the same verification against the secondary processor at save time,
   so each processor gets its own credential while the CVC is still available. If the
   secondary fails, the card saves with primary-only credentials and failover is skipped
   for it.
   - *Alternative, if the extra verification is unwanted:* keep the Evervault-encrypted
     PAN and expiry only (allowed under PCI 3.5 because NODA doesn't hold the keys) and
     charge the secondary processor without a CVC. This lowers approval rates and adds
     PAN to the stored data, so it is not recommended.
- [ ] **3.** Change `paymentHandler.ts` (saved-card path) to require stored credentials and never
   read `cardData` from the row.
- [ ] **4.** Change `evFunctions/payments/index.js:37` so a missing `cvc` is allowed for card-on-file
   cases.
- [ ] **5.** **Clean up existing rows.** Write a one-off script that, for every `PAYMENT#` row:
   - if processor credentials exist, `REMOVE cardData` (keep the display fields);
   - if none exist, delete the row and flag the user to re-add the card.

   Run it, log only counts, and keep the output as evidence.
- [ ] **6.** Because of F4, CVC-bearing rows also went through the stream handler and into
   CloudWatch. That is covered by the F4 log purge.

- [ ] **Verified:** No item in `v2CustomerTable` has `cardData` containing `cvc`. The
saved-card charge path works for both processors without `cardData`.

### F6. Encrypt in the browser, everywhere

**Problem.** `AddCard.tsx` has the `evervault.encrypt` call commented out (`:39-60`).
`CardsView.vue:133` never had one. Both send plaintext `{number, cvc, expiry}` to
`RELAY_BASE`. Whether this is safe depends on the Evervault Relay encrypting
`paymentMethod.cardData` before forwarding it, and that setup lives in the Evervault
dashboard, not in this repo. If it is misconfigured, plaintext PANs land in the router log
(F7) and the database.

**Fix.**
- [ ] **1.** **First, check the live Relay.** Export the Relay settings for both environments and
   confirm which fields are encrypted. Then pull a recent `PAYMENT#` row and confirm
   `cardData` is ciphertext (`ev:` prefixed values). If it isn't, treat this as an incident
   in the same way as F1.
- [ ] **2.** Re-enable `evervault.encrypt` in `AddCard.tsx`. Add it to `CardsView.vue` using the
   Evervault JS SDK, following the pattern already in `PaymentWidget.tsx:149-160`.
   Encrypt in the browser *and* keep the Relay as a second layer.
- [ ] **3.** Better still: replace the raw `<input>` fields with **Evervault UI Components**
   (hosted card inputs in an iframe). Card data then never touches NODA's page script,
   which moves the checkout toward SAQ A-style scope. Do this for `PaymentWidget.tsx` too.
- [ ] **4.** Make the backend reject non-ciphertext: `save.ts` and `processGuest.ts` return a 400 if
   `cardData` doesn't look like Evervault ciphertext.
- [ ] **5.** Commit the Relay settings (as documentation or IaC) so the setup can be reviewed.

- [ ] **Verified:** Network capture in the browser shows only `ev:`-encoded values. A request
with a plaintext PAN gets a 400 from the backend.

### F7. Redact application logs

**Problem.** `router.ts:68` logs the whole API Gateway event (headers include
`Authorization`) and `:106` logs every body. `paymentHandler.ts:22` and `:191` log full
messages and processor results. `StripePaymentProcessor.ts:153` logs the full Evervault
result. With F6 unresolved, these could hold plaintext PANs. Even with it resolved, they
hold JWTs, emails and personal data.

**Fix.**
- [ ] **1.** Add a small `utils/log.ts` with a `redact()` helper. It should mask `Authorization`,
   `cardData`, `number`, `cvc`, `key`, `secret`, `password` and `token`, and replace any
   13–19 digit run with `[PAN]`. Use it everywhere a body, event or result is logged.
- [ ] **2.** Remove the event dump at `router.ts:68`. Log `path`, `method`, `requestId`, and the
   role and user id from the authorizer.
- [ ] **3.** Change `router.ts:106`, `paymentHandler.ts:22` and `:191` to log redacted values or
   field names only.
- [ ] **4.** Optional: add a CloudWatch Logs **data protection policy** (built-in managed
   identifiers for credit card numbers) on each log group. This masks matches in the log
   group and gives an audit trail of any that occur.

- [ ] **Verified:** A Logs Insights query over 24 hours of traffic for
`/\b\d{13,19}\b/ or /cvc/ or /Bearer /` returns nothing.

---

## 5. Phase 2 — Authentication

### F8. Make HMAC signatures bind the body and resist replay

**Problem.** The signed string is `path + timestamp + bodyHash`, but nothing recomputes
`bodyHash` from the actual body. A captured signature therefore works with any body. The
freshness check `Date.now() - ts > 10000` also lets any future timestamp through, so a
signature with a far-future timestamp stays valid until that time.

**Fix.**
- [ ] **1.** API Gateway's `REQUEST` authorizer doesn't receive the body. Move body verification
   into `mainApiFn`: in `router.ts`, before dispatch, for `role === 'admin'` requests,
   compute `sha256(rawBody)` and compare it with the `bodyHash` the authorizer passes
   through its `context`. On a mismatch, return a 401.
- [ ] **2.** In the authorizer, reject `|now - ts| > 10s` (both directions).
- [ ] **3.** Optional: store the signature in a short-TTL DynamoDB table with a conditional put, to
   reject exact replays inside the window.
- [ ] **4.** Replace the plain `signature === requestSignature` comparison (`handler.js:125`) with
   `crypto.timingSafeEqual` on equal-length buffers.
- [ ] **5.** Update the e2e signing helper and the merchant integration docs if the canonical
   string changes.

- [ ] **Verified:** E2E: the same signature with a changed body gets a 401. A timestamp 60s in
the future gets a 403. A valid request still succeeds.

### F9. MFA for staff and admins

**Problem.** `defineAuth` has no `multifactor` setting. Cognito MFA applies to the whole
pool, so it can't be required for one group only.

**Fix (recommended).**
- [ ] **1.** Create a **separate Cognito user pool for staff**, with `multifactor: { mode:
   'REQUIRED', totp: true }`, a stricter password policy and no self sign-up.
- [ ] **2.** Teach the authorizer to accept JWTs from that pool, and derive `role: 'staff'` only
   from it. Remove `staff` from the customer pool's groups so a customer-pool token can
   never carry it.
- [ ] **3.** In the customer pool, set `mode: 'OPTIONAL'` and offer TOTP to customers.

*Alternative:* `mode: 'REQUIRED'` on the existing pool. This is simpler, but it forces MFA
on every payer as well, which conflicts with the low-friction onboarding flow.

- [ ] **Verified:** A staff login without a second factor fails. `/merchants/*` rejects
customer-pool tokens.

### F10. Verify Tatum callbacks

**Fix.**
- [ ] **1.** Turn on Tatum's HMAC webhook signing. Store the secret in SSM and verify the
   `x-payload-hash` header against the raw body in `cb.ts` before routing. This resolves
   the TODO at `:23`.
- [ ] **2.** Keep the IP allowlist as a second layer, but take the client IP from
   `event.requestContext.identity.sourceIp`, not from a header the caller controls.

- [ ] **Verified:** A callback with a bad signature gets a 401, even from an allowlisted IP.

---

## 6. Phase 3 — Hygiene & Evidence

### F11. Log retention

- [ ] Set `logRetention` explicitly on every Lambda in `backend.ts`. PCI 10.5.1 asks for 12
months of audit logs, with the last 3 months immediately available. Keep application
DEBUG logs short (for example 30 days), and keep the 1-year API access log group
(`backend.ts:230`). Document the policy.

- [ ] **Verified:** every log group in the account shows a retention period (none "Never
  expire").

### F12. Remove the stray `X-Project` header

- [ ] Delete `'X-Project': 'e2e-hmac'` from the 8 React pages (`src/pages/*.tsx`). It does
nothing on the JWT path and suggests a shared credential that doesn't exist.

- [ ] **Verified:** `grep -rn e2e-hmac src/` returns nothing.

### Evidence pack for the QSA

- [ ] Before/after diffs and deploy dates for every finding.
- [ ] Evervault log-purge confirmation (F1). CloudWatch purge record (F2, F4, F7).
- [ ] Merchant key rotation log (F2).
- [ ] `cardData` cleanup script output (F5).
- [ ] Exported Evervault Relay settings (F6).
- [ ] Logs Insights query results showing no PAN or secret matches (F7).
- [ ] E2E results for F3, F8, F9 and F10.
- [ ] Data-flow diagram of card data (browser → Relay → DynamoDB ciphertext → Evervault
  Function → Stripe/Clover).

---

## 7. Decisions Needed

| # | Decision | Recommendation | Decision | Date |
|---|---|---|---|---|
| D1 | Did real cards pass through the Evervault Function (F1) or reach CloudWatch (F4, F6/F7)? If so, is incident notification required? | Compliance owner decides **before** Phase 0 ships | | |
| D2 | Key rotation for merchants: build a `/merchants/keys/rotate` staff endpoint, or rotate manually? | Build the endpoint. Rotation will be needed again (PCI 8.6.3) | | |
| D3 | Failover design for saved cards (F5) | Verify on both processors at save time | | |
| D4 | Staff MFA design (F9) | Separate staff user pool | | |
| D5 | Move card inputs to Evervault UI Components (F6, step 3) | Yes, for scope reduction | | |

---

## 8. Verification Notes

There is no unit test runner in this repo, so verification relies on:
- the existing e2e scripts under `amplify/service/routes/e2e/` against a deployed
  non-production stack (add new scripts for F3 and F8),
- CloudWatch Logs Insights queries for PAN and secret patterns after each phase,
- a DynamoDB scan for `cardData` containing `cvc` after F5's cleanup.

Each phase should be deployed to a non-production branch first and checked with these
steps before going to production.
