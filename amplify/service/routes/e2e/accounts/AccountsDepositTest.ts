import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/accounts/deposit'
console.log('path: ', path)

const body = JSON.stringify({
  accountNumber: 'your-account-number-here',
  currency: 'USD',
  amount: 50.00,
  paymentId: '2b987037-5b9b-472c-93e3-c29e2e5c99c2',  // saved card reference from /payments/save
  userId: '210b5590-3041-7060-f7c6-2fb484965a71',
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

const url = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/deposit'
fetch(url, { method: 'POST', body, headers })
  .then(res => res.json())
  .then(data => { console.log(data) })
  .catch(err => console.log(err))

// Expected response:
// {
//   success: true,
//   jobId: '...',
//   transactionId: 'dep_...',
//   status: 'queued',
//   message: 'Deposit is being processed'
// }
