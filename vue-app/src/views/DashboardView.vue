<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { signOut, fetchUserAttributes, fetchAuthSession } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'

const API_BASE = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1'

const router = useRouter()

const displayName      = ref('...')
const userEmail        = ref('')
const kycBanner        = ref<'hidden' | 'start' | 'pending' | 'failed'>('hidden')
const kycLoading       = ref(false)
const createBanner     = ref(false)
const accountLoading   = ref<'TRON' | 'SOL' | null>(null)
const accounts         = ref<any[]>([])
const accountsLoading  = ref(true)

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

    createBanner.value = true
    const accountsRes  = await fetch(`${API_BASE}/accounts/list`, { headers })
    const accountsData = await accountsRes.json()
    accounts.value = accountsData.accounts ?? []
    accountsLoading.value = false

    if (accounts.value.length > 0) return

    const kycRes  = await fetch(`${API_BASE}/accounts/kyc/status`, { headers })
    const kycData = await kycRes.json()
    const kycStatus: string | undefined = kycData.kyc?.status

    if (kycStatus === 'Approved') {
      createBanner.value = true
    } else if (kycStatus === 'In Progress') {
      kycBanner.value = 'pending'
    } else if (!kycStatus || kycStatus === 'Not Started') {
      kycBanner.value = 'start'
    } else {
      kycBanner.value = 'failed'
    }
  } catch {
    accountsLoading.value = false
    kycBanner.value = 'start'
  }
})

