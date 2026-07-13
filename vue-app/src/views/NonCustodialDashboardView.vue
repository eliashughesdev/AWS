<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import { useWalletSession } from '../wallet/session'
import { readWallet, READ_TTL_MS, type WalletRead } from '../wallet/reads'
import { chainLabels, type OnChainTx } from '../wallet/types'

const router  = useRouter()
const session = useWalletSession()

const reads       = ref<WalletRead[]>([])
const loading     = ref(true)
const errorMsg    = ref('')
const lastUpdated = ref<number | null>(null)
const copied      = ref('')

const displayName = computed(() => {
  const address = session.active.value?.address ?? ''
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Wallet'
})

// The chain is the source of truth — nothing is stored server-side, so every
// refresh re-reads it. readWallet() collapses this to one network round trip per
// address per TTL; `force` skips the cache for an explicit user refresh.
async function refresh(force = false) {
  if (session.wallets.value.length === 0) return
  errorMsg.value = ''
  try {
    reads.value = await Promise.all(
      session.wallets.value.map(w => readWallet(w.chain, w.address, force)),
    )
    lastUpdated.value = Date.now()
  } catch (e) {
    errorMsg.value = 'Could not reach the network. Retrying shortly.'
    console.error('Failed to read wallets', e)
  } finally {
    loading.value = false
  }
}

// Poll on the TTL cadence: activity from any other wallet or platform shows up
// within one TTL. No subscription, no websocket — nothing to tie to an identity.
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  if (session.wallets.value.length === 0) {
    router.push({ name: 'auth' })
    return
  }
  refresh()
  pollTimer = setInterval(() => refresh(), READ_TTL_MS)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

function handleSignOut() {
  session.clear()
  router.push({ name: 'auth' })
}

async function copyAddress(address: string) {
  await navigator.clipboard.writeText(address)
  copied.value = address
  setTimeout(() => { copied.value = '' }, 2000)
}

const chainConfig: Record<string, { icon: string; iconBg: string; iconColor: string; barColor: string }> = {
  SOL:  { icon: 'api',  iconBg: 'bg-purple-500/10', iconColor: 'text-purple-400', barColor: 'bg-purple-500' },
  TRON: { icon: 'toll', iconBg: 'bg-red-400/10',    iconColor: 'text-red-400',    barColor: 'bg-red-400'    },
}

const assets = computed(() => {
  const total = reads.value.reduce((sum, r) => sum + r.balance, 0)
  return reads.value.map(r => {
    const cfg = chainConfig[r.chain]
    return {
      chain: r.chain,
      label: chainLabels[r.chain],
      address: r.address,
      amount: r.balance.toFixed(4),
      ...cfg,
      barWidth: `${total > 0 ? Math.round((r.balance / total) * 100) : 0}%`,
    }
  })
})

const transactions = computed(() =>
  reads.value
    .flatMap(r => r.transactions)
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, 15),
)

function txToDisplay(tx: OnChainTx) {
  const incoming = tx.amount >= 0
  const counterparty = incoming ? tx.from : tx.to
  return {
    id: tx.txId,
    icon: incoming ? 'call_received' : 'call_made',
    iconBg: incoming ? 'bg-[#CCFF00]/10' : 'bg-blue-400/10',
    iconColor: incoming ? 'text-[#CCFF00]' : 'text-blue-400',
    description: incoming
      ? `Received from ${String(counterparty ?? 'unknown').slice(0, 8)}…`
      : `Sent to ${String(counterparty ?? 'unknown').slice(0, 8)}…`,
    date: tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '—',
    amount: `${incoming ? '+' : ''}${tx.amount.toFixed(6)} ${tx.currency}`,
    amountClass: incoming ? 'text-[#CCFF00]' : '',
  }
}

const lastUpdatedLabel = computed(() =>
  lastUpdated.value ? new Date(lastUpdated.value).toLocaleTimeString() : '—',
)
</script>

