<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { signOut, fetchUserAttributes, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'

const API_BASE = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1'
const WS_BASE  = 'wss://v4vqz0z2q4.execute-api.us-east-2.amazonaws.com/v1'

const BINANCE_SYMBOL_MAP: Record<string, string> = { TRON: 'TRX' }

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
  balance: number
  availableBalance: number
}

const accounts = ref<Account[]>([])
const loading  = ref(true)

const selectedAccount    = ref('')
const amount             = ref('')
const destinationAddress = ref('')
const formError          = ref('')
const submitting         = ref(false)
const withdrawMode       = ref<'usd' | 'crypto'>('usd')

const exchangeRate = ref<number | null>(null)
const rateLoading  = ref(false)

const selectedAccountData = computed(() =>
  accounts.value.find(a => a.accountNo === selectedAccount.value)
)

const cryptoEquivalent = computed(() => {
  if (!exchangeRate.value || !amount.value || isNaN(parseFloat(amount.value))) return null
  return (parseFloat(amount.value) / exchangeRate.value).toFixed(4)
})

const usdEquivalent = computed(() => {
  if (!exchangeRate.value || !amount.value || isNaN(parseFloat(amount.value))) return null
  return (parseFloat(amount.value) * exchangeRate.value).toFixed(2)
})

type WithdrawStatus = 'idle' | 'processing' | 'success' | 'failed'
const withdrawStatus = ref<WithdrawStatus>('idle')
const withdrawError  = ref('')

let ws: WebSocket | null = null
let wsTimeout: ReturnType<typeof setTimeout> | null = null

async function getAuthHeaders() {
  const session = await fetchAuthSession()
  const token = session.tokens?.accessToken?.toString()
  return { Authorization: `Bearer ${token}`, 'X-Project': 'web' }
}

async function fetchExchangeRate(chain: string) {
  rateLoading.value  = true
  exchangeRate.value = null
  try {
    const ticker = BINANCE_SYMBOL_MAP[chain] ?? chain
    const res  = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${ticker}USDT`)
    const data = await res.json()
    if (data.price) exchangeRate.value = parseFloat(data.price)
  } catch {
    exchangeRate.value = null
  } finally {
    rateLoading.value = false
  }
}

watch(selectedAccount, (accountNo) => {
  const acc = accounts.value.find(a => a.accountNo === accountNo)
  if (acc?.chain) fetchExchangeRate(acc.chain)
  amount.value = ''
  withdrawMode.value = 'usd'
})

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
    const headers  = await getAuthHeaders()
    const accRes   = await fetch(`${API_BASE}/accounts/list`, { headers })
    const allAccounts: Account[] = (await accRes.json()).accounts ?? []
    accounts.value = allAccounts.filter(a => !!a.chain)

    if (accounts.value.length > 0) {
      selectedAccount.value = accounts.value[0].accountNo
      fetchExchangeRate(accounts.value[0].chain)
    }
  } catch (e) {
    console.error('Failed to load accounts', e)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => closeWs())

function closeWs() {
  if (wsTimeout) { clearTimeout(wsTimeout); wsTimeout = null }
  if (ws) { ws.close(); ws = null }
}

function handleWithdrawResult(data: any) {
  closeWs()
  if (data.success && data.status === 'withdrawal_complete') {
    withdrawStatus.value = 'success'
  } else {
    withdrawStatus.value = 'failed'
    withdrawError.value  = data.error ?? 'Withdrawal failed. Please try again.'
  }
}

async function submit() {
  formError.value = ''

  if (!selectedAccount.value) { formError.value = 'Please select an account.'; return }

  const parsed = parseFloat(amount.value)
  if (!amount.value || isNaN(parsed) || parsed <= 0) {
    formError.value = 'Enter a valid amount greater than 0.'
    return
  }

  if (!destinationAddress.value.trim()) {
    formError.value = 'Enter a destination address.'
    return
  }

  if (withdrawMode.value === 'crypto') {
    if (parsed > (selectedAccountData.value?.availableBalance ?? 0)) {
      formError.value = `Insufficient balance. Available: ${selectedAccountData.value?.availableBalance} ${selectedAccountData.value?.chain}`
      return
    }
  } else if (selectedAccountData.value && cryptoEquivalent.value) {
    if (parseFloat(cryptoEquivalent.value) > (selectedAccountData.value.availableBalance ?? 0)) {
      formError.value = `Insufficient balance. Available: ${selectedAccountData.value.availableBalance} ${selectedAccountData.value.chain}`
      return
    }
  }

  const transactionId = crypto.randomUUID()

  ws = new WebSocket(`${WS_BASE}?userId=${userId.value}&paymentId=${transactionId}`)
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'PAYMENT_RESULT') handleWithdrawResult(msg.data)
    } catch { }
  }
  ws.onerror = () => console.warn('WebSocket error; will rely on timeout fallback')

  withdrawStatus.value = 'processing'
  submitting.value     = true

  wsTimeout = setTimeout(() => {
    if (withdrawStatus.value === 'processing') {
      closeWs()
      withdrawStatus.value = 'failed'
      withdrawError.value  = 'No confirmation received. Your withdrawal may still be processing — check your balance later.'
    }
  }, 60_000)

  const isCryptoMode = withdrawMode.value === 'crypto'

  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${API_BASE}/accounts/withdraw`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountNumber:      selectedAccount.value,
        ...(isCryptoMode
          ? { cryptoAmount: parsed }
          : { currency: 'USD', amount: parsed }),
        userId:             userId.value,
        destinationAddress: destinationAddress.value.trim(),
        transactionId,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      closeWs()
      withdrawStatus.value = 'failed'
      withdrawError.value  = data.message ?? 'Withdrawal request failed. Please try again.'
    }
  } catch {
    closeWs()
    withdrawStatus.value = 'failed'
    withdrawError.value  = 'An unexpected error occurred.'
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  withdrawStatus.value     = 'idle'
  withdrawError.value      = ''
  formError.value          = ''
  amount.value             = ''
  destinationAddress.value = ''
}

