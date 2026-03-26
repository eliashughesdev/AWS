import type { Context } from 'aws-lambda'
import { createHmac, timingSafeEqual } from 'crypto'
import { response } from '../../../utils/http'
import { updateItem } from '../../../utils/db'

export default class KycWebhookHandler {
  async execute(event: any, context: Context) {
    console.log('Didit webhook received - headers:', JSON.stringify(event.headers))
    console.log('Didit webhook received - body:', JSON.stringify(event.body))

    const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET

    if (!webhookSecret) {
      console.error('Missing DIDIT_WEBHOOK_SECRET')
      return response({ statusCode: 500, headers: null, bodyObject: { message: 'Webhook secret not configured' } })
    }

    const body = event.body

    // X-Signature-Simple: HMAC-SHA256 of "${timestamp}:${session_id}:${status}:${webhook_type}"
    const signatureSimple = event.headers?.['x-signature-simple'] ?? event.headers?.['X-Signature-Simple']
    const xTimestamp = event.headers?.['x-timestamp'] ?? event.headers?.['X-Timestamp']
    const { vendor_data: userId, session_id, status, webhook_type } = body
    const sigString = `${xTimestamp}:${session_id}:${status}:${webhook_type}`
    const expectedSig = createHmac('sha256', webhookSecret).update(sigString).digest('hex')

    const signatureValid =
      signatureSimple &&
      timingSafeEqual(Buffer.from(signatureSimple), Buffer.from(expectedSig))

    if (!signatureValid) {
      console.error('KYC webhook signature mismatch')
      return response({ statusCode: 401, headers: null, bodyObject: { message: 'Invalid signature' } })
    }

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
