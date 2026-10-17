import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/payments/process'
console.log('path: ', path)

// A payer of the e2e-hmac merchant: since PCI F3 a merchant key may act only for its own payers
const userId = 'e13b35a0-1021-7007-2676-937353245fe2'
// One of that payer's saved cards. It has none yet: save one, then run with CARD_ID=<its id>.
// A card of anyone else is not found by the queue, so nothing would be charged or tested
const paymentId = process.env.CARD_ID
if (!paymentId) {
  console.error('Missing CARD_ID: a saved card of the e2e-hmac payer (see the top of this file)')
  process.exit(1)
}

const body = JSON.stringify({
  paymentId,
  userId,
  amount: 1000,
  currency: 'USD',
  returnUrl: 'https://my.staging.loudibly.com/',
  provider: 'clover'
})

const bodyHash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex')
console.log('bodyHash', bodyHash)

const timestamp = Date.now()
console.log('timestamp', timestamp)

console.log('stringToSign: ', `${path}${timestamp}${bodyHash}`)

// create signature
const signature = crypto
  .createHmac('sha256', Buffer.from(customer.key, 'hex'))
  .update(`${path}${timestamp}${bodyHash}`)
  .digest('base64')
console.log('signature: ', signature)

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-Project': 'e2e-hmac',
  'Authorization': `Signature ${timestamp}:${bodyHash}:${signature}`
}

const url = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/payments/process'
fetch(url, { method: 'POST', body, headers })
  .then(res => res.json())
  .then(data => { console.log(data) })
  .catch(err => console.log(err))

// Expected response:
// {
//   success: true,
//   res: { transactionId: 'pi_...' }
// }
