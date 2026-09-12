import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/accounts/onboarding'

const stamp = Date.now()

const body = JSON.stringify({
  externalId: `ext_${stamp}`,
  firstName: 'Juan',
  lastName: 'Perez',
  email: process.env.ONBOARDING_EMAIL ?? `success+${stamp}@simulator.amazonses.com`,
  merchantId: 'mrc_test_01',
  // Required: no server-side default, so a missing or unsupported value is rejected
  // (100029 / 100009) rather than silently creating the wrong kind of account.
  chain: 'TRON',
  transaction: {
    id: `txn_${stamp}`,
    amount: 50.0,
    currency: 'EUR',
    paidAt: new Date().toISOString(),
  },
})

const bodyHash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex')
const timestamp = Date.now()

const signature = crypto
  .createHmac('sha256', Buffer.from(customer.key, 'hex'))
  .update(`${path}${timestamp}${bodyHash}`)
  .digest('base64')

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-Project': 'e2e-hmac',
  'Authorization': `Signature ${timestamp}:${bodyHash}:${signature}`,
}

const url = `https://siao2sha29.execute-api.us-east-2.amazonaws.com${path}`

console.log('body: ', body)

fetch(url, { method: 'POST', body, headers })
  .then(res => res.json())
  .then(data => { console.log(data) })
  .catch(err => console.log(err))


