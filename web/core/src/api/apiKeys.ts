import { request } from './client'
import type { ApiKey, ApiKeyPermission, NewApiKey } from './types'

// On the internal API, from a signed-in session only (100057 for anything else): a key can
// never manage keys.

// The permissions a user's key may hold.
export function listPermissions() {
  return request<{ permissions?: ApiKeyPermission[] }>('/accounts/api-keys/permissions')
}

// The signed-in user's keys, newest first, revoked ones included.
export function listApiKeys() {
  return request<{ keys?: ApiKey[] }>('/accounts/api-keys/list')
}

// The only response that ever carries the key's secret: the backend keeps a hash of it, so nobody
// can show it again. At most 10 usable keys (100054); an unknown permission is 100058, an entry
// that is not one IP address 100062. A 500 may still have made the key.
export function createApiKey(body: NewApiKey) {
  return request<{ key?: ApiKey; secret?: string }>('/accounts/api-keys/create', { method: 'POST', body })
}

// Only the fields sent change; an empty ipAllowlist allows any IP again. 100060 when the key is
// not the caller's or no longer active.
export function updateApiKey(body: { keyId: string; name?: string; permissions?: string[]; ipAllowlist?: string[] }) {
  return request<{ key?: ApiKey }>('/accounts/api-keys/update', { method: 'POST', body })
}

// Stops the key at once. Revoking a revoked key answers success too.
export function revokeApiKey(keyId: string) {
  return request<{ keyId?: string; status?: string }>('/accounts/api-keys/revoke', { method: 'POST', body: { keyId } })
}

// Staff only from here on.

export interface ApiKeyFilters {
  ownerId?: string
  merchantId?: string
  ownerType?: 'user' | 'merchant'
  status?: 'active' | 'revoked'
}

// Every key, users' and merchants', newest first, narrowed by the filters given.
export function listAllApiKeys(filters: ApiKeyFilters = {}) {
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => !!entry[1]),
  ).toString()
  return request<{ keys?: ApiKey[] }>(`/merchants/api-keys/list${query ? `?${query}` : ''}`)
}

// A key for an active merchant (100040 otherwise), with merchant permissions only. Like
// createApiKey, the only response with the secret, and a 500 may still have made the key.
export function createMerchantApiKey(body: NewApiKey & { merchantId: string }) {
  return request<{ key?: ApiKey; secret?: string }>('/merchants/api-keys/create', { method: 'POST', body })
}

// One key's limit, or every usable key of one owner (userId: a user's or a merchant's id).
// perSecond 1–1000. keyIds are the keys changed.
export function setRateLimit(body: ({ keyId: string; userId?: never } | { userId: string; keyId?: never }) & { perSecond: number }) {
  return request<{ keyIds?: string[]; rateLimit?: { perSecond: number } }>(
    '/merchants/api-keys/rate-limit',
    { method: 'POST', body },
  )
}

// Any key; the owner is emailed the reason.
export function staffRevokeApiKey(keyId: string, reason: string) {
  return request<{ keyId?: string; status?: string }>('/merchants/api-keys/revoke', { method: 'POST', body: { keyId, reason } })
}
