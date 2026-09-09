<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { signOut, fetchUserAttributes, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import { API_BASE, RELAY_BASE } from '../config'

const router = useRouter()

const displayName = ref('...')
const userEmail   = ref('')
const userId      = ref('')

interface SavedCard {
  id: string
  lastFour: string
  bin: string | null
  cardType: string
  createdAt: number
  isRecurringReady: boolean
}

const cards       = ref<SavedCard[]>([])
const cardsLoading = ref(true)

const cardName   = ref('')
const cardNumber = ref('')
const expiry     = ref('')
const cvc        = ref('')
const saveError  = ref('')
const saving     = ref(false)

async function getAuthHeaders() {
  const session = await fetchAuthSession()
  const token = session.tokens?.accessToken?.toString()
  return { Authorization: `Bearer ${token}`, 'X-Project': 'web' }
}

async function loadCards() {
  cardsLoading.value = true
  try {
    const headers = await getAuthHeaders()
    const res  = await fetch(`${API_BASE}/payments/list?userId=${userId.value}`, { headers })
    const data = await res.json()
    cards.value = data.res ?? []
  } catch (e) {
    console.error('Failed to load cards', e)
  } finally {
    cardsLoading.value = false
  }
}

onMounted(async () => {
  try {
    const [attrs, user] = await Promise.all([fetchUserAttributes(), getCurrentUser()])
    userEmail.value   = attrs.email ?? ''
    displayName.value = attrs.email?.split('@')[0] ?? 'User'
    userId.value      = user.userId
  } catch {
    router.push('/auth')
    return
  }
  await loadCards()
})

async function handleSignOut() {
  await signOut()
  router.push('/auth')
}

// ── Card type detection ────────────────────────────────────────────────────────
function detectCardType(number: string): string {
  const n = number.replace(/\s/g, '')
  if (/^4/.test(n))          return 'visa'
  if (/^5[1-5]/.test(n))     return 'mastercard'
  if (/^3[47]/.test(n))      return 'amex'
  if (/^6(?:011|5)/.test(n)) return 'discover'
  return 'unknown'
}

const detectedType = computed(() => detectCardType(cardNumber.value))

const cardTypeConfig: Record<string, { label: string; color: string }> = {
  visa:       { label: 'Visa',       color: 'text-blue-400'   },
  mastercard: { label: 'Mastercard', color: 'text-red-400'    },
  amex:       { label: 'Amex',       color: 'text-green-400'  },
  discover:   { label: 'Discover',   color: 'text-amber-400'  },
  unknown:    { label: 'Card',       color: 'text-text-secondary'  },
}

// ── Input formatters ───────────────────────────────────────────────────────────
function onCardNumberInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 16)
  cardNumber.value = raw.match(/.{1,4}/g)?.join(' ') ?? raw
}

function onExpiryInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4)
  expiry.value = raw.length > 2 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw
}

