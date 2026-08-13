import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/cards/issue'
console.log('path: ', path)

const body = JSON.stringify({
  first_name: 'Test',
  last_name: `User${Date.now()}`,
  email: `e2e-cards-${Date.now()}@loudibly.test`,
  phone_number: '+15555550100',
  card_name: 'E2E test card'
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

const url = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/cards/issue'
fetch(url, { method: 'POST', body, headers })
  .then(res => res.json())
  .then(data => { console.log(data) })
  .catch(err => console.log(err))

// Expected on success:
// { success: true, res: { data: { card_id: '...', masked_number: '**** **** **** 1234', status: 'active', ... } } }
//
// Expected failure modes to watch for:
// - 403 from Ecapz's own API (not Loudibly's authorizer) inside CardsIssueHandler's
//   try/catch, surfaced here as { error_code: 200001, message: 'failed to issue card...' }
//   — most likely cause: BODY_HASH_ALGO in EcapzProvider.ts guessing sha256 instead of
//   the md5 Loudibly's own scheme uses (see the flag left in that file).
// - { error_code: 200002, ... } — ECAPZ_COMPANY_ID not configured in SSM.
