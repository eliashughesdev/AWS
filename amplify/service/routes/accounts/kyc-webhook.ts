import type { Context } from 'aws-lambda'
import { createHmac, timingSafeEqual } from 'crypto'
import { response } from '../../../utils/http'
import { updateItem } from '../../../utils/db'

export default class KycWebhookHandler {
  async execute(event: any, context: Context) {
    const signatureV2 = event.headers?.['x-signature-v2'] ?? event.headers?.['X-Signature-V2']
    const timestamp = event.headers?.['x-timestamp'] ?? event.headers?.['X-Timestamp']
    const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET

    if (!webhookSecret) {
      console.error('Missing DIDIT_WEBHOOK_SECRET')
      return response({ statusCode: 500, headers: null, bodyObject: { message: 'Webhook secret not configured' } })
    }

    // Validate timestamp freshness (must be within 300 seconds)
    if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return response({ statusCode: 401, headers: null, bodyObject: { message: 'Invalid or stale timestamp' } })
    }

    // Verify signature (V2: HMAC-SHA256 of JSON with sorted keys)
    const body = event.body
    const normalizedPayload = JSON.stringify(body, Object.keys(body).sort())
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(normalizedPayload)
      .digest('hex')

    if (
      !signatureV2 ||
      !timingSafeEqual(Buffer.from(signatureV2), Buffer.from(expectedSignature))
    ) {
      return response({ statusCode: 401, headers: null, bodyObject: { message: 'Invalid signature' } })
    }

    const { vendor_data: userId, status, session_id } = body

    if (!userId) {
      console.error('Didit webhook missing vendor_data (userId)')
      return response({ statusCode: 200, headers: null, bodyObject: { message: 'ok' } })
    }

    await updateItem({
      tableName: 'v2CustomerTable',
      key: { id: userId, sk: 'USERPROFILE' },
      updateExpression: 'SET kyc = :kycData',
      attributeNames: undefined,
      attributeValues: {
        ':kycData': {
          status,
          sessionId: session_id,
          updatedAt: Date.now(),
        }
      }
    })

    console.log(`KYC webhook processed: userId=${userId} status=${status} sessionId=${session_id}`)

    // Always return 200 immediately — Didit retries on non-200
    return response({ statusCode: 200, headers: null, bodyObject: { message: 'ok' } })
  }
}
