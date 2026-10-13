# Pending Checks

Things that are done in code but still need a check: on a deployed stack, by a person, or
waiting on something else. Add an item when work is left unconfirmed; tick its boxes as they
are checked, and delete the item once all are ticked (the commit that deletes it says what
was found). Bugs and security findings themselves are tracked in `bug-fix-plan.md` and
`pci-remediation-plan.md`; an item here only points at them.

| # | Check | Where | Since | Waiting on |
|---|---|---|---|---|
| 1 | Didit webhooks pass the new signature check | `main`, then `nodapay_ui` | 2026-10-13 | a webhook sent by Didit |
| 2 | The dashboard still works with the new schemas | `main`, then `nodapay_ui` | 2026-10-13 | a deploy |
| 3 | PCI F3 card ownership, live | `nodapay_ui` | 2026-10-13 | a person (verified on `main`) |
| 4 | The e2e-hmac payment scripts charge a card | `main` | 2026-10-13 | a saved card for `e13b35a0` |
| 5 | The payment queue's consumer is disabled | `main` | 2026-10-13 | a decision |
| 6 | Credentials in an e2e script comment | repo | 2026-10-13 | a person |
| 7 | PCI F4: stream logs keys only; leaked keys rotated | `main`, then `nodapay_ui` | 2026-10-13 | a deploy, then a decision |

---

## 1. Didit webhook signature

`DiditKycProvider.verifyWebhookSignature` now accepts only `X-Signature-V2` (canonical JSON)
or `X-Signature` (raw body), within 300 seconds of `X-Timestamp`; `X-Signature-Simple` is
refused, as it left out `vendor_data`. The unit tests follow Didit's documented algorithm but
cannot prove it matches what Didit really sends. If it does not, every KYC webhook answers
401, which Didit does not retry, so status changes are lost.

On 2026-10-13 the 2026-10-10 delivery on `main` (session `3d1839d2…`, `Expired`) was rebuilt
and signed by hand with the stack's `DIDIT_WEBHOOK_SECRET`, with a fresh timestamp (our logs
keep no body or header, so Didit's own delivery could not be replayed). `X-Signature-V2` and
`X-Signature` were answered 200 and the user's `kyc` row rewritten; `X-Signature-Simple` alone,
a changed `vendor_data` and a 400-second-old timestamp were answered 401. So the deployed path
works; what is still open is whether Didit signs as its documentation says.

- [ ] `main`: send a test webhook from Didit's console ("Try Webhook") or finish a sandbox
      session; the logs show `Didit webhook processed`, not `Didit webhook signature mismatch`
- [ ] `main`: the user's `kyc.status` in `v2CustomerTable` changed
- [ ] `nodapay_ui`: the same, after its deploy

## 2. Schemas on the dashboard's routes

Since 2026-10-13 these routes check their input with Ajv and refuse what they used to accept
or ignore: `/accounts/profile/save`, `/accounts/profile`, `/accounts/list`,
`/accounts/kyc/status`, `/accounts/kyc/didit/session`, `/accounts/kyc/didit/id-verify`
(now also role `user` or `staff` only), and the `/merchants/*` routes. The unit tests show the
clients send what the schemas accept; this checks it end to end.

- [ ] `main`: sign up a new user (the name is saved), open the dashboard (accounts and KYC
      status load), start KYC (Didit opens)
- [ ] `main`: a staff tool or e2e script registers a merchant and provisions a master
- [ ] `nodapay_ui`: the sign-up and dashboard steps, after its deploy

## 3. PCI F3 on `nodapay_ui`

Verified live on `main` (`pci-remediation-plan.md`, F3). `nodapay_ui` was pushed with it on
2026-10-13 (`58c907c`).

- [ ] Check that `nodapay_ui`'s backend deployed from that push, then run
      `amplify/service/routes/e2e/payments/CardOwnershipTest.ts` against its API with a
      throwaway user, and tick F3 there

## 4. e2e-hmac payment scripts

`ProcessPaymentTest.ts` and `RecurringPaymentTest.ts` now charge a card of `e13b35a0`, the
e2e-hmac merchant's payer, and stop without `CARD_ID` because it has none.
`ProcessPaymentInjectionTest.ts` reads its result from the queue processor's logs.

- [ ] Save a card for `e13b35a0`, then run `ProcessPaymentTest.ts` with `CARD_ID=<its id>`
- [ ] Run `RecurringPaymentTest.ts` with the same `CARD_ID`
- [ ] Run `ProcessPaymentInjectionTest.ts` once the consumer runs (item 5); the logs show
      `Payment method not found`

## 5. Payment queue consumer on `main`

The event-source mapping from `v1PaymentProcessingQueue` to `sqsV1WebhookProcessorFn` is
**Disabled**; it last ran on 2026-10-08. Payments sent to `/payments/process` are queued and
never charged.

- [ ] Find out whether it was disabled on purpose; enable it, or note here why not

The three DynamoDB stream mappings of `streamTopicHandlerFn` on `main` were disabled on
2026-10-09 around 07:00 UTC, each saying "PROBLEM: Resource owner account is disabled". The
account may have been suspended briefly then, and every event-source mapping was left
disabled; this consumer may be one of them.

## 6. Credentials in `AccountsTransferRBACTest.ts`

A comment at line 34 holds a test user's sign-in name and password.

- [ ] Check whether the password is real; if it is, change it in Cognito and remove it from
      the comment (it stays in git history)

## 7. PCI F4: stream logs

`fn/stream/handler.ts` logs only each change's event, table and keys, and the streams are
`KEYS_ONLY` (`pci-remediation-plan.md`, F4). The switch gives each table a new stream, so the
deploy replaces the stream mappings, which on `main` also brings back the ones left disabled
(item 5).

- [ ] `main`: after the deploy, the stack updated without error and `streamTopicHandlerFn`'s
      three mappings are Enabled
- [ ] `main`: register a merchant and save a card; the stream logs show only
      `Stream record: {"eventName":…,"table":…,"keys":…}`
- [ ] Rotate the five keys of `main`'s `v1UserKeysTable` (all are in the logs), then purge the
      stream log groups (F4 steps 3 and 3a); this changes the keys the e2e scripts sign with
- [ ] `nodapay_ui`: the same checks after its deploy; purge its group (customer rows, no keys)
