import { ref } from 'vue'
import { getUsdPrices } from '../api/prices'

// USD price of one unit of each chain's coin, for a page that shows several coins.
// A chain is missing until its price has been read, and null when it has none.
export function usePrices() {
  const prices  = ref<Record<string, number | null>>({})
  const loading = ref(false)
  let lastCall = 0

  async function load(chains: string[]) {
    const call = ++lastCall
    loading.value = true
    const read = await getUsdPrices(chains)
    // A later call owns the result.
    if (call !== lastCall) return
    prices.value  = read
    loading.value = false
  }

  return { prices, loading, load }
}