// ── Save card ─────────────────────────────────────────────────────────────────
async function saveCard() {
  saveError.value = ''

  if (!cardName.value.trim() || !cardNumber.value.trim() || !expiry.value.trim() || !cvc.value.trim()) {
    saveError.value = 'All fields are required.'
    return
  }

  const [month, year] = expiry.value.split('/')
  if (!month || !year || month.length !== 2 || year.length !== 2) {
    saveError.value = 'Expiry must be MM/YY.'
    return
  }

  const clean    = cardNumber.value.replace(/\s/g, '')
  const lastFour = clean.slice(-4)
  const bin      = clean.slice(0, 8)
  const cardType = detectCardType(clean)

  saving.value = true
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${RELAY_BASE}/payments/save`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethod: {
          lastFour,
          bin,
          cardType,
          cardData: JSON.stringify({ number: clean, cvc: cvc.value, expiry: { month, year } }),
        },
        userId: userId.value,
      }),
    })

    if (!res.ok) {
      saveError.value = 'Failed to save card. Please try again.'
      return
    }

    cardName.value   = ''
    cardNumber.value = ''
    expiry.value     = ''
    cvc.value        = ''
    await loadCards()
  } catch (e) {
    console.error('Failed to save card', e)
    saveError.value = 'An unexpected error occurred.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">
    <section class="p-8 max-w-7xl mx-auto w-full">

      <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-8">Payment Methods</h1>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">

        <!-- ── Saved Cards ────────────────────────────────────────────────────── -->
        <div class="lg:col-span-2">

          <!-- Loading skeleton -->
          <div v-if="cardsLoading" class="space-y-3">
            <div v-for="n in 2" :key="n" class="h-20 bg-surface-1 border border-border-subtle rounded-lg animate-pulse" />
          </div>

          <!-- Empty state -->
          <div v-else-if="cards.length === 0"
            class="flex flex-col items-center justify-center py-20 bg-surface-1 border border-border-subtle rounded-xl text-center">
            <span class="material-symbols-outlined text-5xl text-text-muted mb-4">credit_card_off</span>
            <p class="text-text-secondary text-sm">No payment methods saved yet.</p>
            <p class="text-text-muted text-xs mt-1">Add a card using the form to get started.</p>
          </div>

          <!-- Card list -->
          <div v-else class="space-y-3">
            <div v-for="card in cards" :key="card.id"
              class="flex items-center gap-4 px-5 py-4 bg-surface-1 border border-border-subtle rounded-lg hover:border-white/20 transition-colors">
              <div class="w-10 h-10 rounded bg-surface-2 border border-border-subtle flex items-center justify-center shrink-0"
                :class="cardTypeConfig[card.cardType]?.color ?? 'text-text-secondary'">
                <span class="material-symbols-outlined">credit_card</span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-['JetBrains_Mono'] text-sm">
                  •••• •••• •••• {{ card.lastFour }}
                </p>
                <p class="text-[11px] text-text-muted uppercase mt-0.5">
                  {{ cardTypeConfig[card.cardType]?.label ?? 'Card' }}
                </p>
              </div>
              <span v-if="card.isRecurringReady"
                class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded border bg-brand/10 text-brand border-brand/20 font-['JetBrains_Mono'] uppercase">
                Ready
              </span>
            </div>
          </div>
        </div>

        <!-- ── Add New Card ───────────────────────────────────────────────────── -->
        <div class="bg-surface-1 border border-border-subtle rounded-xl p-6 h-fit">
          <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-6">Add New Card</h2>

          <form @submit.prevent="saveCard" class="flex flex-col gap-4">

            <!-- Cardholder Name -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Cardholder Name</label>
              <input
                v-model="cardName"
                type="text"
                placeholder="Jane Doe"
                autocomplete="cc-name"
                class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white placeholder-text-muted focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors"
              />
            </div>

            <!-- Card Number -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Card Number</label>
              <div class="relative">
                <input
                  :value="cardNumber"
                  @input="onCardNumberInput"
                  type="text"
                  inputmode="numeric"
                  placeholder="1234 5678 9012 3456"
                  autocomplete="cc-number"
                  maxlength="19"
                  class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 pr-10 text-sm text-white placeholder-text-muted font-['JetBrains_Mono'] focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors"
                />
                <span
                  class="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-lg transition-colors"
                  :class="cardTypeConfig[detectedType]?.color ?? 'text-text-muted'">
                  credit_card
                </span>
              </div>
            </div>

            <!-- Expiry + CVC -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Expiry</label>
                <input
                  :value="expiry"
                  @input="onExpiryInput"
                  type="text"
                  inputmode="numeric"
                  placeholder="MM/YY"
                  autocomplete="cc-exp"
                  maxlength="5"
                  class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white placeholder-text-muted font-['JetBrains_Mono'] focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors"
                />
              </div>
              <div>
                <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">CVC</label>
                <input
                  v-model="cvc"
                  type="text"
                  inputmode="numeric"
                  placeholder="123"
                  autocomplete="cc-csc"
                  maxlength="4"
                  class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white placeholder-text-muted font-['JetBrains_Mono'] focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors"
                />
              </div>
            </div>

            <!-- Error -->
            <p v-if="saveError" class="text-red-400 text-xs">{{ saveError }}</p>

            <!-- Submit -->
            <button
              type="submit"
              :disabled="saving"
              class="w-full mt-2 bg-brand text-on-brand font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-full hover:bg-brand-hover active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {{ saving ? 'Saving…' : 'Save Card' }}
            </button>

          </form>
        </div>

      </div>
    </section>
  </MainLayout>
</template>
