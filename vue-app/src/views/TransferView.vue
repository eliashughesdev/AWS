<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { signOut, fetchUserAttributes, fetchAuthSession } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import { API_BASE } from '../config'

const router = useRouter()

const displayName = ref('...')
const userEmail   = ref('')

interface Account {
  accountNo: string
  chain: string
  currency: string
  depositAddress: string
  status: string
  balance: number
}

const accounts    = ref<Account[]>([])
const loading     = ref(true)

const selectedFrom = ref('')
const selectedTo   = ref('')
const amount       = ref('')
const formError    = ref('')
const submitting   = ref(false)

type TransferStatus = 'idle' | 'processing' | 'success' | 'failed'
const transferStatus = ref<TransferStatus>('idle')
const transferError  = ref('')

const fromAccount = computed(() => accounts.value.find(a => a.accountNo === selectedFrom.value))

async function getAuthHeaders() {
  const session = await fetchAuthSession()
  const token = session.tokens?.accessToken?.toString()
  return { Authorization: `Bearer ${token}`, 'X-Project': 'web' }
}

onMounted(async () => {
  try {
    const attrs = await fetchUserAttributes()
    userEmail.value   = attrs.email ?? ''
    displayName.value = attrs.email?.split('@')[0] ?? 'User'
  } catch {
    router.push('/auth')
    return
  }

  try {
    const headers = await getAuthHeaders()
    const res  = await fetch(`${API_BASE}/accounts/list`, { headers })
    const data = await res.json()
    accounts.value = (data.accounts ?? []).filter((a: Account) => !!a.chain)

    if (accounts.value.length >= 1) {
      selectedFrom.value = accounts.value[0].accountNo
    }
  } catch (e) {
    console.error('Failed to load accounts', e)
  } finally {
    loading.value = false
  }
})

