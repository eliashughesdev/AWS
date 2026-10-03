<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { signOut, fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import { WS_BASE } from '@loudibly/core/config'
import { listAccounts, deposit } from '@loudibly/core/api/accounts'
import { listPaymentMethods } from '@loudibly/core/api/payments'

const router = useRouter()

const displayName = ref('...')
const userEmail   = ref('')
const userId      = ref('')

interface Account {
  accountNo: string
  chain: string
  currency: string
  depositAddress: string
  status: string
}

interface SavedCard {
  id: string
  lastFour: string
  cardType: string
  isRecurringReady: boolean
}

const accounts = ref<Account[]>([])
const cards    = ref<SavedCard[]>([])
const loading  = ref(true)

const selectedAccount = ref('')
const selectedCard    = ref('')
const amount          = ref('')
const formError       = ref('')
const submitting      = ref(false)

type DepositStatus = 'idle' | 'processing' | 'success' | 'failed'
const depositStatus = ref<DepositStatus>('idle')
const depositError  = ref('')

let ws: WebSocket | null = null
let wsTimeout: ReturnType<typeof setTimeout> | null = null

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

  try {
    const [accRes, cardsRes] = await Promise.all([
      listAccounts(),
      listPaymentMethods(userId.value),
    ])
    accounts.value = accRes.data.accounts ?? []
    cards.value    = cardsRes.data.res ?? []

    if (accounts.value.length > 0) selectedAccount.value = accounts.value[0].accountNo
    if (cards.value.length > 0)    selectedCard.value    = cards.value[0].id
  } catch (e) {
    console.error('Failed to load deposit data', e)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  closeWs()
})

function closeWs() {
  if (wsTimeout) { clearTimeout(wsTimeout); wsTimeout = null }
  if (ws) { ws.close(); ws = null }
}

function handlePaymentResult(data: any) {
  closeWs()
  if (data.success && data.status === 'succeeded') {
    depositStatus.value = 'success'
  } else if (data.status === 'requires_action' && data.authenticationUrl) {
    window.open(data.authenticationUrl, '_blank')
    // Leave overlay in 'processing' state — a second PAYMENT_RESULT will arrive after 3DS
  } else {
    depositStatus.value = 'failed'
    depositError.value  = data.error ?? 'Payment declined. Please try again.'
  }
}

async function submit() {
  formError.value = ''

  if (!selectedAccount.value) { formError.value = 'Please select an account.'; return }
  if (!selectedCard.value)    { formError.value = 'Please select a payment method.'; return }
  const parsed = parseFloat(amount.value)
  if (!amount.value || isNaN(parsed) || parsed <= 0) {
    formError.value = 'Enter a valid amount greater than 0.'
    return
  }

  const transactionId = crypto.randomUUID()

  // Open WebSocket before the HTTP call so we don't miss a fast response
  ws = new WebSocket(`${WS_BASE}?userId=${userId.value}&paymentId=${transactionId}`)
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'PAYMENT_RESULT') handlePaymentResult(msg.data)
    } catch { /* ignore parse errors */ }
  }
  ws.onerror = () => {
    // WS error doesn't stop the deposit — result may still arrive
    console.warn('WebSocket error; will rely on timeout fallback')
  }

  console.log('[Deposit] userEmail:', userEmail.value, '| userId:', userId.value)

  depositStatus.value = 'processing'
  submitting.value    = true

  // 60-second timeout — if no WS message arrives, surface a neutral message
  wsTimeout = setTimeout(() => {
    if (depositStatus.value === 'processing') {
      closeWs()
      depositStatus.value = 'failed'
      depositError.value  = 'No confirmation received. Your deposit may still be processing — check your balance later.'
    }
  }, 60_000)

  try {
    const { ok, data } = await deposit({
      accountNumber: selectedAccount.value,
      currency:      'USD',
      amount:        parsed,
      paymentId:     selectedCard.value,
      userId:        userId.value,
      email:         'test@email.com',
      transactionId,
    })

    if (!ok) {
      closeWs()
      depositStatus.value = 'failed'
      depositError.value  = data.message ?? 'Deposit request failed. Please try again.'
    }
    // On success (status 'queued') we keep the overlay open and await the WS message
  } catch {
    closeWs()
    depositStatus.value = 'failed'
    depositError.value  = 'An unexpected error occurred.'
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  depositStatus.value = 'idle'
  depositError.value  = ''
  formError.value     = ''
  amount.value        = ''
}

async function handleSignOut() {
  closeWs()
  await signOut()
  router.push('/auth')
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 16) return addr
  return `${addr.slice(0, 8)}…${addr.slice(-8)}`
}

