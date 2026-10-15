import { updateItem } from './db'

/**
 * A record of each withdrawal and card deposit, kept on its user from the moment it is accepted
 * (docs/public-api-plan.md D6.4, step 1.5): `id` = user id, `sk` = `OP#<opId>`, where opId is the
 * transactionId the route answers (`wdr_…`, `dep_…`, or the one the caller sent).
 *
 * The browser learns an outcome over the WebSocket; an API caller has none, so it reads this
 * record instead. The route writes it as `pending` before anything is queued (a withdrawal in the
 * same transaction as its debit), and the queue processor moves it on when it knows the outcome.
 *
 * status
 * - pending: queued, or sent with no answer yet. `stage` says which when it is not plain queued:
 *   `uncertain` (the coins may have left; never refunded on its own), `credit-failed` (a card was
 *   charged but the account not credited; staff resolve it)
 * - requires_action: a card payment waits for 3-D Secure at `authenticationUrl`
 * - completed: done, with the chain's `txId` (a withdrawal) or the payment's (a deposit)
 * - failed: provably not done, with our `code` when there is one. A failed withdrawal was refunded
 */

export type OperationKind = 'withdrawal' | 'cardDeposit'
export type OperationStatus = 'pending' | 'requires_action' | 'completed' | 'failed'

export const OPERATION_PREFIX = 'OP#'
export const operationKey = (userId: string, opId: string) => ({ id: userId, sk: `${OPERATION_PREFIX}${opId}` })

// The record a route writes before it queues anything. Written with attribute_not_exists, so a
// transactionId sent twice cannot overwrite the first
export const newOperation = (op: {
  userId: string
  opId: string
  kind: OperationKind
  accountNumber: string
  currency: string
  amount: number
  fiatAmount?: number
  fiatCurrency?: string
  destinationAddress?: string
  paymentId?: string
}) => {
  const now = new Date().toISOString()
  const { userId, opId, ...fields } = op
  return { ...operationKey(userId, opId), opId, ...fields, status: 'pending' as OperationStatus, createdAt: now, updatedAt: now }
}

/**
 * Moves a record to what the processor learnt. It only moves forward: a record already completed
 * or failed is left as it is, and so is a missing one (a message queued before records existed).
 * Never throws: the operation itself has happened, and its record must not undo or repeat it.
 */
export async function settleOperation(userId: string, opId: string, outcome: {
  status: OperationStatus
  stage?: 'uncertain' | 'credit-failed'
  txId?: string
  code?: number
  authenticationUrl?: string
}) {
  const fields: Record<string, unknown> = { status: outcome.status, updatedAt: new Date().toISOString() }
  for (const name of ['stage', 'txId', 'code', 'authenticationUrl'] as const) {
    if (outcome[name] !== undefined) fields[name] = outcome[name]
  }
  const names = Object.keys(fields)
  try {
    const result = await updateItem({
      tableName: 'v2CustomerTable',
      key: operationKey(userId, opId),
      updateExpression: `SET ${names.map((_, i) => `#f${i} = :f${i}`).join(', ')}`,
      conditionExpression: 'attribute_exists(id) AND (#status = :pending OR #status = :action)',
      attributeNames: { ...Object.fromEntries(names.map((name, i) => [`#f${i}`, name])), '#status': 'status' },
      attributeValues: { ...Object.fromEntries(names.map((name, i) => [`:f${i}`, fields[name]])), ':pending': 'pending', ':action': 'requires_action' },
    })
    if (!result.success && result.error?.name !== 'ConditionalCheckFailedException') {
      console.error(`ERROR: Operation ${opId} could not be set to ${outcome.status}`)
    }
  } catch (err: any) {
    console.error(`ERROR: Operation ${opId} could not be set to ${outcome.status}:`, err?.message)
  }
}
