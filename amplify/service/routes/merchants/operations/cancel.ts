import type { Context } from 'aws-lambda'

import { response } from '../../../../utils/http'
import { processError } from '../../../../errors/http'
import { updateItem } from '../../../../utils/db'
import { resolveMember } from '../../../../utils/merchant'
import { currentStatus, getRequest, WRITE_ATTEMPTS } from '../../../../utils/treasuryRequest'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: { requestId: string }
}

/**
 * The initiator withdraws their own request while it is pending. The write is
 * refused if a vote decided the request first, and the answer then says what it
 * became.
 */
export default class CancelRequestHandler {
  async execute(event: Event, context: Context) {
    const userId = event.requestContext?.authorizer?.userId ?? ''
    // The body was checked against schemas/merchants/operations/cancel.json
    const { requestId } = event.body

    const caller = await resolveMember(userId)
    if (caller.error) return caller.error
    const { merchantId } = caller

    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const found = await getRequest(merchantId, requestId)
      if (!found.success) return processError(100003)
      const request = found.res
      if (!request) return processError(100054)

      if (request.initiatorId !== userId) return processError(100060)

      const now = new Date().toISOString()
      const status = await currentStatus(request, now)
      if (status === 'EXPIRED') return processError(100056)
      if (status !== 'PENDING') return processError(100055, status)

      const written = await updateItem({
        tableName: 'v1MerchantTable',
        key: { id: merchantId, sk: `REQ#${requestId}` },
        updateExpression: 'SET #status = :cancelled, #updatedAt = :now',
        conditionExpression: '#status = :pending AND #initiatorId = :me AND #expiresAt > :now',
        attributeNames: { '#status': 'status', '#updatedAt': 'updatedAt', '#initiatorId': 'initiatorId', '#expiresAt': 'expiresAt' },
        attributeValues: { ':cancelled': 'CANCELLED', ':now': now, ':pending': 'PENDING', ':me': userId },
      })

      if (written.success) {
        console.log(`TREASURY_CANCEL: ${userId} cancelled ${requestId} of ${merchantId}`)
        return response({ statusCode: 200, headers: null, bodyObject: { success: true, requestId, status: 'CANCELLED' } })
      }
      if (written.error?.name !== 'ConditionalCheckFailedException') return processError(100003)
      // A vote or the expiry got in between: answer for what is there now
    }

    console.error(`TREASURY_CANCEL: ${requestId} of ${merchantId} kept changing, gave up after ${WRITE_ATTEMPTS} attempts`)
    return processError(100003)
  }
}
