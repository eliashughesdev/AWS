import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/payments/process'
console.log('path: ', path)

const body = JSON.stringify({
    paymentId: '100e5016-a152-474c-8d49-527d3c3edad',
    userId: '210b5590-3041-7060-f7c6-2fb484965a71',
    amount: 1000,
    currency: 'USD'
});

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