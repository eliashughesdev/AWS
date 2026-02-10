import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/payments/list'
console.log('path: ', path)

const userId = '210b5590-3041-7060-f7c6-2fb484965a71'

// For GET requests, body is empty
const body = ''
const bodyHash = crypto.createHash('md5').update(body).digest('hex')
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

const url = `https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/payments/list?userId=${userId}`
fetch(url, { method: 'GET', headers })
  .then(res => res.json())
  .then(data => { console.log(data) })
  .catch(err => console.log(err))

// Expected response:
// {
//   success: true,
//   res: [
//     {
//       id: 'payment-uuid',
//       lastFour: '4242',
//       cardType: 'visa',
//       createdAt: '2024-01-01T00:00:00.000Z'
//     }
//   ]
// }
