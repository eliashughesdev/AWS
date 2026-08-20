import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/accounts/withdraw'
console.log('path: ', path)

const body = JSON.stringify({
  accountNumber: 'PCF000126711815e0f1481591e2cf11e2edbc88',
  currency: 'USD',
  amount: 10.00,
  destinationAddress: 'TBypofoy6CJaSY1VrcrUjgFzDCNer7iVLW',
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

const url = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/withdraw'
fetch(url, { method: 'POST', body, headers })
  .then(res => res.json())
  .then(data => { console.log(data) })
  .catch(err => console.log(err))

// Expected response:
// {
//   success: true,
//   jobId: '...',
//   transactionId: 'wdr_...',
//   status: 'queued',
//   message: 'Withdrawal is being processed',
//   res: {
//     cryptoAmount: 0.39,       ← SOL being sent to destination
//     cryptoCurrency: 'SOL',
//     exchangeRate: 127.50,     ← current SOL/USD from Binance
//   }
// }

// Error cases:
// { error_code: 100001, message: 'this account id does not exist or not active' }
// { error_code: 100005, message: 'this account does not belong to the provided user' }
// { error_code: 100007, message: 'insufficient balance for this withdrawal' }
// { error_code: 100008, message: 'destination address required for crypto withdrawal' }
