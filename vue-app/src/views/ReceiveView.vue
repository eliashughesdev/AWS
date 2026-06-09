<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchUserAttributes, fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import QRCode from 'qrcode'
import MainLayout from '../layouts/MainLayout.vue'

const API_BASE = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1'

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

const accounts       = ref<Account[]>([])
const loading        = ref(true)
const selectedChain  = ref<'TRON' | 'SOL'>('TRON')
const creating       = ref(false)
const createError    = ref('')
const copied         = ref(false)
const qrDataUrl      = ref('')

const chainMeta: Record<string, { label: string; ticker: string; icon: string; iconBg: string; iconColor: string }> = {
  TRON: { label: 'TRON', ticker: 'TRX', icon: 'toll',  iconBg: 'bg-red-400/10',    iconColor: 'text-red-400'    },
  SOL:  { label: 'Solana', ticker: 'SOL', icon: 'api', iconBg: 'bg-purple-500/10', iconColor: 'text-purple-400' },
}

const activeAccount = computed<Account | undefined>(() =>
  accounts.value.find(a => a.chain === selectedChain.value)
)

async function getAuthHeaders() {
  const session = await fetchAuthSession()
  const token = session.tokens?.accessToken?.toString()
  return { Authorization: `Bearer ${token}`, 'X-Project': 'web' }
}

async function loadAccounts() {
  const headers  = await getAuthHeaders()
  const res      = await fetch(`${API_BASE}/accounts/list`, { headers })
  const data     = await res.json()
  accounts.value = (data.accounts ?? []).filter((a: Account) => !!a.chain)
}

async function generateQr(address: string) {
  try {
    qrDataUrl.value = await QRCode.toDataURL(address, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#CCFF00' },
    })
  } catch {
    qrDataUrl.value = ''
  }
}

async function selectChain(chain: 'TRON' | 'SOL') {
  selectedChain.value = chain
  createError.value   = ''
  const acc = accounts.value.find(a => a.chain === chain)
  if (acc) await generateQr(acc.depositAddress)
  else qrDataUrl.value = ''
}

