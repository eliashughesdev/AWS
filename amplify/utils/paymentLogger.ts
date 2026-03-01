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
  return updateItem({
    tableName: PAYMENT_LOGS_TABLE,
    key: {
      id: params.paymentOrderId,
      sk: `ATTEMPT#${params.attemptNumber}#${params.provider}`,
    },
    updateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #providerRef = :providerRef, #errorMessage = :errorMessage, #providerMetadata = :providerMetadata',
    attributeNames: {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
      '#providerRef': 'providerRef',
      '#errorMessage': 'errorMessage',
      '#providerMetadata': 'providerMetadata',
    },
    attributeValues: {
      ':status': params.status,
      ':updatedAt': now,
      ':providerRef': params.providerRef || '',
      ':errorMessage': params.errorMessage || '',
      ':providerMetadata': params.providerMetadata || {},
    },
  })
}

export async function updateOrderStatus(params: UpdateOrderStatusParams) {
  const now = new Date().toISOString()
  return updateItem({
    tableName: PAYMENT_LOGS_TABLE,
    key: {
      id: params.paymentOrderId,
      sk: 'ORDER#META',
    },
    updateExpression: 'SET #finalStatus = :finalStatus, #finalProvider = :finalProvider, #providerRef = :providerRef, #totalAttempts = :totalAttempts, #updatedAt = :updatedAt',
    attributeNames: {
      '#finalStatus': 'finalStatus',
      '#finalProvider': 'finalProvider',
      '#providerRef': 'providerRef',
      '#totalAttempts': 'totalAttempts',
      '#updatedAt': 'updatedAt',
    },
    attributeValues: {
      ':finalStatus': params.finalStatus,
      ':finalProvider': params.finalProvider || '',
      ':providerRef': params.providerRef || '',
      ':totalAttempts': params.totalAttempts,
      ':updatedAt': now,
    },
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
