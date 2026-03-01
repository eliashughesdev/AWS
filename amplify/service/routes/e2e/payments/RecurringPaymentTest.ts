import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/payments/process'
console.log('path: ', path)

// A payment method that has already been charged at least once so that
// cloverCredentials / stripeCredentials are saved in v2CustomerTable.
const paymentId = 'fe4fa0d6-1f80-4a23-81ee-b7e2692d91b0'
const userId = '210b5590-3041-7060-f7c6-2fb484965a71'

const body = JSON.stringify({
  paymentId,
  userId,
  amount: 1000,
  currency: 'USD',
  provider: 'clover',
  offSession: true,
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

// Expected response (queued — result arrives via WebSocket):
// {
//   success: true,
//   res: { jobId: '...', paymentId: '...', status: 'queued' }
// }
//
// The SQS processor will use the stored cloverCredentials.customerId
// to charge via POST /v1/charges with stored_credentials: SUBSEQUENT.
// No card data is transmitted.
