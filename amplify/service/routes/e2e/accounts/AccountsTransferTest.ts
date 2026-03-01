import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/accounts/transfer'
console.log('path: ', path)

const body = JSON.stringify({
  provider: 'TATUM',
  senderAccountId: '69082f6e1a9794c78f868330',
  recipientAccountId: '690c2049b32e1bdb41d8cf78',
  amount: '120.30',
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

const url = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/transfer'
fetch(url, { method: 'POST', body, headers })
  .then(res => res.json())
  .then(data => { console.log(data) })
  .catch(err => console.log(err))

// {
//   success: true,
//   res: { data: { id: '0198d8c8-6144-73ef-97b0-5eb24ec125f2' } }
// }
