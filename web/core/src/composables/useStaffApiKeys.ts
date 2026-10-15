import { ref } from 'vue'
import { createMerchantApiKey, listAllApiKeys, setRateLimit as sendRateLimit, staffRevokeApiKey } from '../api/apiKeys'
import type { ApiKeyFilters } from '../api/apiKeys'
import type { ApiKey, NewApiKey } from '../api/types'

// Every API key, users' and merchants', for staff.
export function useStaffApiKeys() {
  const keys    = ref<ApiKey[]>([])
  const loading = ref(true)
  // The server refused the first read, so the empty list is not the real one.
  const failed  = ref(false)
  // What load() and refresh() ask for; load() sets it, refresh() keeps it.
  let filters: ApiKeyFilters = {}

  // First read, and a read with other filters. Throws when the request itself fails.
  async function load(next: ApiKeyFilters = filters) {
    filters = next
    loading.value = true
    try {
      const { ok, data } = await listAllApiKeys(filters)
      failed.value = !ok
      keys.value   = data.keys ?? []
    } finally {
      loading.value = false
    }
  }

  // Later reads keep the list on screen when the response carries none.
  async function refresh() {
    const { data } = await listAllApiKeys(filters)
    keys.value = data.keys ?? keys.value
  }

  // Sends the request only, as useApiKeys().create() and useMerchants().register() do: the secret
  // is in this result alone and kept nowhere here, and a throw or a 5xx does not mean no key was
  // made.
  function createForMerchant(merchantId: string, key: NewApiKey) {
    return createMerchantApiKey({ merchantId, ...key })
  }

  // Sends the request only. One key's limit, or every usable key of one owner.
  function setRateLimit(target: { keyId: string; userId?: never } | { userId: string; keyId?: never }, perSecond: number) {
    return sendRateLimit({ ...target, perSecond })
  }

  // Sends the request only. The owner is emailed the reason.
  function revoke(keyId: string, reason: string) {
    return staffRevokeApiKey(keyId, reason)
  }

  return { keys, loading, failed, load, refresh, createForMerchant, setRateLimit, revoke }
}
