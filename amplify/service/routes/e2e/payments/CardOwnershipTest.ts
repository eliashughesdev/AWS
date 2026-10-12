import crypto from 'crypto'
import { customer } from '../credentials'

// PCI F3, live: the card routes act only for the caller's own user. Needs the backend deployed
// with utils/payer.ts. Every value comes from the environment, so no token is kept in the file:
//
//   USER_A_TOKEN            optional: a Cognito access token of user A (see
//                           AccountsTransferRBACTest.ts for admin-initiate-auth); without it
//                           only the merchant key's checks run
//   USER_B_ID, USER_B_CARD  with USER_A_TOKEN: another user's Cognito id and one of their cards
//   OTHER_MERCHANT_USER_ID  a payer of a merchant other than e2e-hmac
//   OWN_PAYER_ID            optional: a payer of e2e-hmac, to see the key's allowed case
//
//   USER_A_TOKEN=... USER_B_ID=... USER_B_CARD=... OTHER_MERCHANT_USER_ID=... \
//     npx tsx amplify/service/routes/e2e/payments/CardOwnershipTest.ts
//
// Nothing here can charge a card: every payment it sends is refused, or names a card the
// caller does not own, which the queue does not find ("Payment method not found" in the
// webhook processor's logs).

const api = process.env.API_URL ?? 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1'
const env = (name: string) => {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}; see the top of this file`)
    process.exit(1)
  }
  return value
}

const userToken = process.env.USER_A_TOKEN
const otherMerchantsUser = env('OTHER_MERCHANT_USER_ID')
const ownPayer = process.env.OWN_PAYER_ID

const asMerchant = (path: string, body: string) => {
  const timestamp = Date.now()
  const bodyHash = crypto.createHash('md5').update(body).digest('hex')
  const signature = crypto.createHmac('sha256', Buffer.from(customer.key, 'hex'))
    .update(`/v1${path}${timestamp}${bodyHash}`).digest('base64')
  return { 'X-Project': 'e2e-hmac', Authorization: `Signature ${timestamp}:${bodyHash}:${signature}` }
}

let failed = 0
const check = async (name: string, path: string, init: { method: string, headers: Record<string, string>, body?: string, query?: string },
  expected: { status: number, errorCode?: number }) => {
  const res = await fetch(`${api}${path}${init.query ?? ''}`, {
    method: init.method,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    body: init.body,
  })
  const body = await res.json().catch(() => ({}))
  const ok = res.status === expected.status && (expected.errorCode === undefined || body.error_code === expected.errorCode)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${res.status} ${body.error_code ?? ''}${ok ? '' : ` (expected ${expected.status} ${expected.errorCode ?? ''})`}`)
}

const userChecks = async (token: string, userB: string, cardOfB: string) => {
  const asUser = { Authorization: `Bearer ${token}` }
  await check('user A lists their own cards with no userId', '/payments/list',
    { method: 'GET', headers: asUser }, { status: 200 })
  await check('user A cannot list user B\'s cards', '/payments/list',
    { method: 'GET', headers: asUser, query: `?userId=${encodeURIComponent(userB)}` }, { status: 403, errorCode: 100053 })
  await check('user A cannot charge user B\'s card in B\'s name', '/payments/process',
    { method: 'POST', headers: asUser, body: JSON.stringify({ paymentId: cardOfB, userId: userB, amount: 1, currency: 'USD' }) },
    { status: 403, errorCode: 100053 })
  // Queued as user A, so the queue looks for B's card under A and finds nothing
  await check('user A\'s payment with B\'s card id is queued as A (check the logs)', '/payments/process',
    { method: 'POST', headers: asUser, body: JSON.stringify({ paymentId: cardOfB, amount: 1, currency: 'USD', transactionId: `f3-probe-${Date.now()}` }) },
    { status: 200 })
}

const run = async () => {
  if (userToken) await userChecks(userToken, env('USER_B_ID'), env('USER_B_CARD'))
  else console.log('SKIP  the signed-in user\'s checks: no USER_A_TOKEN')

  const query = `?userId=${encodeURIComponent(otherMerchantsUser)}`
  await check('a merchant key cannot list another merchant\'s user\'s cards', '/payments/list',
    { method: 'GET', headers: asMerchant('/payments/list', ''), query }, { status: 403, errorCode: 100053 })
  await check('a merchant key must name a user', '/payments/list',
    { method: 'GET', headers: asMerchant('/payments/list', '') }, { status: 400, errorCode: 100029 })
  if (ownPayer) {
    await check('a merchant key lists its own payer\'s cards', '/payments/list',
      { method: 'GET', headers: asMerchant('/payments/list', ''), query: `?userId=${encodeURIComponent(ownPayer)}` }, { status: 200 })
  }

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed. For the queued probe, look for "Payment method not found" in the webhook processor\'s logs.')
  process.exit(failed ? 1 : 0)
}

run()