async function startKyc() {
  kycLoading.value = true
  try {
    const headers = await getAuthHeaders()
    const res  = await fetch(`${API_BASE}/accounts/kyc/didit/session`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (data.verification_url) {
      window.location.href = data.verification_url
    }
  } catch (e) {
    console.error('Failed to start KYC session', e)
  } finally {
    kycLoading.value = false
  }
}

async function createAccount(chain: 'TRON' | 'SOL') {
  accountLoading.value = chain
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${API_BASE}/accounts/account`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_name: displayName.value,
        email: userEmail.value,
        chain,
        provider: 'PCF0001',
        accounting_currency: 'USD',
      }),
    })
    const data = await res.json()
    if (data.success) {
      createBanner.value = false
    }
  } catch (e) {
    console.error('Failed to create account', e)
  } finally {
    accountLoading.value = null
  }
}

function handleQuickAction(label: string) {
  if (label === 'Deposit') router.push({ name: 'deposit' })
  else if (label === 'Withdraw') router.push({ name: 'withdraw' })
}

async function handleSignOut() {
  await signOut()
  router.push('/auth')
}

const quickActions = [
  { icon: 'south_west', label: 'Deposit' },
  { icon: 'north_east', label: 'Withdraw' },
  { icon: 'send',       label: 'Send' },
  { icon: 'qr_code_2',  label: 'Receive' },
]

const chainConfig: Record<string, { icon: string; iconBg: string; iconColor: string; barColor: string }> = {
  BTC:  { icon: 'currency_bitcoin', iconBg: 'bg-amber-400/10',  iconColor: 'text-amber-400',  barColor: 'bg-amber-400'  },
  ETH:  { icon: 'eco',              iconBg: 'bg-blue-400/10',   iconColor: 'text-blue-400',   barColor: 'bg-blue-400'   },
  SOL:  { icon: 'api',              iconBg: 'bg-purple-500/10', iconColor: 'text-purple-400', barColor: 'bg-purple-500' },
  TRON: { icon: 'toll',             iconBg: 'bg-red-400/10',    iconColor: 'text-red-400',    barColor: 'bg-red-400'    },
}


const assets = computed(() => {
  const totalBal = accounts.value.reduce((sum, a) => sum + (a.balance ?? 0), 0)
  return accounts.value.map(a => {
    const cfg = a.chain
      ? (chainConfig[a.chain] ?? { icon: 'token', iconBg: 'bg-white/10', iconColor: 'text-white', barColor: 'bg-white' })
      : { icon: 'payments', iconBg: 'bg-white/10', iconColor: 'text-white', barColor: 'bg-[#CCFF00]' }
    const pct = totalBal > 0 ? Math.round((a.balance ?? 0) / totalBal * 100) : 0
    return {
      ticker: a.chain ?? a.currency,
      icon: cfg.icon,
      iconBg: cfg.iconBg,
      iconColor: cfg.iconColor,
      amount: a.chain ? (a.balance ?? 0).toFixed(4) : `$${(a.balance ?? 0).toFixed(2)}`,
      label: a.chain ?? 'Cash Balance',
      barColor: cfg.barColor,
      barWidth: `${pct}%`,
    }
  })
})

const transactions = [
  {
    id: 1,
    icon: 'call_made',     iconBg: 'bg-[#CCFF00]/10', iconColor: 'text-[#CCFF00]',
    description: 'Sent to Kraken Wallet',  date: 'Oct 24, 14:22',
    status: 'CONFIRMED',  statusClass: 'bg-green-400/10 text-green-400 border-green-400/20',
    amount: '-0.05 BTC',  amountClass: '',
  },
  {
    id: 2,
    icon: 'call_received', iconBg: 'bg-blue-400/10',   iconColor: 'text-blue-400',
    description: 'Deposit from Chase Bank', date: 'Oct 23, 09:15',
    status: 'CONFIRMED',  statusClass: 'bg-green-400/10 text-green-400 border-green-400/20',
    amount: '+$1,200.00', amountClass: 'text-[#CCFF00]',
  },
  {
    id: 3,
    icon: 'sync',          iconBg: 'bg-amber-400/10',  iconColor: 'text-amber-400',
    description: 'Swap USD to ETH',        date: 'Oct 22, 18:45',
    status: 'PROCESSING', statusClass: 'bg-[#464749] text-[#A1A1AA] border-white/[0.08]',
    amount: '0.52 ETH',   amountClass: '',
  },
]

const validators = [
  { name: 'London-Edge-01',  uptime: '99.9%', dot: 'bg-green-400', pulse: true  },
  { name: 'NYC-Main-04',     uptime: '99.8%', dot: 'bg-green-400', pulse: true  },
  { name: 'Tokyo-Backup-02', uptime: '74.2%', dot: 'bg-amber-400', pulse: false },
]
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">

    <!-- KYC Banner -->
    <div v-if="kycBanner !== 'hidden'"
      class="w-full bg-amber-400/10 border-b border-amber-400/30 px-8 py-3 flex items-center gap-4">
      <span class="material-symbols-outlined text-amber-400 shrink-0">
        {{ kycBanner === 'pending' ? 'hourglass_top' : kycBanner === 'failed' ? 'error' : 'warning' }}
      </span>
      <p class="text-sm text-amber-300 flex-1">
        <template v-if="kycBanner === 'start'">Your account requires identity verification before you can access all features.</template>
        <template v-else-if="kycBanner === 'pending'">Your identity verification is in progress — we'll update your account once it's complete.</template>
        <template v-else-if="kycBanner === 'failed'">Your identity verification was not successful. Please contact support.</template>
      </p>
      <button v-if="kycBanner === 'start'"
        @click="startKyc"
        :disabled="kycLoading"
        class="shrink-0 font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-amber-400 text-black rounded hover:bg-amber-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
        {{ kycLoading ? 'Starting…' : 'Complete Verification →' }}
      </button>
    </div>

    <!-- Account Creation Banner -->
    <div v-if="createBanner"
      class="w-full bg-[#CCFF00]/10 border-b border-[#CCFF00]/30 px-8 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div class="flex items-center gap-3 flex-1">
        <span class="material-symbols-outlined text-[#CCFF00] shrink-0">account_balance_wallet</span>
        <p class="text-sm text-[#CCFF00]">
          Identity verified — select a blockchain to activate your account.
        </p>
      </div>
      <div class="flex gap-3 shrink-0">
        <button
          @click="createAccount('TRON')"
          :disabled="accountLoading !== null"
          class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-[#CCFF00] text-black rounded hover:bg-lime-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ accountLoading === 'TRON' ? 'Creating…' : 'TRON' }}
        </button>
        <button
          @click="createAccount('SOL')"
          :disabled="accountLoading !== null"
          class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 border border-[#CCFF00] text-[#CCFF00] rounded hover:bg-[#CCFF00]/10 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ accountLoading === 'SOL' ? 'Creating…' : 'Solana' }}
        </button>
      </div>
    </div>

    <!-- Dashboard Content -->
    <section class="p-8 max-w-7xl mx-auto w-full">

      <!-- Greeting & Hero Balance -->
      <div class="mb-12">
        <p class="text-[14px] text-[#A1A1AA] mb-1">Good afternoon, {{ displayName }}.</p>
      </div>

      <!-- Quick Actions -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        <button v-for="action in quickActions" :key="action.label"
          @click="handleQuickAction(action.label)"
          class="flex flex-col items-center justify-center p-6 bg-[#1a1d10] border border-white/[0.08] rounded-xl hover:bg-[#282b1d] hover:border-[#CCFF00] transition-all group">
          <span class="material-symbols-outlined text-3xl mb-2 text-[#CCFF00] group-hover:scale-110 transition-transform">{{ action.icon }}</span>
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-widest">{{ action.label }}</span>
        </button>
      </div>

      <!-- Asset Allocation -->
      <div class="mb-12">
        <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-[#52525B] mb-6">Asset Allocation</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Skeleton cards while loading -->
          <template v-if="accountsLoading">
            <div v-for="i in 4" :key="i"
              class="p-5 bg-[#1a1d10] border border-white/[0.08] rounded-lg relative overflow-hidden animate-pulse">
              <div class="flex justify-between items-start mb-6">
                <div class="w-10 h-10 rounded bg-white/10"></div>
                <div class="w-10 h-3 rounded bg-white/10"></div>
              </div>
              <div class="w-32 h-7 rounded bg-white/10 mb-2"></div>
              <div class="w-16 h-3 rounded bg-white/10"></div>
              <div class="absolute bottom-0 left-0 h-1 w-1/3 bg-white/10"></div>
            </div>
          </template>
          <!-- Real account cards -->
          <div v-else v-for="asset in assets" :key="asset.ticker"
            class="p-5 bg-[#1a1d10] border border-white/[0.08] rounded-lg relative overflow-hidden">
            <div class="flex justify-between items-start mb-6">
              <div class="p-2 rounded" :class="asset.iconBg">
                <span class="material-symbols-outlined" :class="asset.iconColor">{{ asset.icon }}</span>
              </div>
              <span class="font-['JetBrains_Mono'] text-xs text-[#52525B]">{{ asset.ticker }}</span>
            </div>
            <p class="font-['JetBrains_Mono'] text-2xl font-bold">{{ asset.amount }}</p>
            <p class="text-[12px] text-[#A1A1AA] mt-1">{{ asset.label }}</p>
            <div class="absolute bottom-0 left-0 h-1" :class="asset.barColor" :style="{ width: asset.barWidth }"></div>
          </div>
        </div>
      </div>

      <!-- Recent Activity + System Intelligence -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">

        <div class="lg:col-span-2">
          <div class="flex justify-between items-center mb-6">
            <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-[#52525B]">Recent Activity</h2>
            <button class="text-[#CCFF00] font-['JetBrains_Mono'] text-xs hover:underline">Export CSV</button>
          </div>
          <div class="bg-[#1a1d10] border border-white/[0.08] rounded-xl overflow-hidden">
            <table class="w-full text-left">
              <thead class="bg-[#282b1d] border-b border-white/[0.08]">
                <tr>
                  <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-[#52525B] uppercase">Transaction</th>
                  <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-[#52525B] uppercase">Status</th>
                  <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-[#52525B] uppercase text-right">Amount</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/[0.08]">
                <tr v-for="tx in transactions" :key="tx.id" class="hover:bg-white/[0.02] transition-colors cursor-pointer">
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded flex items-center justify-center" :class="tx.iconBg">
                        <span class="material-symbols-outlined text-lg" :class="tx.iconColor">{{ tx.icon }}</span>
                      </div>
                      <div>
                        <p class="text-[14px]">{{ tx.description }}</p>
                        <p class="text-[12px] text-[#52525B]">{{ tx.date }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border" :class="tx.statusClass">
                      {{ tx.status }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-right font-['JetBrains_Mono'] text-sm" :class="tx.amountClass">{{ tx.amount }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="flex flex-col gap-6">
          <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-[#52525B]">System Intelligence</h2>

          <div class="bg-[#1a1d10] border border-white/[0.08] p-6 rounded-xl relative overflow-hidden">
            <div class="relative z-10">
              <span class="material-symbols-outlined text-[#CCFF00] mb-4 block">analytics</span>
              <h3 class="text-[18px] font-semibold mb-2">Network Yield</h3>
              <p class="text-[#A1A1AA] text-sm mb-6">Current infrastructure utilization is at 84%. Recommended reallocation to SOL liquidity pools for 6.2% APY.</p>
              <button class="w-full py-2 bg-white/5 border border-white/[0.08] rounded font-['JetBrains_Mono'] text-xs uppercase tracking-widest hover:bg-white/10 transition-colors">
                Analyze Strategy
              </button>
            </div>
            <div class="absolute -right-12 -bottom-12 w-48 h-48 bg-[#CCFF00]/5 blur-3xl rounded-full"></div>
          </div>

          <div class="bg-[#1a1d10] border border-white/[0.08] p-6 rounded-xl">
            <h3 class="font-['JetBrains_Mono'] text-xs text-[#52525B] uppercase mb-4">Validator Status</h3>
            <div class="space-y-4">
              <div v-for="v in validators" :key="v.name" class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full" :class="[v.dot, v.pulse ? 'animate-pulse' : '']"></span>
                  <span class="text-xs">{{ v.name }}</span>
                </div>
                <span class="font-['JetBrains_Mono'] text-xs">{{ v.uptime }}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>

    <!-- Footer -->
    <footer class="w-full py-8 px-8 flex flex-col md:flex-row justify-between items-center border-t border-white/[0.08] mt-12">
      <div class="font-['JetBrains_Mono'] text-[13px] text-white mb-4 md:mb-0">
        Loudibly <span class="text-[#52525B]">v2.4.12</span>
      </div>
      <p class="text-[12px] text-[#52525B]">© 2024 Loudibly Infrastructure. All rights reserved.</p>
      <div class="flex gap-6 mt-4 md:mt-0">
        <a class="text-[12px] text-[#52525B] hover:text-[#CCFF00] underline transition-colors" href="#">Privacy Policy</a>
        <a class="text-[12px] text-[#52525B] hover:text-[#CCFF00] underline transition-colors" href="#">Compliance</a>
        <a class="text-[12px] text-[#52525B] hover:text-[#CCFF00] underline transition-colors" href="#">SLA</a>
      </div>
    </footer>

  </MainLayout>
</template>
