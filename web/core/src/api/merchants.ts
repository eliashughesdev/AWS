import { request } from './client'
import type { Merchant } from './types'

// Staff only, and on the internal API only: the public one has none of these routes.

export function listMerchants() {
  return request<{ merchants?: Merchant[] }>('/merchants/list')
}

// The only response that ever carries the merchant's API key. Each currency and each
// network's seed answers `ready`, `failed` or `pending` (still running when the
// response had to leave); none of them fails the registration.
export function registerMerchant(body: {
  name: string
  currencies?: string[]
  accountingCurrency?: string
}) {
  return request<{
    success?: boolean
    merchantId?: string
    apiKey?: string
    currencies?: Record<string, { status: string; depositAddress?: string }>
    seeds?: Record<string, string>
  }>('/merchants/register', { method: 'POST', body })
}

// Adds a currency to a merchant, or finishes one left `provisioning`.
export function provisionMaster(body: { merchantId: string; currency: string }) {
  return request<{ success?: boolean; status?: string; depositAddress?: string }>(
    '/merchants/masters/provision',
    { method: 'POST', body },
  )
}
