import { queryRecord, updateItem } from './db'

const TABLE = 'v1MerchantTable'

// Every send that has or may still move money counts toward the rolling threshold.
// REJECTED, CANCELLED and EXPIRED moved none and never will
export const COUNTED_STATUSES = ['PENDING', 'APPROVED', 'EXECUTING', 'COMPLETED', 'UNCERTAIN']
// Longer than the 24h the threshold looks back, so no request counted there has expired
export const REQUEST_TTL_MS = 2 * 24 * 60 * 60 * 1000
// A write refused because the request changed since it was read is decided again this many times
export const WRITE_ATTEMPTS = 3

/** One of a merchant's requests, read consistently: a vote is decided on what this finds. */
export const getRequest = async (merchantId: string, requestId: string) => {
  const result = await queryRecord(TABLE, 'id = :id AND sk = :sk', { ':id': merchantId, ':sk': `REQ#${requestId}` }, true)
  return { success: result.success, res: result.res?.[0] ?? null }
}

/**
 * The status to act on and to answer. Nothing sweeps the table, so a request past
 * expiresAt still says PENDING until a route meets it: this writes EXPIRED then,
 * and answers it whether or not that write went through.
 */
export const currentStatus = async (request: Record<string, any>, now: string): Promise<string> => {
  if (request.status !== 'PENDING' || request.expiresAt > now) return request.status

  await updateItem({
    tableName: TABLE,
    key: { id: request.id, sk: request.sk },
    updateExpression: 'SET #status = :expired, #updatedAt = :now',
    conditionExpression: '#status = :pending AND #expiresAt <= :now',
    attributeNames: { '#status': 'status', '#updatedAt': 'updatedAt', '#expiresAt': 'expiresAt' },
    attributeValues: { ':expired': 'EXPIRED', ':pending': 'PENDING', ':now': now },
  })
  return 'EXPIRED'
}

/**
 * Cancels every pending request a person made or may vote on, for when they leave
 * the team: a request they asked for, or one their approval counts in, must not go
 * on to move money. Answers the cancelled ids, or null when a read or a write
 * failed and the whole removal should be sent again.
 */
export const cancelRequestsOf = async (merchantId: string, userId: string) => {
  const now = Date.now()
  // Anything older has expired
  const recent = await queryRecord(TABLE, 'id = :id AND sk BETWEEN :from AND :to', {
    ':id': merchantId,
    ':from': `REQ#req_${now - REQUEST_TTL_MS}`,
    ':to': `REQ#req_${now}~`,
  }, true)
  if (!recent.success || !recent.res) return null

  const cancelled: string[] = []
  for (const request of recent.res) {
    if (request.status !== 'PENDING') continue
    if (request.initiatorId !== userId && !request.approvers?.includes(userId)) continue

    const written = await updateItem({
      tableName: TABLE,
      key: { id: request.id, sk: request.sk },
      updateExpression: 'SET #status = :cancelled, #cancelReason = :reason, #updatedAt = :now',
      conditionExpression: '#status = :pending',
      attributeNames: { '#status': 'status', '#cancelReason': 'cancelReason', '#updatedAt': 'updatedAt' },
      attributeValues: { ':cancelled': 'CANCELLED', ':reason': 'MEMBER_REMOVED', ':pending': 'PENDING', ':now': new Date(now).toISOString() },
    })
    if (written.success) cancelled.push(request.requestId)
    // Decided or cancelled in the meantime: nothing left to stop
    else if (written.error?.name !== 'ConditionalCheckFailedException') return null
  }
  return cancelled
}
