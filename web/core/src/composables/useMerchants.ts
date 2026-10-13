import { ref } from 'vue'
import { listMerchants, provisionMaster, registerMerchant } from '../api/merchants'
import type { Merchant } from '../api/types'

// Every merchant with its currencies, for staff.
export function useMerchants() {
  const merchants = ref<Merchant[]>([])
  const loading   = ref(true)
  // The server refused the first read, so the empty list is not the real one.
  const failed    = ref(false)

  // First read. Throws when the request itself fails; what to show then is the view's call.
  async function load() {
    try {
      const { ok, data } = await listMerchants()
      failed.value    = !ok
      merchants.value = data.merchants ?? []
    } finally {
      loading.value = false
    }
  }

  // Later reads keep the list on screen when the response carries none.
  async function refresh() {
    const { data } = await listMerchants()
    merchants.value = data.merchants ?? merchants.value
  }

  // Sends the request only — the view decides what counts as success and re-reads the list.
  // The API key is in this result alone: it goes to the caller and is kept nowhere here.
  // A throw does not mean no merchant was made: the response may have been lost on its way.
  function register(merchant: { name: string; currencies?: string[]; accountingCurrency?: string }) {
    return registerMerchant(merchant)
  }

  // Sends the request only, like register.
  function addCurrency(merchantId: string, currency: string) {
    return provisionMaster({ merchantId, currency })
  }

  return { merchants, loading, failed, load, refresh, register, addCurrency }
}
