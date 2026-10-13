import type { Context } from 'aws-lambda'

import { response } from '../../../../utils/http'
import { processError } from '../../../../errors/http'
import { updateItem } from '../../../../utils/db'
import { resolveMember } from '../../../../utils/merchant'
import { currentStatus, getRequest, WRITE_ATTEMPTS } from '../../../../utils/treasuryRequest'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: { requestId: string, decision: 'approve' | 'reject' }
}

/**
 * An approver's vote on one of their merchant's requests. Only someone in the
 * list fixed when the request was made may vote, once, and never its initiator.
 * One rejection ends it; the approval that reaches requiredCount makes it
 * APPROVED, which sends nothing yet.
 *
 * The write restates what was read (still pending, not expired, this vote not
 * cast, the count as read), so two votes at the same moment cannot both act on
 * the same count: the second is refused and decided again on a fresh read.
 */
export default class VoteOnRequestHandler {
  async execute(event: Event, context: Context) {
    const userId = event.requestContext?.authorizer?.userId ?? ''
    // The body was checked against schemas/merchants/operations/vote.json
    const { requestId, decision } = event.body

    const caller = await resolveMember(userId)
    if (caller.error) return caller.error
    const { merchantId } = caller

    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const found = await getRequest(merchantId, requestId)
      if (!found.success) return processError(100003)
      const request = found.res
      if (!request) return processError(100054)

      if (request.initiatorId === userId) return processError(100058)
      if (!request.approvers?.includes(userId)) return processError(100057)
      if (request.votes?.[userId]) return processError(100059)

      const now = new Date().toISOString()
      const status = await currentStatus(request, now)
      if (status === 'EXPIRED') return processError(100056)
      if (status !== 'PENDING') return processError(100055, status)

      const approvalCount: number = request.approvalCount + (decision === 'approve' ? 1 : 0)
      const newStatus = decision === 'reject' ? 'REJECTED' : approvalCount >= request.requiredCount ? 'APPROVED' : 'PENDING'

      const written = await updateItem({
        tableName: 'v1MerchantTable',
        key: { id: merchantId, sk: `REQ#${requestId}` },
        updateExpression: 'SET #votes.#me = :vote, #approvalCount = :count, #status = :status, #updatedAt = :now',
        conditionExpression: '#status = :pending AND contains(#approvers, :me) AND attribute_not_exists(#votes.#me) AND #approvalCount = :seen AND #expiresAt > :now',
        attributeNames: {
          '#votes': 'votes',
          '#me': userId,
          '#approvalCount': 'approvalCount',
          '#status': 'status',
          '#updatedAt': 'updatedAt',
          '#approvers': 'approvers',
          '#expiresAt': 'expiresAt',
        },
        attributeValues: {
          ':vote': { decision, at: now },
          ':count': approvalCount,
          ':status': newStatus,
          ':now': now,
          ':pending': 'PENDING',
          ':me': userId,
          ':seen': request.approvalCount,
        },
      })

      if (written.success) {
        console.log(`TREASURY_VOTE: ${userId} voted ${decision} on ${requestId} of ${merchantId}: ${approvalCount}/${request.requiredCount}, now ${newStatus}`)
        return response({
          statusCode: 200,
          headers: null,
          bodyObject: { success: true, requestId, status: newStatus, approvalCount, requiredCount: request.requiredCount },
        })
      }
      if (written.error?.name !== 'ConditionalCheckFailedException') return processError(100003)
      // Another vote, a cancel or the expiry got in between: decide again on what is there now
    }

    console.error(`TREASURY_VOTE: ${requestId} of ${merchantId} kept changing, gave up after ${WRITE_ATTEMPTS} attempts`)
    return processError(100003)
  }
}
