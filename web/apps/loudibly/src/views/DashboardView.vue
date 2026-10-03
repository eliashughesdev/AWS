<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { signOut, fetchUserAttributes } from 'aws-amplify/auth'
import { useRoute, useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import { brand } from '../brands'
import { USDT_TRON_CURRENCY } from '@loudibly/core/config'
import { listAccounts, listTransactions, createAccount as postAccount } from '@loudibly/core/api/accounts'
import { getProfile } from '@loudibly/core/api/profile'
import { getKycStatus, startDiditSession } from '@loudibly/core/api/kyc'

const route  = useRoute()
const router = useRouter()

const verifiedBanner = ref(route.query.verified === '1')

const displayName      = ref('...')
const userEmail        = ref('')
const kycBanner        = ref<'hidden' | 'start' | 'pending' | 'failed'>('hidden')
const kycLoading       = ref(false)
const createBanner     = ref(false)
const accountLoading   = ref<string | null>(null)
const accounts         = ref<any[]>([])
const accountsLoading  = ref(true)

// Imported accounts backfill asynchronously (SQS) — refresh in the background
// until every account has left 'importing' so the "Syncing…" badge clears
// without the user having to reload the page.
let importPollTimer: ReturnType<typeof setTimeout> | null = null

async function pollWhileImporting() {
  if (!accounts.value.some(a => a.status === 'importing')) return
  importPollTimer = setTimeout(async () => {
    try {
      const { data } = await listAccounts()
      accounts.value = data.accounts ?? accounts.value
    } catch (e) {
      console.error('Failed to refresh accounts', e)
    }
    pollWhileImporting()
  }, 5000)
}

onMounted(async () => {
  try {
    const attrs = await fetchUserAttributes()
    userEmail.value = attrs.email ?? ''
  } catch {
    router.push('/auth')
    return
  }

  try {
    const profile = await getProfile()
    if (profile.ok) {
      displayName.value = profile.data.name ?? userEmail.value.split('@')[0]
    } else {
      displayName.value = userEmail.value.split('@')[0]
    }

    createBanner.value = true
    const { data: accountsData } = await listAccounts()
    accounts.value = accountsData.accounts ?? []
    accountsLoading.value = false
    pollWhileImporting()

    if (accounts.value.length > 0) {
      const results = await Promise.all(
        accounts.value.map((a: any) =>
          listTransactions(a.accountNo).then(r => r.data).catch(() => ({ transactions: [] }))
        )
      )
      transactions.value = results
        .flatMap((r: any) => r.transactions ?? [])
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10)
      transactionsLoading.value = false
      return
    }
    transactionsLoading.value = false

    const { data: kycData } = await getKycStatus()
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

onUnmounted(() => {
  if (importPollTimer) clearTimeout(importPollTimer)
})

async function startKyc() {
  kycLoading.value = true
  try {
    const { data } = await startDiditSession()
    if (data.verification_url) {
      window.location.href = data.verification_url
    }
  } catch (e) {
    console.error('Failed to start KYC session', e)
  } finally {
    kycLoading.value = false
  }
}

async function createAccount(chain: string) {
  accountLoading.value = chain
  try {
    const { data } = await postAccount({
      account_name: displayName.value,
      email: userEmail.value,
      chain,
      provider: 'PCF0001',
      accounting_currency: 'USD',
    })
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
  else if (label === 'Receive') router.push({ name: 'receive' })
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
  BTC:            { icon: 'currency_bitcoin', iconBg: 'bg-amber-400/10',   iconColor: 'text-amber-400',  barColor: 'bg-amber-400'  },
  ETH:            { icon: 'eco',              iconBg: 'bg-blue-400/10',    iconColor: 'text-blue-400',   barColor: 'bg-blue-400'   },
  SOL:            { icon: 'api',              iconBg: 'bg-purple-500/10',  iconColor: 'text-purple-400', barColor: 'bg-purple-500' },
  TRON:           { icon: 'toll',             iconBg: 'bg-red-400/10',     iconColor: 'text-red-400',    barColor: 'bg-red-400'    },
  USDT_TRON:      { icon: 'toll',             iconBg: 'bg-emerald-400/10', iconColor: 'text-emerald-400', barColor: 'bg-emerald-400' },
  TUSDT_TRON: { icon: 'toll',             iconBg: 'bg-emerald-400/10', iconColor: 'text-emerald-400', barColor: 'bg-emerald-400' },
}

// USDT_TRON/TUSDT_TRON are Tatum ledger-currency identifiers, not display
// names — every other chain (TRON, SOL) already reads fine shown as-is.
function displayChain(chain: string) {
  return chain === 'USDT_TRON' || chain === 'TUSDT_TRON' ? 'USDT (TRON)' : chain
}
function displayTicker(chain: string) {
  return chain === 'USDT_TRON' || chain === 'TUSDT_TRON' ? 'USDT' : chain
}

const assets = computed(() => {
  const totalBal = accounts.value.reduce((sum, a) => sum + (a.balance ?? 0), 0)
  return accounts.value.map(a => {
    const cfg = a.chain
      ? (chainConfig[a.chain] ?? { icon: 'token', iconBg: 'bg-white/10', iconColor: 'text-white', barColor: 'bg-white' })
      : { icon: 'payments', iconBg: 'bg-white/10', iconColor: 'text-white', barColor: 'bg-brand' }
    const pct = totalBal > 0 ? Math.round((a.balance ?? 0) / totalBal * 100) : 0
    return {
      accountNo: a.accountNo,
      ticker: a.chain ? displayTicker(a.chain) : a.currency,
      icon: cfg.icon,
      iconBg: cfg.iconBg,
      iconColor: cfg.iconColor,
      amount: a.chain ? (a.balance ?? 0).toFixed(4) : `$${(a.balance ?? 0).toFixed(2)}`,
      label: a.chain ? displayChain(a.chain) : 'Cash Balance',
      barColor: cfg.barColor,
      barWidth: `${pct}%`,
      syncing: a.status === 'importing',
    }
  })
})

const transactions     = ref<any[]>([])
const transactionsLoading = ref(true)
const copied = ref('')

async function copyHash(txId: string) {
  await navigator.clipboard.writeText(txId)
  copied.value = txId
  setTimeout(() => { copied.value = '' }, 2000)
}

function txToDisplay(tx: any) {
  const isDeposit          = tx.type === 'DEPOSIT' || tx.type === 'DEPOSIT_FAILED'
  const isTransferReceived = tx.type === 'TRANSFER_RECEIVED'
  const isTransferSent     = tx.type === 'TRANSFER_SENT'
  const isTransfer         = isTransferReceived || isTransferSent
  const isIncoming         = isDeposit || isTransferReceived
  const isFailed           = tx.type.includes('FAILED')
  return {
    id:          tx.txId ?? tx.reference,
    icon:        isTransferSent ? 'compare_arrows' : isIncoming ? 'call_received' : 'call_made',
    iconBg:      isFailed ? 'bg-red-400/10' : isTransfer ? 'bg-amber-400/10' : isDeposit ? 'bg-blue-400/10' : 'bg-brand/10',
    iconColor:   isFailed ? 'text-red-400'  : isTransfer ? 'text-amber-400'  : isDeposit ? 'text-blue-400'  : 'text-brand',
    description: isTransferReceived
      ? `Transfer from ${String(tx.from ?? '').slice(0, 8)}…`
      : isTransferSent
      ? `Transfer to ${String(tx.to ?? '').slice(0, 8)}…`
      : isDeposit
      ? `Received ${tx.currency}`
      : `Sent to ${String(tx.to ?? '').slice(0, 8)}…`,
    date:        new Date(tx.createdAt).toLocaleString(),
    status:      isFailed ? 'FAILED' : 'CONFIRMED',
    statusClass: isFailed
      ? 'bg-red-400/10 text-red-400 border-red-400/20'
      : 'bg-green-400/10 text-green-400 border-green-400/20',
    amount:      isIncoming && !isFailed
      ? `+${tx.amount} ${tx.currency}`
      : `-${tx.amount} ${tx.currency}`,
    amountClass: isTransferReceived ? 'text-amber-400' : isDeposit && !isFailed ? 'text-brand' : '',
  }
}

function shortAccountNo(accountNo?: string) {
  return accountNo ? `···${accountNo.slice(-4)}` : ''
}

const validators = [
  { name: 'London-Edge-01',  uptime: '99.9%', dot: 'bg-green-400', pulse: true  },
  { name: 'NYC-Main-04',     uptime: '99.8%', dot: 'bg-green-400', pulse: true  },
  { name: 'Tokyo-Backup-02', uptime: '74.2%', dot: 'bg-amber-400', pulse: false },
]
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">

    <!-- Email Verified Banner -->
    <div v-if="verifiedBanner"
      class="w-full bg-brand/10 border-b border-brand/30 px-8 py-3 flex items-center gap-4">
      <span class="material-symbols-outlined text-brand shrink-0">mark_email_read</span>
      <p class="text-sm text-brand flex-1">Your email address has been verified.</p>
      <button @click="verifiedBanner = false"
        class="shrink-0 text-brand hover:text-brand-hover transition-colors flex items-center"
        aria-label="Dismiss">
        <span class="material-symbols-outlined text-lg">close</span>
      </button>
    </div>

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
        class="shrink-0 font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-amber-400 text-on-brand rounded-full hover:bg-amber-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
        {{ kycLoading ? 'Starting…' : 'Complete Verification →' }}
      </button>
    </div>

    <!-- Account Creation Banner -->
    <div v-if="createBanner"
      class="w-full bg-brand/10 border-b border-brand/30 px-8 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div class="flex items-center gap-3 flex-1">
        <span class="material-symbols-outlined text-brand shrink-0">account_balance_wallet</span>
        <p class="text-sm text-brand">
          Identity verified — select a blockchain to activate your account.
        </p>
      </div>
      <div class="flex gap-3 shrink-0 flex-wrap">
        <button
          @click="createAccount('TRON')"
          :disabled="accountLoading !== null"
          class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 bg-brand text-on-brand rounded-full hover:bg-brand-hover active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ accountLoading === 'TRON' ? 'Creating…' : 'TRON' }}
        </button>
        <button
          @click="createAccount('SOL')"
          :disabled="accountLoading !== null"
          class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 border border-brand text-brand rounded-full hover:bg-brand/10 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ accountLoading === 'SOL' ? 'Creating…' : 'Solana' }}
        </button>
        <button
          @click="createAccount(USDT_TRON_CURRENCY)"
          :disabled="accountLoading !== null"
          class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2 border border-brand text-brand rounded-full hover:bg-brand/10 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ accountLoading === USDT_TRON_CURRENCY ? 'Creating…' : 'USDT (TRON)' }}
        </button>
      </div>
    </div>

    <!-- Dashboard Content -->
    <section class="p-8 max-w-7xl mx-auto w-full">

      <!-- Greeting & Hero Balance -->
      <div class="mb-12">
        <p class="text-[14px] text-text-secondary mb-1">Good afternoon, {{ displayName }}.</p>
      </div>

      <!-- Quick Actions -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        <button v-for="action in quickActions" :key="action.label"
          @click="handleQuickAction(action.label)"
          class="flex flex-col items-center justify-center p-6 bg-surface-1 border border-border-subtle rounded-xl hover:bg-surface-2 hover:border-brand transition-all group">
          <span class="material-symbols-outlined text-3xl mb-2 text-brand group-hover:scale-110 transition-transform">{{ action.icon }}</span>
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-widest">{{ action.label }}</span>
        </button>
      </div>

      <!-- Asset Allocation -->
      <div class="mb-12">
        <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-6">Asset Allocation</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Skeleton cards while loading -->
          <template v-if="accountsLoading">
            <div v-for="i in 4" :key="i"
              class="p-5 bg-surface-1 border border-border-subtle rounded-lg relative overflow-hidden animate-pulse">
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
          <div v-else v-for="asset in assets" :key="asset.accountNo ?? asset.ticker"
            class="p-5 bg-surface-1 border border-border-subtle rounded-lg relative overflow-hidden">
            <div class="flex justify-between items-start mb-6">
              <div class="p-2 rounded" :class="asset.iconBg">
                <span class="material-symbols-outlined" :class="asset.iconColor">{{ asset.icon }}</span>
              </div>
              <span v-if="asset.syncing"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-amber-400/10 text-amber-400 border-amber-400/20">
                <span class="material-symbols-outlined text-xs animate-spin" style="animation-duration: 1.5s">autorenew</span>
                Syncing
              </span>
              <span v-else class="font-['JetBrains_Mono'] text-xs text-text-muted">
                {{ asset.ticker }}<template v-if="asset.accountNo"> · {{ shortAccountNo(asset.accountNo) }}</template>
              </span>
            </div>
            <p class="font-['JetBrains_Mono'] text-2xl font-bold">{{ asset.amount }}</p>
            <p class="text-[12px] text-text-secondary mt-1">{{ asset.syncing ? `${asset.label} — history syncing` : asset.label }}</p>
            <div class="absolute bottom-0 left-0 h-1" :class="asset.barColor" :style="{ width: asset.barWidth }"></div>
          </div>
        </div>
      </div>

      <!-- Recent Activity + System Intelligence -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">

        <div class="lg:col-span-2">
          <div class="flex justify-between items-center mb-6">
            <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted">Recent Activity</h2>
            <RouterLink :to="{ name: 'ledger' }" class="text-brand font-['JetBrains_Mono'] text-xs hover:underline">View All →</RouterLink>
          </div>
          <div class="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden">
            <table class="w-full text-left">
              <thead class="bg-surface-2 border-b border-border-subtle">
                <tr>
                  <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Transaction</th>
                  <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Status</th>
                  <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase text-right">Amount</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border-subtle">
                <!-- Loading skeleton -->
                <template v-if="transactionsLoading">
                  <tr v-for="i in 3" :key="i" class="animate-pulse">
                    <td class="px-6 py-4">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded bg-white/10"></div>
                        <div class="flex flex-col gap-1">
                          <div class="w-32 h-3 rounded bg-white/10"></div>
                          <div class="w-20 h-2 rounded bg-white/10"></div>
                        </div>
                      </div>
                    </td>
                    <td class="px-6 py-4"><div class="w-16 h-4 rounded bg-white/10"></div></td>
                    <td class="px-6 py-4 flex justify-end"><div class="w-20 h-3 rounded bg-white/10"></div></td>
                  </tr>
                </template>
                <!-- Empty state -->
                <tr v-else-if="transactions.length === 0">
                  <td colspan="3" class="px-6 py-8 text-center text-text-muted font-['JetBrains_Mono'] text-xs">No transactions yet</td>
                </tr>
                <!-- Real rows -->
                <tr v-else v-for="tx in transactions.map(txToDisplay)" :key="tx.id" class="hover:bg-white/[0.02] transition-colors cursor-pointer">
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded flex items-center justify-center" :class="tx.iconBg">
                        <span class="material-symbols-outlined text-lg" :class="tx.iconColor">{{ tx.icon }}</span>
                      </div>
                      <div>
                        <p class="text-[14px]">{{ tx.description }}</p>
                        <p class="text-[12px] text-text-muted">{{ tx.date }}</p>
                        <button
                          type="button"
                          @click="copyHash(tx.id)"
                          class="mt-1 flex items-center gap-1 text-[11px] text-text-muted hover:text-white transition-colors font-['JetBrains_Mono']">
                          <span>{{ tx.id.slice(0, 8) }}…{{ tx.id.slice(-6) }}</span>
                          <span class="material-symbols-outlined text-[13px] shrink-0">
                            {{ copied === tx.id ? 'check' : 'content_copy' }}
                          </span>
                        </button>
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
          <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted">System Intelligence</h2>

          <div class="bg-surface-1 border border-border-subtle p-6 rounded-xl relative overflow-hidden">
            <div class="relative z-10">
              <span class="material-symbols-outlined text-brand mb-4 block">analytics</span>
              <h3 class="text-[18px] font-semibold mb-2">Network Yield</h3>
              <p class="text-text-secondary text-sm mb-6">Current infrastructure utilization is at 84%. Recommended reallocation to SOL liquidity pools for 6.2% APY.</p>
              <button class="w-full py-2 bg-white/5 border border-border-subtle rounded-full font-['JetBrains_Mono'] text-xs uppercase tracking-widest hover:bg-white/10 transition-colors">
                Analyze Strategy
              </button>
            </div>
            <div class="absolute -right-12 -bottom-12 w-48 h-48 bg-brand/5 blur-3xl rounded-full"></div>
          </div>

          <div class="bg-surface-1 border border-border-subtle p-6 rounded-xl">
            <h3 class="font-['JetBrains_Mono'] text-xs text-text-muted uppercase mb-4">Validator Status</h3>
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
    <footer class="w-full py-8 px-8 flex flex-col md:flex-row justify-between items-center border-t border-border-subtle mt-12">
      <div class="font-['JetBrains_Mono'] text-[13px] text-white mb-4 md:mb-0">
        {{ brand.name }} <span class="text-text-muted">v2.4.12</span>
      </div>
      <p class="text-[12px] text-text-muted">© 2024 {{ brand.name }}. All rights reserved.</p>
      <div class="flex gap-6 mt-4 md:mt-0">
        <a class="text-[12px] text-text-muted hover:text-brand underline transition-colors" href="#">Privacy Policy</a>
        <a class="text-[12px] text-text-muted hover:text-brand underline transition-colors" href="#">Compliance</a>
        <a class="text-[12px] text-text-muted hover:text-brand underline transition-colors" href="#">SLA</a>
      </div>
    </footer>

  </MainLayout>
</template>
