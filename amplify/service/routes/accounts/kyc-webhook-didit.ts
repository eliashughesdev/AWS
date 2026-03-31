import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { updateItem } from '../../../utils/db'
import { DiditKycProvider } from '../../../providers/kyc/DiditKycProvider'

export default class KycWebhookDiditHandler {
  async execute(event: any, context: Context) {
    let provider: DiditKycProvider
    try {
      provider = DiditKycProvider.create()
    } catch (e: any) {
      console.error(e.message)
      return response({ statusCode: 500, headers: null, bodyObject: { message: 'Webhook handler not configured' } })
    }

    if (!provider.verifyWebhookSignature(event)) {
      console.error('Didit webhook signature mismatch')
      return response({ statusCode: 401, headers: null, bodyObject: { message: 'Invalid signature' } })
    }

    const { userId, sessionId, status } = provider.extractWebhookPayload(event)

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
        ':kycData': { status, sessionId, provider: 'didit', updatedAt: Date.now() }
      }
    })

    console.log(`Didit webhook processed: userId=${userId} status=${status} sessionId=${sessionId}`)

    // Always return 200 — Didit retries on non-200
    return response({ statusCode: 200, headers: null, bodyObject: { message: 'ok' } })
  }
}
