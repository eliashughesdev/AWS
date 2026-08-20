import { randomUUID } from 'crypto'
import { putItem, updateItem, queryItemFromIndex } from './db'

const PAYMENT_LOGS_TABLE = 'v1PaymentTransactionLogsTable'

export type PaymentLogStatus = 'processing' | 'succeeded' | 'failed' | 'declined' | 'requires_action' | 'error'

export interface CreateOrderLogParams {
  paymentOrderId: string
  userId: string
  clientTransactionId: string
  paymentId: string
  primaryProvider: string
  amount: number
  currency: string
}

export interface LogAttemptParams {
  paymentOrderId: string
  userId: string
  attemptNumber: number
  provider: string
  status: PaymentLogStatus
  providerRef?: string
  amount: number
  currency: string
  errorMessage?: string
  retryable?: boolean
  providerMetadata?: Record<string, any>
}

export interface UpdateAttemptParams {
  paymentOrderId: string
  attemptNumber: number
  provider: string
  status: PaymentLogStatus
  providerRef?: string
  errorMessage?: string
  providerMetadata?: Record<string, any>
}

export interface UpdateOrderStatusParams {
  paymentOrderId: string
  finalStatus: PaymentLogStatus
  finalProvider?: string
  providerRef?: string
  totalAttempts: number
}

export function generatePaymentOrderId(): string {
  return randomUUID()
}

export async function createOrderLog(params: CreateOrderLogParams) {
  const now = new Date().toISOString()
  return putItem(PAYMENT_LOGS_TABLE, {
    id: params.paymentOrderId,
    sk: 'ORDER#META',
    userId: params.userId,
    providerRef: '',
    clientTransactionId: params.clientTransactionId,
    paymentId: params.paymentId,
    primaryProvider: params.primaryProvider,
    finalProvider: '',
    finalStatus: 'processing' as PaymentLogStatus,
    totalAttempts: 0,
    amount: params.amount,
    currency: params.currency,
    createdAt: now,
    updatedAt: now,
  })
}

export async function logAttempt(params: LogAttemptParams) {
  const now = new Date().toISOString()
  return putItem(PAYMENT_LOGS_TABLE, {
    id: params.paymentOrderId,
    sk: `ATTEMPT#${params.attemptNumber}#${params.provider}`,
    userId: params.userId,
    providerRef: params.providerRef || '',
    provider: params.provider,
    attemptNumber: params.attemptNumber,
    status: params.status,
    amount: params.amount,
    currency: params.currency,
    errorMessage: params.errorMessage || '',
    retryable: params.retryable ?? false,
    providerMetadata: params.providerMetadata || {},
    createdAt: now,
    updatedAt: now,
  })
}

export async function updateAttemptStatus(params: UpdateAttemptParams) {
  const now = new Date().toISOString()

  // providerRef is the partition key of ProviderRefIndex (a GSI) — DynamoDB's
  // UpdateItem rejects SET-ing a GSI key attribute to an empty string, so only
  // include it when there's a real value.
  const sets = ['#status = :status', '#updatedAt = :updatedAt', '#errorMessage = :errorMessage', '#providerMetadata = :providerMetadata']
  const attributeNames: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
    '#errorMessage': 'errorMessage',
    '#providerMetadata': 'providerMetadata',
  }
  const attributeValues: Record<string, any> = {
    ':status': params.status,
    ':updatedAt': now,
    ':errorMessage': params.errorMessage || '',
    ':providerMetadata': params.providerMetadata || {},
  }

  if (params.providerRef) {
    sets.push('#providerRef = :providerRef')
    attributeNames['#providerRef'] = 'providerRef'
    attributeValues[':providerRef'] = params.providerRef
  }

  return updateItem({
    tableName: PAYMENT_LOGS_TABLE,
    key: {
      id: params.paymentOrderId,
      sk: `ATTEMPT#${params.attemptNumber}#${params.provider}`,
    },
    updateExpression: `SET ${sets.join(', ')}`,
    attributeNames,
    attributeValues,
  })
}

export async function updateOrderStatus(params: UpdateOrderStatusParams) {
  const now = new Date().toISOString()

  // Same GSI-key-empty-string constraint as updateAttemptStatus above.
  const sets = ['#finalStatus = :finalStatus', '#finalProvider = :finalProvider', '#totalAttempts = :totalAttempts', '#updatedAt = :updatedAt']
  const attributeNames: Record<string, string> = {
    '#finalStatus': 'finalStatus',
    '#finalProvider': 'finalProvider',
    '#totalAttempts': 'totalAttempts',
    '#updatedAt': 'updatedAt',
  }
  const attributeValues: Record<string, any> = {
    ':finalStatus': params.finalStatus,
    ':finalProvider': params.finalProvider || '',
    ':totalAttempts': params.totalAttempts,
    ':updatedAt': now,
  }

  if (params.providerRef) {
    sets.push('#providerRef = :providerRef')
    attributeNames['#providerRef'] = 'providerRef'
    attributeValues[':providerRef'] = params.providerRef
  }

  return updateItem({
    tableName: PAYMENT_LOGS_TABLE,
    key: {
      id: params.paymentOrderId,
      sk: 'ORDER#META',
    },
    updateExpression: `SET ${sets.join(', ')}`,
    attributeNames,
    attributeValues,
  })
}

export async function findAttemptByProviderRef(providerRef: string) {
  return queryItemFromIndex({
    tableName: PAYMENT_LOGS_TABLE,
    indexName: 'ProviderRefIndex',
    keyConditionExpression: 'providerRef = :providerRef',
    attributeNames: undefined,
    attributeValues: {
      ':providerRef': providerRef,
    },
  })
}
