import type { Context } from 'aws-lambda'

import { response } from '../../../../utils/http'
import { processError } from '../../../../errors/http'
import { queryRecord } from '../../../../utils/db'
import { resolveMember } from '../../../../utils/merchant'
import { currentStatus } from '../../../../utils/treasuryRequest'

type Event = { requestContext?: { authorizer?: { userId?: string } } }

// No paging yet: older requests than these are not answered
const NEWEST = 100

/**
 * The requests of the caller's merchant, newest first, for any active member:
 * an approver sees what waits for a vote, an initiator what became of theirs.
 */
export default class ListRequestsHandler {
  async execute(event: Event, context: Context) {
    const userId = event.requestContext?.authorizer?.userId ?? ''

    const caller = await resolveMember(userId)
    if (caller.error) return caller.error
    const { merchantId } = caller

    // REQ# ids start with their creation time, so the sort key's order is theirs
    const rows = await queryRecord('v1MerchantTable', 'id = :id AND begins_with(sk, :p)', { ':id': merchantId, ':p': 'REQ#' }, false, { descending: true, limit: NEWEST })
    if (!rows.success || !rows.res) return processError(100002, undefined, 500)

    const now = new Date().toISOString()
    const statuses = await Promise.all(rows.res.map(row => currentStatus(row, now)))

    // Field by field: whatever later steps add to the row stays out until it is named here
    const requests = rows.res.map((row, i) => ({
      requestId: row.requestId,
      type: row.type,
      currency: row.currency,
      amount: row.amount,
      destinationAddress: row.destinationAddress,
      status: statuses[i],
      cancelReason: row.cancelReason ?? null,
      initiatorId: row.initiatorId,
      approvers: row.approvers,
      requiredCount: row.requiredCount,
      approvalCount: row.approvalCount,
      votes: Object.entries<Record<string, any>>(row.votes ?? {}).map(([voterId, vote]) => ({ userId: voterId, decision: vote.decision, at: vote.at })),
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }))

    return response({ statusCode: 200, headers: null, bodyObject: { success: true, requests } })
  }
}
