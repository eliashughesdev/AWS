import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/accounts/deposit'
console.log('path: ', path)

const body = JSON.stringify({
  accountNumber: 'PCF0001b18be663c3c743938a5021fd41503e50',  // SOL crypto account
  currency: 'USD',                                            // fiat you are paying with
  amount: 50.00,                                              // fiat amount to charge on card
  paymentId: '2b987037-5b9b-472c-93e3-c29e2e5c99c2',
  userId: 'ed7d6f38-6cb2-4584-8dbf-6e6f9bb5ad25',
  email: 'user@example.com',
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
//   res: {
//     cryptoAmount: 0.39,       ← SOL you will receive
//     cryptoCurrency: 'SOL',
//     exchangeRate: 127.50,     ← current SOL/USD from Binance
//   }
// }
