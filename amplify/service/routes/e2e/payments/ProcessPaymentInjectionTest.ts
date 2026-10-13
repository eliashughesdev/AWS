import crypto from 'crypto'
import { customer } from '../credentials'

// B1: a payment request that tries to pick the queue handler. The API answers
// 200 "queued" either way; the proof is in sqsV1WebhookProcessorFn's logs.
// Before the fix the message runs the sweep handler ("ROUTER: Processing message
// for queue: v1-sweep-queue"). After it, it stays a payment and fails with
// "Payment method not found". The payment id doesn't exist, so nothing is charged.

const path = '/v1/payments/process'
const marker = `b1-probe-${Date.now()}`
console.log('marker:', marker)

const body = JSON.stringify({
  paymentId: marker,
  // A payer of e2e-hmac: since PCI F3 a made-up user is refused before anything is queued
  userId: 'e13b35a0-1021-7007-2676-937353245fe2',
  amount: 1,
  currency: 'USD',
  transactionId: marker,
  queue: 'v1-sweep-queue',
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

const url = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/payments/process'
fetch(url, { method: 'POST', body, headers })
  .then(async res => { console.log(res.status, await res.json()) })
  .catch(err => console.log(err))
