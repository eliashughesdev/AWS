import { request } from './client'
import type { Account, Transaction } from './types'

export function listAccounts() {
  return request<{ accounts?: Account[] }>('/accounts/list')
}

export function listTransactions(accountNumber: string) {
  return request<{ transactions?: Transaction[] }>('/accounts/transactions', {
    method: 'POST',
    body: { accountNumber },
  })
}

export function createAccount(body: {
  accountName: string
  email: string
  chain: string
  provider: string
  accountingCurrency: string
  userId?: string
}) {
  return request<{ success?: boolean }>('/accounts/account', { method: 'POST', body })
}

export function deposit(body: {
  accountNumber: string
  currency: string
  amount: number
  paymentId: string
  userId: string
  email: string
  transactionId: string
}) {
  return request<{ status?: string }>('/accounts/deposit', { method: 'POST', body })
}

export function withdraw(body: {
  accountNumber: string
  currency: string
  amount?: number
  cryptoAmount?: number
  userId: string
  destinationAddress: string
  transactionId: string
}) {
  return request<{ status?: string }>('/accounts/withdraw', { method: 'POST', body })
}

export function transfer(body: {
  provider: string
  senderAccountNumber: string
  recipientAccountNumber: string
  amount: string
}) {
  return request<{ success?: boolean }>('/accounts/transfer', { method: 'POST', body })
}
