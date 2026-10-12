import { ref } from 'vue'
import { listPaymentMethods, savePaymentMethod } from '../api/payments'
import type { SavedCard } from '../api/types'

export function detectCardType(number: string): string {
  const n = number.replace(/\s/g, '')
  if (/^4/.test(n))          return 'visa'
  if (/^5[1-5]/.test(n))     return 'mastercard'
  if (/^3[47]/.test(n))      return 'amex'
  if (/^6(?:011|5)/.test(n)) return 'discover'
  return 'unknown'
}

// A user's saved payment cards.
export function useCards() {
  const cards   = ref<SavedCard[]>([])
  const loading = ref(true)

  // Throws when the request itself fails; the list on screen is left as it was.
  async function load() {
    loading.value = true
    try {
      const { data } = await listPaymentMethods()
      cards.value = data.res ?? []
    } finally {
      loading.value = false
    }
  }

  // Resolves false when the card is refused. The list is not re-read here.
  async function save(card: { number: string; cvc: string; month: string; year: string }) {
    const clean = card.number.replace(/\s/g, '')
    const { ok } = await savePaymentMethod({
      paymentMethod: {
        lastFour: clean.slice(-4),
        bin:      clean.slice(0, 8),
        cardType: detectCardType(clean),
        cardData: JSON.stringify({ number: clean, cvc: card.cvc, expiry: { month: card.month, year: card.year } }),
      },
    })
    return ok
  }

  return { cards, loading, load, save }
}
