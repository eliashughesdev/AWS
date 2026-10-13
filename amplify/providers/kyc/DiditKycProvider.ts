import axios from 'axios'
import { createHmac, timingSafeEqual } from 'crypto'

// Didit's limit on the gap between X-Timestamp and now
const WEBHOOK_MAX_AGE_S = 300

// API Gateway passes headers in the case they were sent
const header = (event: any, name: string): string | undefined => {
  const key = Object.keys(event.headers ?? {}).find(k => k.toLowerCase() === name)
  return key ? event.headers[key] : undefined
}

// Didit's canonical JSON for X-Signature-V2: keys sorted at every level, arrays in order.
// JSON.stringify then writes it compactly, keeps non-ASCII characters as they are and
// writes whole numbers without a decimal point, as Didit does
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, sortKeys(object[key])]))
  }
  return value
}

// timingSafeEqual throws on buffers of different lengths, which a forged header could have
const sameSignature = (received: string | undefined, expected: string): boolean => {
  if (!received) return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export class DiditKycProvider {
  private constructor(
    private apiKey: string,
    private webhookSecret: string,
    private workflowId: string,
    private callbackUrl: string
  ) {}

  static create(): DiditKycProvider {
    const apiKey = process.env.DIDIT_API_KEY
    const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET
    const workflowId = process.env.DIDIT_WORKFLOW_ID
    const callbackUrl = process.env.DIDIT_CALLBACK_URL

    if (!apiKey || !webhookSecret || !workflowId || !callbackUrl) {
      throw new Error('Missing Didit environment variables')
    }

    return new DiditKycProvider(apiKey, webhookSecret, workflowId, callbackUrl)
  }

  async createSession(userId: string): Promise<{ sessionId: string; verificationUrl: string }> {
    const diditResponse = await axios.post(
      'https://verification.didit.me/v3/session/',
      {
        workflow_id: this.workflowId,
        callback: this.callbackUrl,
        vendor_data: userId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        }
      }
    )

    // Didit returns 'url', not 'verification_url' as the docs say
    const { session_id: sessionId, url: verificationUrl } = diditResponse.data
    return { sessionId, verificationUrl }
  }

  /**
   * Whether the webhook came from Didit (docs.didit.me/integration/webhooks). X-Signature-V2
   * covers the whole payload, re-encoded the way Didit does it, so it survives the router's
   * JSON.parse; X-Signature covers the exact bytes, which the router keeps as rawBody.
   * X-Signature-Simple is not accepted: it leaves out vendor_data, the user the status is
   * written to, so one genuine delivery could be replayed for any user. Neither signature
   * covers X-Timestamp, which only bounds how late a delivery may arrive.
   */
  verifyWebhookSignature(event: any, now = Date.now()): boolean {
    const timestamp = Number(header(event, 'x-timestamp'))
    if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > WEBHOOK_MAX_AGE_S) return false

    const sign = (payload: string) => createHmac('sha256', this.webhookSecret).update(payload, 'utf8').digest('hex')
    if (sameSignature(header(event, 'x-signature-v2'), sign(JSON.stringify(sortKeys(event.body))))) return true
    return typeof event.rawBody === 'string' && sameSignature(header(event, 'x-signature'), sign(event.rawBody))
  }

  extractWebhookPayload(event: any): { userId: string; sessionId: string; status: string } {
    const { vendor_data: userId, session_id: sessionId, status } = event.body
    return { userId, sessionId, status }
  }

  async verifyIdDocument(frontImageBase64: string, backImageBase64?: string): Promise<any> {
    const form = new FormData()
    form.append('front_image', new Blob([Buffer.from(frontImageBase64, 'base64')], { type: 'image/jpeg' }), 'front.jpg')
    if (backImageBase64) {
      form.append('back_image', new Blob([Buffer.from(backImageBase64, 'base64')], { type: 'image/jpeg' }), 'back.jpg')
    }
    form.append('perform_document_liveness', 'false')

    const result = await axios.post('https://verification.didit.me/v3/id-verification/', form, {
      headers: { 'x-api-key': this.apiKey }
    })

    return result.data
  }
}