async function handleSignOut() {
  closeWs()
  await signOut()
  router.push('/auth')
}
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">
    <section class="p-8 max-w-7xl mx-auto w-full">

      <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-[#52525B] mb-8">Withdraw</h1>

      <!-- Loading skeleton -->
      <div v-if="loading" class="max-w-lg mx-auto space-y-4">
        <div class="h-20 bg-[#1a1d10] border border-white/[0.08] rounded-xl animate-pulse" />
        <div class="h-20 bg-[#1a1d10] border border-white/[0.08] rounded-xl animate-pulse" />
      </div>

      <template v-else>

        <!-- Empty state: no crypto accounts -->
        <div v-if="accounts.length === 0"
          class="max-w-lg mx-auto flex flex-col items-center justify-center py-20 bg-[#1a1d10] border border-white/[0.08] rounded-xl text-center">
          <span class="material-symbols-outlined text-5xl text-[#52525B] mb-4">account_balance_wallet</span>
          <p class="text-[#A1A1AA] text-sm mb-1">No crypto account found.</p>
          <p class="text-[#52525B] text-xs mb-6">Please create one from your dashboard.</p>
          <RouterLink :to="{ name: 'dashboard' }"
            class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-[#CCFF00] text-black rounded hover:bg-lime-300 active:scale-95 transition-all">
            Go to Dashboard
          </RouterLink>
        </div>

        <!-- Withdraw form -->
        <div v-else class="max-w-lg mx-auto relative">

          <!-- Processing overlay -->
          <Transition name="overlay">
            <div v-if="withdrawStatus !== 'idle'"
              class="absolute inset-0 z-10 bg-[#0A0B0D]/90 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center gap-4 p-8 text-center">

              <template v-if="withdrawStatus === 'processing'">
                <span class="material-symbols-outlined text-6xl text-[#CCFF00] animate-spin" style="animation-duration: 1.5s">autorenew</span>
                <p class="font-['JetBrains_Mono'] text-sm text-[#A1A1AA]">Processing your withdrawal…</p>
                <p class="text-xs text-[#52525B]">This may take a moment. Please don't close this page.</p>
              </template>

              <template v-else-if="withdrawStatus === 'success'">
                <span class="material-symbols-outlined text-6xl text-[#CCFF00]" style="font-variation-settings: 'FILL' 1">check_circle</span>
                <p class="font-['JetBrains_Mono'] text-lg font-bold text-white">Withdrawal Submitted!</p>
                <p class="text-xs text-[#52525B]">Your balance will be updated once confirmed on-chain.</p>
                <RouterLink :to="{ name: 'dashboard' }"
                  class="mt-2 font-['JetBrains_Mono'] text-xs font-bold px-6 py-3 bg-[#CCFF00] text-black rounded-lg hover:bg-lime-300 active:scale-95 transition-all">
                  Back to Dashboard
                </RouterLink>
              </template>

              <template v-else-if="withdrawStatus === 'failed'">
                <span class="material-symbols-outlined text-6xl text-red-400" style="font-variation-settings: 'FILL' 1">cancel</span>
                <p class="font-['JetBrains_Mono'] text-lg font-bold text-white">Withdrawal Failed</p>
                <p class="text-sm text-red-400">{{ withdrawError }}</p>
                <button @click="resetForm"
                  class="mt-2 font-['JetBrains_Mono'] text-xs font-bold px-6 py-3 bg-[#1a1d10] border border-white/[0.08] text-white rounded-lg hover:bg-[#282b1d] active:scale-95 transition-all">
                  Try Again
                </button>
              </template>

            </div>
          </Transition>

          <!-- Form panel -->
          <div class="bg-[#1a1d10] border border-white/[0.08] rounded-xl p-6 flex flex-col gap-6">
            <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-[#52525B]">New Withdrawal</h2>

            <!-- Mode toggle -->
            <div class="flex bg-[#0A0B0D] border border-white/[0.08] rounded-lg p-1 gap-1">
              <button
                type="button"
                @click="withdrawMode = 'usd'; amount = ''"
                :class="[
                  'flex-1 py-2 rounded text-xs font-[\'JetBrains_Mono\'] font-bold transition-all',
                  withdrawMode === 'usd' ? 'bg-[#CCFF00] text-[#0A0B0D]' : 'text-[#A1A1AA] hover:text-white'
                ]">
                Pay in USD
              </button>
              <button
                type="button"
                @click="withdrawMode = 'crypto'; amount = ''"
                :class="[
                  'flex-1 py-2 rounded text-xs font-[\'JetBrains_Mono\'] font-bold transition-all',
                  withdrawMode === 'crypto' ? 'bg-[#CCFF00] text-[#0A0B0D]' : 'text-[#A1A1AA] hover:text-white'
                ]">
                Pay in {{ selectedAccountData?.chain ?? 'Crypto' }}
              </button>
            </div>

            <!-- Account selector -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#52525B] mb-1.5">Account</label>
              <select
                v-model="selectedAccount"
                class="w-full bg-[#0A0B0D] border border-white/[0.08] rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-[#CCFF00]/50 focus:ring-1 focus:ring-[#CCFF00]/30 transition-colors appearance-none cursor-pointer">
                <option v-for="acc in accounts" :key="acc.accountNo" :value="acc.accountNo">
                  {{ acc.chain }} — Balance: {{ acc.availableBalance }} {{ acc.chain }}
                </option>
              </select>
            </div>

            <!-- Amount -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#52525B] mb-1.5">Amount</label>
              <div class="flex gap-3">
                <input
                  v-model="amount"
                  type="number"
                  min="0.000001"
                  step="any"
                  placeholder="0.00"
                  class="flex-1 bg-[#0A0B0D] border border-white/[0.08] rounded-lg px-4 py-3 text-sm text-white placeholder-[#52525B] font-['JetBrains_Mono'] focus:outline-none focus:border-[#CCFF00]/50 focus:ring-1 focus:ring-[#CCFF00]/30 transition-colors"
                />
                <div class="flex items-center px-4 bg-[#0A0B0D] border border-white/[0.08] rounded-lg text-sm font-['JetBrains_Mono'] text-[#52525B] shrink-0">
                  {{ withdrawMode === 'crypto' ? (selectedAccountData?.chain ?? '—') : 'USD' }}
                </div>
              </div>
              <!-- Equivalent preview -->
              <div class="mt-2 h-5 flex items-center">
                <template v-if="rateLoading">
                  <span class="text-xs text-[#52525B] animate-pulse">Fetching rate…</span>
                </template>
                <template v-else-if="withdrawMode === 'usd' && cryptoEquivalent && selectedAccountData">
                  <span class="text-xs text-[#CCFF00] font-['JetBrains_Mono']">
                    ≈ {{ cryptoEquivalent }} {{ selectedAccountData.chain }}
                  </span>
                  <span class="text-xs text-[#52525B] ml-2">(live rate)</span>
                </template>
                <template v-else-if="withdrawMode === 'crypto' && usdEquivalent && selectedAccountData">
                  <span class="text-xs text-[#CCFF00] font-['JetBrains_Mono']">≈ ${{ usdEquivalent }}</span>
                  <span class="text-xs text-[#52525B] ml-2">(live rate)</span>
                </template>
              </div>
            </div>

            <!-- Destination address -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#52525B] mb-1.5">Destination Address</label>
              <input
                v-model="destinationAddress"
                type="text"
                placeholder="Paste blockchain address"
                class="w-full bg-[#0A0B0D] border border-white/[0.08] rounded-lg px-4 py-3 text-sm text-white placeholder-[#52525B] font-['JetBrains_Mono'] focus:outline-none focus:border-[#CCFF00]/50 focus:ring-1 focus:ring-[#CCFF00]/30 transition-colors"
              />
            </div>

            <!-- Error -->
            <p v-if="formError" class="text-red-400 text-xs -mt-2">{{ formError }}</p>

            <!-- Submit -->
            <button
              type="button"
              @click="submit"
              :disabled="submitting"
              class="w-full bg-[#CCFF00] text-[#0A0B0D] font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-lg hover:bg-lime-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {{ submitting ? 'Submitting…' : 'Withdraw' }}
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
