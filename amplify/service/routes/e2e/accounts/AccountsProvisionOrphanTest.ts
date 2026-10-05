import crypto from 'crypto'
import { customer } from '../credentials'

// B30: Tatum rejects the accounting currency, so provisioning fails at its
// first step. Expect a 400 with error_code 100002 and nothing left behind: no
// Tatum account, and no index used under the merchant's seed.

const path = '/v1/accounts/account'

const body = JSON.stringify({
  account_name: `B30 orphan check ${Date.now().toString()}`,
  chain: 'TRON',
  provider: 'PCF0001',
  accounting_currency: 'NOT_A_CURRENCY',
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
  'Authorization': `Signature ${timestamp}:${bodyHash}:${signature}`
}

const url = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/account'
fetch(url, { method: 'POST', body, headers })
  .then(async res => { console.log(res.status, await res.json()) })
  .catch(err => console.log(err))