async function createAccount() {
  creating.value    = true
  createError.value = ''
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${API_BASE}/accounts/account`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_name:        `${selectedChain.value} Account`,
        chain:               selectedChain.value,
        provider:            'PCF0001',
        accounting_currency: 'USD',
        userId:              userId.value,
        email:               userEmail.value,
      }),
    })
    if (!res.ok) throw new Error('Failed to create account')
    await loadAccounts()
    const acc = accounts.value.find(a => a.chain === selectedChain.value)
    if (acc) await generateQr(acc.depositAddress)
  } catch (e: any) {
    createError.value = e.message ?? 'Something went wrong. Please try again.'
  } finally {
    creating.value = false
  }
}

async function copyAddress() {
  if (!activeAccount.value) return
  await navigator.clipboard.writeText(activeAccount.value.depositAddress)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
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

  try {
    await loadAccounts()
    const acc = accounts.value.find(a => a.chain === selectedChain.value)
    if (acc) await generateQr(acc.depositAddress)
  } catch (e) {
    console.error('Failed to load accounts', e)
  } finally {
    loading.value = false
  }
})

async function handleSignOut() {
  await signOut()
  router.push('/auth')
}
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">
    <section class="p-8 max-w-7xl mx-auto w-full">

      <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-[#52525B] mb-8">Receive Crypto</h1>

      <!-- Loading skeleton -->
      <div v-if="loading" class="max-w-sm mx-auto space-y-4">
        <div class="h-12 bg-[#1a1d10] border border-white/[0.08] rounded-xl animate-pulse" />
        <div class="h-64 bg-[#1a1d10] border border-white/[0.08] rounded-xl animate-pulse" />
      </div>

      <template v-else>
        <div class="max-w-sm mx-auto flex flex-col gap-6">

          <!-- Chain toggle -->
          <div class="flex bg-[#1a1d10] border border-white/[0.08] rounded-xl p-1 gap-1">
            <button
              v-for="(meta, chain) in chainMeta"
              :key="chain"
              @click="selectChain(chain as 'TRON' | 'SOL')"
              :class="[
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-[\'JetBrains_Mono\'] font-bold transition-all',
                selectedChain === chain
                  ? 'bg-[#CCFF00] text-[#0A0B0D]'
                  : 'text-[#A1A1AA] hover:text-white'
              ]">
              <span class="material-symbols-outlined text-base">{{ meta.icon }}</span>
              {{ meta.ticker }}
            </button>
          </div>

          <!-- Deposit address panel -->
          <div class="bg-[#1a1d10] border border-white/[0.08] rounded-xl p-6 flex flex-col items-center gap-6">

            <!-- Has account: show QR + address -->
            <template v-if="activeAccount">
              <p class="text-xs text-[#52525B] font-['JetBrains_Mono'] self-start uppercase tracking-widest">
                Your {{ chainMeta[selectedChain].label }} deposit address
              </p>

              <!-- QR code -->
              <div class="p-3 bg-[#CCFF00] rounded-xl">
                <img
                  v-if="qrDataUrl"
                  :src="qrDataUrl"
                  alt="Deposit address QR code"
                  class="w-40 h-40 block"
                />
                <div v-else class="w-40 h-40 flex items-center justify-center">
                  <span class="material-symbols-outlined text-4xl text-[#0A0B0D] animate-spin">autorenew</span>
                </div>
              </div>

              <!-- Address + copy -->
              <div class="w-full bg-[#0A0B0D] border border-white/[0.08] rounded-lg px-4 py-3 flex items-center gap-3">
                <span class="flex-1 font-['JetBrains_Mono'] text-xs text-white break-all">
                  {{ activeAccount.depositAddress }}
                </span>
                <button
                  @click="copyAddress"
                  class="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest transition-colors"
                  :class="copied ? 'text-[#CCFF00]' : 'text-[#52525B] hover:text-white'">
                  <span class="material-symbols-outlined text-sm">{{ copied ? 'check' : 'content_copy' }}</span>
                  {{ copied ? 'Copied' : 'Copy' }}
                </button>
              </div>

              <!-- Warning -->
              <div class="w-full flex items-start gap-2 bg-amber-400/5 border border-amber-400/20 rounded-lg px-4 py-3">
                <span class="material-symbols-outlined text-sm text-amber-400 shrink-0 mt-0.5">warning</span>
                <p class="text-xs text-amber-400">
                  Only send <strong>{{ chainMeta[selectedChain].ticker }}</strong> to this address.
                  Sending other assets will result in permanent loss.
                </p>
              </div>

              <!-- Instruction -->
              <p class="text-xs text-[#52525B] text-center leading-relaxed">
                Open your external wallet (MetaMask, Trust Wallet, Coinbase, etc.),
                scan the QR code or paste the address above, and send
                {{ chainMeta[selectedChain].ticker }}.
                Funds usually arrive within a few minutes — refresh your dashboard to check your balance.
              </p>
            </template>

            <!-- No account for this chain yet -->
            <template v-else>
              <span class="material-symbols-outlined text-5xl text-[#52525B]">account_balance_wallet</span>
              <div class="text-center">
                <p class="text-sm text-[#A1A1AA] mb-1">No {{ chainMeta[selectedChain].label }} account yet.</p>
                <p class="text-xs text-[#52525B]">Create one to get your deposit address.</p>
              </div>

              <p v-if="createError" class="text-red-400 text-xs text-center">{{ createError }}</p>

              <button
                @click="createAccount"
                :disabled="creating"
                class="w-full bg-[#CCFF00] text-[#0A0B0D] font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-lg hover:bg-lime-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {{ creating ? 'Creating…' : `Create ${chainMeta[selectedChain].ticker} Account` }}
              </button>
            </template>

          </div>

        </div>
      </template>

    </section>
  </MainLayout>
</template>
