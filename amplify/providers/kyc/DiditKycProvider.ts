import axios from 'axios'
import { createHmac, timingSafeEqual } from 'crypto'

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
    const { session_id, url: verificationUrl } = diditResponse.data
    return { sessionId: session_id, verificationUrl }
  }

  verifyWebhookSignature(event: any): boolean {
    const signatureSimple = event.headers?.['x-signature-simple'] ?? event.headers?.['X-Signature-Simple']
    const xTimestamp = event.headers?.['x-timestamp'] ?? event.headers?.['X-Timestamp']
    const { session_id, status, webhook_type } = event.body

    const sigString = `${xTimestamp}:${session_id}:${status}:${webhook_type}`
    const expectedSig = createHmac('sha256', this.webhookSecret).update(sigString).digest('hex')

    return (
      !!signatureSimple &&
      timingSafeEqual(Buffer.from(signatureSimple), Buffer.from(expectedSig))
    )
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
