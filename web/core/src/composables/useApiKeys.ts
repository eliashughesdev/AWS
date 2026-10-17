import { ref } from 'vue'
import { createApiKey, listApiKeys, listPermissions, revokeApiKey, updateApiKey } from '../api/apiKeys'
import type { ApiKey, ApiKeyPermission, NewApiKey } from '../api/types'

// The signed-in user's API keys, and the permissions one may hold.
export function useApiKeys() {
  const keys        = ref<ApiKey[]>([])
  const permissions = ref<ApiKeyPermission[]>([])
  const loading     = ref(true)
  // The server refused a first read, so an empty list is not the user's.
  const failed      = ref(false)

  // First read of both. Throws when a request itself fails; what to show then is the view's call.
  async function load() {
    try {
      const [list, catalogue] = await Promise.all([listApiKeys(), listPermissions()])
      failed.value      = !list.ok || !catalogue.ok
      keys.value        = list.data.keys ?? []
      permissions.value = catalogue.data.permissions ?? []
    } finally {
      loading.value = false
    }
  }

  // Later reads keep the list on screen when the response carries none.
  async function refresh() {
    const { data } = await listApiKeys()
    keys.value = data.keys ?? keys.value
  }

  // Sends the request only — the view decides what counts as success and re-reads the list.
  // The secret is in this result alone: it goes to the caller and is kept nowhere here.
  // A throw, or a 5xx, does not mean no key was made: the response may have been lost.
  function create(key: NewApiKey) {
    return createApiKey(key)
  }

  // Sends the request only, like create.
  function update(keyId: string, changes: { name?: string; permissions?: string[]; ipAllowlist?: string[] }) {
    return updateApiKey({ keyId, ...changes })
  }

  // Sends the request only, like create. Safe to send again.
  function revoke(keyId: string) {
    return revokeApiKey(keyId)
  }

  return { keys, permissions, loading, failed, load, refresh, create, update, revoke }
}
