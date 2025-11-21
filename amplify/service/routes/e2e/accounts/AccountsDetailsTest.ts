import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/accounts/details'
console.log('path: ', path)

const body = JSON.stringify({ account_id: 'ACCOUNT#PCF00018604bbd641df4bb0aa5243e1e78f5cc4' })

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

const url = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/details'
fetch(url, { method: 'POST', body, headers })
  .then(res => res.json())
  .then(data => { console.log(JSON.stringify(data, null, 2)) })
  .catch(err => console.log(err))
