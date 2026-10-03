import { RELAY_BASE } from '../config'
import { request } from './client'
import type { SavedCard } from './types'

export function listPaymentMethods(userId: string) {
  return request<{ res?: SavedCard[] }>(`/payments/list?userId=${userId}`)
}

// Sent to the Evervault relay (RELAY_BASE), not straight to the API.
export function savePaymentMethod(body: {
  paymentMethod: { lastFour: string; bin: string; cardType: string; cardData: string }
  userId: string
}) {
  return request('/payments/save', { method: 'POST', body, base: RELAY_BASE })
}
