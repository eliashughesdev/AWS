import { ref } from 'vue'
import { getUsdPrice } from '../api/prices'

// USD price of one unit of a chain's coin.
export function useExchangeRate() {
  const rate    = ref<number | null>(null)
  const loading = ref(false)
  let lastCall = 0

  async function load(chain: string) {
    const call = ++lastCall
    loading.value = true
    rate.value    = null
    const price = await getUsdPrice(chain).catch(() => null)
    // A later call (another account was picked meanwhile) owns the result.
    if (call !== lastCall) return
    rate.value    = price
    loading.value = false
  }

  return { rate, loading, load }
}
