import { RELAY_BASE } from '../config'
import { request } from './client'
import type { SavedCard } from './types'

// The card routes act for the signed-in user; they need no userId and refuse another user's
export function listPaymentMethods() {
  return request<{ res?: SavedCard[] }>('/payments/list')
}

// Sent to the Evervault relay (RELAY_BASE), not straight to the API.
export function savePaymentMethod(body: {
  paymentMethod: { lastFour: string; bin: string; cardType: string; cardData: string }
}) {
  return request('/payments/save', { method: 'POST', body, base: RELAY_BASE })
}