<template>
  <MainLayout :displayName="displayName" userEmail="" :nonCustodial="true" @signOut="handleSignOut">

    <!-- Anonymous-session notice -->
    <div class="w-full bg-amber-400/10 border-b border-amber-400/30 px-8 py-3 flex items-center gap-4">
      <span class="material-symbols-outlined text-amber-400 shrink-0">key</span>
      <p class="text-sm text-amber-300 flex-1">
        Anonymous session. Your key is held in this tab only — closing it signs you out, and
        you'll need the key to return. Loudibly stores nothing.
      </p>
    </div>

    <section class="p-8 max-w-7xl mx-auto w-full">

      <div class="flex justify-between items-center mb-12">
        <p class="text-[14px] text-[#A1A1AA]">Reading live from the blockchain.</p>
        <div class="flex items-center gap-4">
          <span class="font-['JetBrains_Mono'] text-[11px] text-[#52525B]">
            Updated {{ lastUpdatedLabel }}
          </span>
          <button
            @click="refresh(true)"
            class="flex items-center gap-2 px-3 py-1.5 border border-white/[0.08] rounded-lg text-[#A1A1AA] hover:text-white hover:bg-white/5 transition-all">
            <span class="material-symbols-outlined text-sm">refresh</span>
            <span class="font-['JetBrains_Mono'] text-xs">Refresh</span>
          </button>
        </div>
      </div>

      <p v-if="errorMsg" class="mb-6 text-sm text-red-400">{{ errorMsg }}</p>

      <!-- Wallets -->
      <div class="mb-12">
        <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-[#52525B] mb-6">Your Wallets</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <template v-if="loading">
            <div v-for="i in 2" :key="i"
              class="p-5 bg-[#1a1d10] border border-white/[0.08] rounded-lg animate-pulse">
              <div class="w-10 h-10 rounded bg-white/10 mb-6"></div>
              <div class="w-32 h-7 rounded bg-white/10 mb-2"></div>
              <div class="w-24 h-3 rounded bg-white/10"></div>
            </div>
          </template>

          <div v-else v-for="asset in assets" :key="asset.address"
            class="p-5 bg-[#1a1d10] border border-white/[0.08] rounded-lg relative overflow-hidden">
            <div class="flex justify-between items-start mb-6">
              <div class="p-2 rounded" :class="asset.iconBg">
                <span class="material-symbols-outlined" :class="asset.iconColor">{{ asset.icon }}</span>
              </div>
              <span class="font-['JetBrains_Mono'] text-xs text-[#52525B]">{{ asset.label }}</span>
            </div>
            <p class="font-['JetBrains_Mono'] text-2xl font-bold">{{ asset.amount }}</p>
            <button
              @click="copyAddress(asset.address)"
              class="mt-2 flex items-center gap-1.5 text-[11px] text-[#A1A1AA] hover:text-white transition-colors font-['JetBrains_Mono'] max-w-full">
              <span class="truncate">{{ asset.address }}</span>
              <span class="material-symbols-outlined text-[14px] shrink-0">
                {{ copied === asset.address ? 'check' : 'content_copy' }}
              </span>
            </button>
            <div class="absolute bottom-0 left-0 h-1" :class="asset.barColor" :style="{ width: asset.barWidth }"></div>
          </div>
        </div>
      </div>

      <!-- Recent activity -->
      <div>
        <div class="flex justify-between items-center mb-6">
          <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-[#52525B]">Recent Activity</h2>
          <RouterLink :to="{ name: 'wallet-ledger' }" class="text-[#CCFF00] font-['JetBrains_Mono'] text-xs hover:underline">View All →</RouterLink>
        </div>
        <div class="bg-[#1a1d10] border border-white/[0.08] rounded-xl overflow-hidden">
          <table class="w-full text-left">
            <thead class="bg-[#282b1d] border-b border-white/[0.08]">
              <tr>
                <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-[#52525B] uppercase">Transaction</th>
                <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-[#52525B] uppercase text-right">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.08]">
              <template v-if="loading">
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
                  <td class="px-6 py-4 flex justify-end"><div class="w-20 h-3 rounded bg-white/10"></div></td>
                </tr>
              </template>

              <tr v-else-if="transactions.length === 0">
                <td colspan="2" class="px-6 py-8 text-center text-[#52525B] font-['JetBrains_Mono'] text-xs">
                  No transactions on this address yet
                </td>
              </tr>

              <tr v-else v-for="tx in transactions.map(txToDisplay)" :key="tx.id"
                class="hover:bg-white/[0.02] transition-colors">
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
                <td class="px-6 py-4 text-right font-['JetBrains_Mono'] text-sm" :class="tx.amountClass">
                  {{ tx.amount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </section>
  </MainLayout>
</template>
