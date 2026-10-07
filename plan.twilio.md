# Plan: Twilio Email as the primary email provider

**Goal:** make Twilio Email the primary email provider for every email we send, including
Cognito's sign-up and reset emails, with Amazon SES kept as the automatic fallback.

**Decided (2026-10-07):**
- **E1:** **Twilio Email** (`comms.twilio.com`, Twilio Account SID plus an API key), not SendGrid.
- **E2:** **Twilio first, SES as fallback** when Twilio fails with a retryable error.
- **E3:** **Cognito emails move to Twilio** through a Cognito custom email sender (step 7), and so
  get the same SES fallback.

## Today

| Integration | Code | Used for | Configuration |
|---|---|---|---|
| Amazon SES | `EmailProvider` interface (`amplify/providers/email/EmailProvider.ts`), `SesEmailProvider`, selected by `EMAIL_PROVIDER` (`amplify/utils/EmailProvider.ts`) | Onboarding claim invite (`utils/claimInvite.ts`), welcome email (`routes/accounts/account.ts:80`). Both non-fatal | Per environment in SSM: `EMAIL_PROVIDER` (default `AWS_SIMPLE_EMAIL_SERVICE`) and `SES_FROM_EMAIL`. Sends from the Lambda's region, so SES must be set up in each environment's account and region |
| Cognito email | `amplify/auth/resource.ts`, custom-message trigger `amplify/auth/custom-message/handler.ts` | Sign-up confirmation code and resend, Cognito's own messages | `defineAuth` sets no email sender, so every environment uses `COGNITO_DEFAULT`: sends from `no-reply@verificationemail.com`, about 50 emails a day |

## What stays, what changes

- **SES stays** as a provider (`SesEmailProvider`) and becomes the fallback. In each environment it
  needs a verified sending domain and production access, or the fallback fails too.
- **Code defaults don't change:** without the new SSM settings, `EMAIL_PROVIDER` still defaults
  to `AWS_SIMPLE_EMAIL_SERVICE`, so an environment only switches when configured.
- **Callers:** the invite and welcome emails keep calling `getEmailProvider().sendEmail(...)` and
  don't change.
- **Cognito changes:** its emails stop using Cognito's built-in sender (`COGNITO_DEFAULT`, about
  50 a day) and go through our custom email sender and `getEmailProvider()` (step 7).

## Steps

### 1. Twilio and DNS setup (console, no code; per sending domain)

Each environment sends from the domain of its `EMAIL_FROM_ADDRESS`. For every such domain:

- [ ] Verify it as a sender in Twilio.
- [ ] Verify it in SES as well, in the environment's AWS account and region, and request SES
  production access there. Both providers can share one domain:
  - **SPF:** one record that includes both, staying under SPF's limit of 10 DNS lookups.
  - **DKIM:** a separate key per provider.
  - **DMARC:** one policy covering both.
- [ ] Create a dedicated **Twilio API key** per environment for email rather than using the main
  auth token, so each can be revoked on its own.

### 2. Settings in SSM (`/loudibly/api/`, per environment)

- [ ] `TWILIO_ACCOUNT_SID` (String), `TWILIO_API_KEY_SID` and `TWILIO_API_KEY_SECRET`
  (SecureString). `loadConfig()` already decrypts SecureStrings into the environment
  (`utils/ssm.ts`).
- [ ] `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME`, used by every provider. Twilio wants the address
  and the name separately. When they aren't set, fall back to `SES_FROM_EMAIL` so existing
  environments keep working.
- [ ] `EMAIL_PROVIDER=TWILIO_EMAIL` (new value) and `EMAIL_FALLBACK_PROVIDER=AWS_SIMPLE_EMAIL_SERVICE`
  (step 4).

### 3. `TwilioEmailProvider`

File: `amplify/providers/email/twilio/TwilioEmailProvider.ts`.

- [ ] **Request:** `POST https://comms.twilio.com/v1/Emails` with plain `fetch` and Basic auth (API
  key SID and secret). Body: `from: {address, name}`, `to: [{address}]`,
  `content: {subject, text, html}`. No SDK needed.
- [ ] **Responses:**
  - `202` means accepted and queued, not delivered. Log the returned `operationId` so a
    delivery can be traced later.
  - `400` or `401`: throw straight away.
  - `429` or `5xx`: at most two short retries. The API Lambda has a 28-second limit, and
    email sends are non-fatal.
- [ ] **Logging (lesson from B29):** never log the request, its headers or its body. On failure,
  log only the status and Twilio's error message. The invite email contains the password-claim
  link, which works like a password.
- [ ] **Registration:** add `TWILIO_EMAIL: () => new TwilioEmailProvider()` to the provider map in
  `amplify/utils/EmailProvider.ts`.
- [ ] **Interface:** change `sendEmail` to return `{ provider, messageId? }` instead of `void`. SES
  returns its `MessageId`, Twilio its `operationId`. Callers only `await` it, so they don't
  change.

