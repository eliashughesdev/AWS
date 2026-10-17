import crypto from 'crypto'
import { customer } from '../credentials'

const base = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com'

const signed = async (path: string, bodyObj: Record<string, unknown>) => {
  const body = JSON.stringify(bodyObj)
  const bodyHash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex')
  const timestamp = Date.now()
  const signature = crypto
    .createHmac('sha256', Buffer.from(customer.key, 'hex'))
    .update(`${path}${timestamp}${bodyHash}`)
    .digest('base64')

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    body,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Project': 'e2e-hmac',
      'Authorization': `Signature ${timestamp}:${bodyHash}:${signature}`,
    },
  })
  const data = await res.json().catch(() => null)
  console.log(path, res.status, data)
  return data
}

const unsigned = async (path: string, bodyObj: Record<string, unknown>) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    body: JSON.stringify(bodyObj),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  })
  const data = await res.json().catch(() => null)
  console.log(path, res.status, data)
  return data
}

const run = async () => {
  const stamp = Date.now()
  const externalId = `ext_resend_${stamp}`

  console.log('--- onboarding (creates the payer) ---')
  const onboarded = await signed('/v1/accounts/onboarding', {
    externalId,
    firstName: 'Ana',
    lastName: 'Gomez',
    email: process.env.ONBOARDING_EMAIL ?? `success+${stamp}@simulator.amazonses.com`,
    chain: 'TRON',
    transaction: { id: `txn_resend_${stamp}`, amount: 25.0, currency: 'EUR', paidAt: new Date().toISOString() },
  })
  const originalToken = onboarded?.res?.data?.claimToken

  console.log('--- resend #1 (expect a fresh claimToken) ---')
  const first = await signed('/v1/accounts/onboarding/resend', { externalId })
  const firstToken = first?.res?.data?.claimToken

  console.log('--- verify the original onboarding token (expect 100036 — resend #1 invalidated it) ---')
  await unsigned('/v1/onboarding/verify', { token: originalToken })

  console.log('--- resend #2 (expect another fresh claimToken) ---')
  const second = await signed('/v1/accounts/onboarding/resend', { externalId })
  const secondToken = second?.res?.data?.claimToken

  console.log('--- verify the resend #1 token (expect 100036 — resend #2 invalidated it) ---')
  await unsigned('/v1/onboarding/verify', { token: firstToken })

  console.log('--- resend for an unknown externalId (expect 100038) ---')
  await signed('/v1/accounts/onboarding/resend', { externalId: `nonexistent_${stamp}` })

  console.log('--- claim the live token (resend #2) ---')
  await unsigned('/v1/onboarding/claim', { token: secondToken, password: 'Sh4sta!Testing' })

  console.log('--- resend after claim (expect 100039) ---')
  await signed('/v1/accounts/onboarding/resend', { externalId })
}

run().catch(err => console.log(err))