const cardTypeLabel: Record<string, string> = {
  visa:       'Visa',
  mastercard: 'Mastercard',
  amex:       'Amex',
  discover:   'Discover',
  unknown:    'Card',
}
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">
    <section class="p-8 max-w-7xl mx-auto w-full">

      <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-8">Deposit</h1>

      <!-- Loading skeleton -->
      <div v-if="loading" class="max-w-lg mx-auto space-y-4">
        <div class="h-20 bg-surface-1 border border-border-subtle rounded-xl animate-pulse" />
        <div class="h-20 bg-surface-1 border border-border-subtle rounded-xl animate-pulse" />
      </div>

      <template v-else>

        <!-- Empty-state: no accounts -->
        <div v-if="accounts.length === 0"
          class="max-w-lg mx-auto flex flex-col items-center justify-center py-20 bg-surface-1 border border-border-subtle rounded-xl text-center">
          <span class="material-symbols-outlined text-5xl text-text-muted mb-4">account_balance_wallet</span>
          <p class="text-text-secondary text-sm mb-1">No account found.</p>
          <p class="text-text-muted text-xs mb-6">Please create one from your dashboard.</p>
          <RouterLink :to="{ name: 'dashboard' }"
            class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-brand text-on-brand rounded-full hover:bg-brand-hover active:scale-95 transition-all">
            Go to Dashboard
          </RouterLink>
        </div>

        <!-- Empty-state: no cards -->
        <div v-else-if="cards.length === 0"
          class="max-w-lg mx-auto flex flex-col items-center justify-center py-20 bg-surface-1 border border-border-subtle rounded-xl text-center">
          <span class="material-symbols-outlined text-5xl text-text-muted mb-4">credit_card_off</span>
          <p class="text-text-secondary text-sm mb-1">No payment methods saved.</p>
          <p class="text-text-muted text-xs mb-6">Add a card before making a deposit.</p>
          <RouterLink :to="{ name: 'cards' }"
            class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-brand text-on-brand rounded-full hover:bg-brand-hover active:scale-95 transition-all">
            Add a Card →
          </RouterLink>
        </div>

        <!-- Deposit form -->
        <div v-else class="max-w-lg mx-auto relative">

          <!-- Processing overlay -->
          <Transition name="overlay">
            <div v-if="depositStatus !== 'idle'"
              class="absolute inset-0 z-10 bg-page/90 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center gap-4 p-8 text-center">

              <!-- Processing -->
              <template v-if="depositStatus === 'processing'">
                <span class="material-symbols-outlined text-6xl text-brand animate-spin" style="animation-duration: 1.5s">autorenew</span>
                <p class="font-['JetBrains_Mono'] text-sm text-text-secondary">Processing your deposit…</p>
                <p class="text-xs text-text-muted">This may take a moment. Please don't close this page.</p>
              </template>

              <!-- Success -->
              <template v-else-if="depositStatus === 'success'">
                <span class="material-symbols-outlined text-6xl text-brand" style="font-variation-settings: 'FILL' 1">check_circle</span>
                <p class="font-['JetBrains_Mono'] text-lg font-bold text-white">Deposit Successful!</p>
                <p class="text-xs text-text-muted">Your balance will be updated shortly.</p>
                <RouterLink :to="{ name: 'dashboard' }"
                  class="mt-2 font-['JetBrains_Mono'] text-xs font-bold px-6 py-3 bg-brand text-on-brand rounded-full hover:bg-brand-hover active:scale-95 transition-all">
                  Back to Dashboard
                </RouterLink>
              </template>

              <!-- Failed -->
              <template v-else-if="depositStatus === 'failed'">
                <span class="material-symbols-outlined text-6xl text-red-400" style="font-variation-settings: 'FILL' 1">cancel</span>
                <p class="font-['JetBrains_Mono'] text-lg font-bold text-white">Deposit Failed</p>
                <p class="text-sm text-red-400">{{ depositError }}</p>
                <button @click="resetForm"
                  class="mt-2 font-['JetBrains_Mono'] text-xs font-bold px-6 py-3 bg-surface-1 border border-border-subtle text-white rounded-full hover:bg-surface-2 active:scale-95 transition-all">
                  Try Again
                </button>
              </template>

            </div>
          </Transition>

          <!-- Form panel -->
          <div class="bg-surface-1 border border-border-subtle rounded-xl p-6 flex flex-col gap-6">
            <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted">New Deposit</h2>

            <!-- Account selector -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Account</label>
              <select
                v-model="selectedAccount"
                class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors appearance-none cursor-pointer">
                <option v-for="acc in accounts" :key="acc.accountNo" :value="acc.accountNo">
                  {{ acc.chain }} — {{ truncateAddress(acc.depositAddress) }}
                </option>
              </select>
            </div>

            <!-- Card selector -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Payment Method</label>
              <select
                v-model="selectedCard"
                class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors appearance-none cursor-pointer">
                <option v-for="card in cards" :key="card.id" :value="card.id">
                  •••• •••• •••• {{ card.lastFour }}  {{ cardTypeLabel[card.cardType] ?? 'Card' }}
                </option>
              </select>
            </div>

            <!-- Amount -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Amount</label>
              <div class="flex gap-3">
                <input
                  v-model="amount"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="0.00"
                  class="flex-1 bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white placeholder-text-muted font-['JetBrains_Mono'] focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors"
                />
                <div class="flex items-center px-4 bg-page border border-border-subtle rounded-lg text-sm font-['JetBrains_Mono'] text-text-muted shrink-0">
                  USD
                </div>
              </div>
            </div>

            <!-- Error -->
            <p v-if="formError" class="text-red-400 text-xs -mt-2">{{ formError }}</p>

            <!-- Submit -->
            <button
              type="button"
              @click="submit"
              :disabled="submitting"
              class="w-full bg-brand text-on-brand font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-full hover:bg-brand-hover active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {{ submitting ? 'Submitting…' : 'Deposit' }}
            </button>
          </div>

        </div>
      </template>

    </section>
  </MainLayout>
</template>

<style scoped>
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.2s ease;
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
</style>
