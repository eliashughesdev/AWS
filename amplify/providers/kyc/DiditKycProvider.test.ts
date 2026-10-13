import { createHmac } from 'crypto'
import { DiditKycProvider } from './DiditKycProvider'

const secret = 'test-webhook-secret'
const now = 1_791_850_000_000
const timestamp = String(now / 1000)
const sign = (payload: string) => createHmac('sha256', secret).update(payload, 'utf8').digest('hex')

// As Didit sends it: keys unsorted, a nested object, a whole-valued float, non-ASCII text
const raw = '{"webhook_type":"status.updated","status":"Approved","session_id":"s-1","vendor_data":"user-a",' +
  '"decision":{"name":"José","score":1.0,"checks":[{"b":2,"a":1}]},"created_at":1791849990}'
// Didit's canonical form of it for X-Signature-V2, written out by hand
const canonical = '{"created_at":1791849990,"decision":{"checks":[{"a":1,"b":2}],"name":"José","score":1},' +
  '"session_id":"s-1","status":"Approved","vendor_data":"user-a","webhook_type":"status.updated"}'

// The router parses the body and keeps the original string as rawBody
const delivery = (headers: Record<string, string>, body = raw) =>
  ({ headers: { 'x-timestamp': timestamp, ...headers }, body: JSON.parse(body), rawBody: body })

let provider: DiditKycProvider
beforeAll(() => {
  Object.assign(process.env, { DIDIT_API_KEY: 'k', DIDIT_WEBHOOK_SECRET: secret, DIDIT_WORKFLOW_ID: 'w', DIDIT_CALLBACK_URL: 'https://example.com' })
  provider = DiditKycProvider.create()
})

describe('DiditKycProvider.verifyWebhookSignature', () => {
  it('accepts X-Signature-V2 over the canonical payload', () => {
    expect(provider.verifyWebhookSignature(delivery({ 'x-signature-v2': sign(canonical) }), now)).toBe(true)
  })

  it('reads the headers in any case', () => {
    const event = { ...delivery({}), headers: { 'X-Timestamp': timestamp, 'X-Signature-V2': sign(canonical) } }
    expect(provider.verifyWebhookSignature(event, now)).toBe(true)
  })

  it('accepts X-Signature over the raw bytes', () => {
    expect(provider.verifyWebhookSignature(delivery({ 'x-signature': sign(raw) }), now)).toBe(true)
  })

  // The replay X-Signature-Simple allowed: its string leaves out vendor_data
  it('refuses a genuine delivery whose vendor_data was changed', () => {
    const forged = raw.replace('"user-a"', '"user-b"')
    expect(provider.verifyWebhookSignature(delivery({ 'x-signature-v2': sign(canonical), 'x-signature': sign(raw) }, forged), now)).toBe(false)
  })

  it('no longer accepts X-Signature-Simple', () => {
    const simple = sign(`${timestamp}:s-1:Approved:status.updated`)
    expect(provider.verifyWebhookSignature(delivery({ 'x-signature-simple': simple }), now)).toBe(false)
  })

  it.each([
    ['older than 300 seconds', now + 301_000],
    ['more than 300 seconds ahead', now - 301_000],
  ])('refuses a timestamp %s', (_, at) => {
    expect(provider.verifyWebhookSignature(delivery({ 'x-signature-v2': sign(canonical) }), at)).toBe(false)
  })

  it('refuses a delivery with no timestamp', () => {
    const event = delivery({ 'x-signature-v2': sign(canonical) })
    delete (event.headers as any)['x-timestamp']
    expect(provider.verifyWebhookSignature(event, now)).toBe(false)
  })

  // timingSafeEqual threw on it, which answered 500
  it('refuses a signature of the wrong length without throwing', () => {
    expect(provider.verifyWebhookSignature(delivery({ 'x-signature-v2': 'abc', 'x-signature': 'é'.repeat(64) }), now)).toBe(false)
  })

  it('refuses a delivery with no signature', () => {
    expect(provider.verifyWebhookSignature(delivery({}), now)).toBe(false)
  })
})