### 4. Fallback: Twilio first, then SES (E2)

- [ ] A `FailoverEmailProvider` wraps the primary (Twilio) and the fallback (SES). It moves to SES
  only on retryable failures: network errors, `429`, `5xx`, or a timeout. A `400` or `401` from
  Twilio is a bug or a config problem, so it throws instead of hiding behind SES.
- [ ] `getEmailProvider()` returns the failover wrapper when `EMAIL_FALLBACK_PROVIDER` is set, and
  logs which provider sent each email.
- **Risk:** if the primary accepted the email but the response was lost, the user gets it twice.
  That's acceptable for invite and welcome emails.

### 5. Claim-link safety and compliance

- [ ] Make sure Twilio's click tracking is off for these emails (or for the account). Otherwise the
  set-password link is rewritten through Twilio's tracking domain.
- [ ] Add Twilio to the list of companies that process user emails and personal data (GDPR, PCI
  scope review).

### 6. Testing and rollout

- [ ] **Offline test:** `scripts/checks/emailProvider.ts`, in the same style as the existing
  `scripts/checks/*`, with `fetch` mocked. It covers the request shape, the retry and no-retry
  cases, the fallback, and that no secret ever appears in logs. A second check covers the custom
  email sender: each trigger source builds the right email, and the code never reaches a log.
- [ ] **Rollout, repeated per environment** (start with a non-production one):
  1. Complete steps 1 and 2 for that environment, and deploy the code to it.
  2. Set `EMAIL_PROVIDER=TWILIO_EMAIL` in SSM. It takes effect within about a minute, with no
     redeploy.
  3. Trigger `/accounts/onboarding/resend` to a test address.
  4. Check with the `aws-logs` skill (it picks the environment from the branch) and in Twilio's
     console.
  5. Force the fallback once (e.g. a wrong Twilio API key secret in SSM) and confirm SES sends.
  6. Deploy the Cognito custom email sender (step 7) and run a sign-up, a resend and a password
     reset with a test address.
- [ ] **Rollback:**
  - App emails: set `EMAIL_PROVIDER` back to `AWS_SIMPLE_EMAIL_SERVICE` in SSM (no deploy).
  - Cognito emails: a redeploy without the custom email sender returns Cognito to its built-in
    sender.

### 7. Cognito emails through Twilio (E3)

Cognito's **custom email sender** trigger hands every email it would send to our Lambda, with the
code or temporary password encrypted under our KMS key. The Lambda decrypts it and sends through
`getEmailProvider()`, so Cognito emails get Twilio first and SES as fallback like everything else,
and Cognito's 50-a-day limit goes away.

- [ ] **KMS key:** a symmetric key for Cognito to encrypt codes with. Only the sender Lambda's role
  may `kms:Decrypt`; Cognito's service principal may encrypt.
- [ ] **Lambda:** `amplify/auth/custom-email-sender/` (handler and resource). It decrypts the code
  with the AWS Encryption SDK (`@aws-crypto/client-node`), as Cognito requires, then builds and
  sends the email. It never logs the code, the decrypted payload or the email body.
- [ ] **Wiring:** `defineAuth` in `amplify/auth/resource.ts` (`@aws-amplify/backend` is `^1.16.1`).
  Use its custom email sender support (`senders.email`) if the installed version has it; if not,
  set the user pool's `lambdaConfig.customEmailSender` and KMS key through a CDK override in
  `backend.ts`.
- [ ] **Messages:** handle every trigger source: `CustomEmailSender_SignUp`, `_ResendCode`,
  `_ForgotPassword`, `_UpdateUserAttribute`, `_VerifyUserAttribute`, `_AdminCreateUser` and
  `_AccountTakeOverNotification`. Move the branded sign-up template (with the one-click confirm
  link to `FRONTEND_URL`) out of the custom-message trigger into `utils/emailTemplates.ts`, and add
  templates for the others.
- [ ] **AdminCreateUser:** onboarding already suppresses Cognito's invite
  (`MessageAction: 'SUPPRESS'`, `utils/cognito.ts:49`) and sends its own claim invite, so nothing
  changes there.
- [ ] **Custom-message trigger:** once the sender is live it no longer shapes emails. Remove it,
  or keep it only if SMS is added later.
- **Risk:** if both Twilio and SES fail, users can't confirm sign-ups or reset passwords, where
  today Cognito's own sender would still work. That's why SES must be working in an environment
  before step 7 ships there, and why the rollout tests a forced fallback.

## Decisions

| # | Decision | Options | Decision | Date |
|---|---|---|---|---|
| E1 | Product | Twilio Email or Twilio SendGrid | **Twilio Email** | 2026-10-07 |
| E2 | Fallback (step 4) | Off, Twilio → SES, or SES → Twilio | **Twilio → SES** | 2026-10-07 |
| E3 | Cognito emails (step 7) | Stay on Cognito/SES, or move to the custom email sender | **Move to the custom email sender, through Twilio (SES fallback)** | 2026-10-07 |