async function submit() {
  formError.value = ''

  if (!selectedFrom.value || !selectedTo.value) {
    formError.value = 'Please select both source and destination accounts.'
    return
  }
  if (selectedFrom.value === selectedTo.value) {
    formError.value = 'Source and destination accounts must be different.'
    return
  }

  const parsed = parseFloat(amount.value)
  if (!amount.value || isNaN(parsed) || parsed <= 0) {
    formError.value = 'Enter a valid amount greater than 0.'
    return
  }

  if (fromAccount.value && parsed > (fromAccount.value.balance ?? 0)) {
    formError.value = `Insufficient balance. Available: ${fromAccount.value.balance} ${fromAccount.value.chain}`
    return
  }

  transferStatus.value = 'processing'
  submitting.value     = true

  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${API_BASE}/accounts/transfer`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider:                'PCF0001',
        senderAccountNumber:    selectedFrom.value,
        recipientAccountNumber: selectedTo.value,
        amount:                 parsed.toString(),
      }),
    })

    const data = await res.json().catch(() => ({}))

    if (res.ok && data.success) {
      transferStatus.value = 'success'
    } else {
      transferStatus.value = 'failed'
      transferError.value  = data.message ?? 'Transfer failed. Please try again.'
    }
  } catch {
    transferStatus.value = 'failed'
    transferError.value  = 'An unexpected error occurred.'
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  transferStatus.value = 'idle'
  transferError.value  = ''
  formError.value      = ''
  amount.value         = ''
}

async function handleSignOut() {
  await signOut()
  router.push('/auth')
}
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">
    <section class="p-8 max-w-7xl mx-auto w-full">

      <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-8">Transfer</h1>

      <!-- Loading skeleton -->
      <div v-if="loading" class="max-w-lg mx-auto space-y-4">
        <div class="h-20 bg-noda-navy-2 border border-border-subtle rounded-xl animate-pulse" />
        <div class="h-20 bg-noda-navy-2 border border-border-subtle rounded-xl animate-pulse" />
      </div>

      <template v-else>

        <!-- No accounts -->
        <div v-if="accounts.length === 0"
          class="max-w-lg mx-auto flex flex-col items-center justify-center py-20 bg-noda-navy-2 border border-border-subtle rounded-xl text-center">
          <span class="material-symbols-outlined text-5xl text-text-muted mb-4">compare_arrows</span>
          <p class="text-text-secondary text-sm mb-1">You need an account to transfer from.</p>
          <p class="text-text-muted text-xs mb-6">Create one from your dashboard.</p>
          <RouterLink :to="{ name: 'dashboard' }"
            class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-noda-teal text-noda-navy rounded-full hover:bg-noda-teal-bright active:scale-95 transition-all">
            Go to Dashboard
          </RouterLink>
        </div>

        <!-- Transfer form -->
        <div v-else-if="accounts.length > 0" class="max-w-lg mx-auto relative">

          <!-- Status overlay -->
          <Transition name="overlay">
            <div v-if="transferStatus !== 'idle'"
              class="absolute inset-0 z-10 bg-noda-navy/90 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center gap-4 p-8 text-center">

              <template v-if="transferStatus === 'processing'">
                <span class="material-symbols-outlined text-6xl text-amber-400 animate-spin" style="animation-duration: 1.5s">autorenew</span>
                <p class="font-['JetBrains_Mono'] text-sm text-text-secondary">Processing transfer…</p>
              </template>

              <template v-else-if="transferStatus === 'success'">
                <span class="material-symbols-outlined text-6xl text-noda-teal" style="font-variation-settings: 'FILL' 1">check_circle</span>
                <p class="font-['JetBrains_Mono'] text-lg font-bold text-white">Transfer Complete!</p>
                <p class="text-xs text-text-muted">The funds have been moved between your accounts.</p>
                <div class="flex gap-3 mt-2">
                  <button @click="resetForm"
                    class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-noda-navy-2 border border-border-subtle text-white rounded-full hover:bg-noda-navy-3 active:scale-95 transition-all">
                    New Transfer
                  </button>
                  <RouterLink :to="{ name: 'ledger' }"
                    class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-noda-teal text-noda-navy rounded-full hover:bg-noda-teal-bright active:scale-95 transition-all">
                    View Ledger
                  </RouterLink>
                </div>
              </template>

              <template v-else-if="transferStatus === 'failed'">
                <span class="material-symbols-outlined text-6xl text-red-400" style="font-variation-settings: 'FILL' 1">cancel</span>
                <p class="font-['JetBrains_Mono'] text-lg font-bold text-white">Transfer Failed</p>
                <p class="text-sm text-red-400">{{ transferError }}</p>
                <button @click="resetForm"
                  class="mt-2 font-['JetBrains_Mono'] text-xs font-bold px-6 py-3 bg-noda-navy-2 border border-border-subtle text-white rounded-full hover:bg-noda-navy-3 active:scale-95 transition-all">
                  Try Again
                </button>
              </template>

            </div>
          </Transition>

          <!-- Form panel -->
          <div class="bg-noda-navy-2 border border-border-subtle rounded-xl p-6 flex flex-col gap-6">
            <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted">New Transfer</h2>

            <!-- From account -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">From</label>
              <select
                v-model="selectedFrom"
                class="w-full bg-noda-navy border border-border-subtle rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-noda-teal/50 focus:ring-1 focus:ring-noda-teal/30 transition-colors appearance-none cursor-pointer">
                <option v-for="acc in accounts" :key="acc.accountNo" :value="acc.accountNo">
                  {{ acc.chain }} — Balance: {{ acc.balance }} {{ acc.chain }}
                </option>
              </select>
            </div>

            <!-- To account -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">To (Account Number)</label>
              <input
                v-model="selectedTo"
                type="text"
                placeholder="Paste destination account number"
                class="w-full bg-noda-navy border border-border-subtle rounded-lg px-4 py-3 text-sm text-white placeholder-text-muted font-['JetBrains_Mono'] focus:outline-none focus:border-noda-teal/50 focus:ring-1 focus:ring-noda-teal/30 transition-colors"
              />
            </div>

            <!-- Amount -->
            <div>
              <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Amount</label>
              <div class="flex gap-3">
                <input
                  v-model="amount"
                  type="number"
                  min="0.000001"
                  step="any"
                  placeholder="0.00"
                  class="flex-1 bg-noda-navy border border-border-subtle rounded-lg px-4 py-3 text-sm text-white placeholder-text-muted font-['JetBrains_Mono'] focus:outline-none focus:border-noda-teal/50 focus:ring-1 focus:ring-noda-teal/30 transition-colors"
                />
                <div class="flex items-center px-4 bg-noda-navy border border-border-subtle rounded-lg text-sm font-['JetBrains_Mono'] text-text-muted shrink-0">
                  {{ fromAccount?.chain ?? '—' }}
                </div>
              </div>
              <p v-if="fromAccount" class="mt-1.5 text-[10px] text-text-muted font-['JetBrains_Mono']">
                Available: {{ fromAccount.balance }} {{ fromAccount.chain }}
              </p>
            </div>

            <!-- Error -->
            <p v-if="formError" class="text-red-400 text-xs -mt-2">{{ formError }}</p>

            <!-- Submit -->
            <button
              type="button"
              @click="submit"
              :disabled="submitting"
              class="w-full bg-noda-teal text-noda-navy font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-full hover:bg-noda-teal-bright active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {{ submitting ? 'Processing…' : 'Transfer' }}
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
