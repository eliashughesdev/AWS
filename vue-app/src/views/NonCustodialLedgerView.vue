<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import { useWalletSession } from '../wallet/session'
import { readWallet, type WalletRead } from '../wallet/reads'
import { chainLabels, type OnChainTx } from '../wallet/types'

const router  = useRouter()
const session = useWalletSession()

const reads    = ref<WalletRead[]>([])
const loading  = ref(true)
const errorMsg = ref('')

const displayName = computed(() => {
  const address = session.active.value?.address ?? ''
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Wallet'
})

async function refresh(force = false) {
  errorMsg.value = ''
  try {
    reads.value = await Promise.all(
      session.wallets.value.map(w => readWallet(w.chain, w.address, force)),
    )
  } catch (e) {
    errorMsg.value = 'Could not reach the network.'
    console.error('Failed to read history', e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (session.wallets.value.length === 0) {
    router.push({ name: 'auth' })
    return
  }
  refresh()
})

// The chain only returns the most recent window of history (100 txs). Anything
// older lives on-chain and is not mirrored here — nothing is stored server-side.
const rows = computed(() =>
  reads.value
    .flatMap(r => r.transactions.map(tx => ({ tx, chain: r.chain })))
    .sort((a, b) => (b.tx.timestamp ?? 0) - (a.tx.timestamp ?? 0)),
)

function txToDisplay(tx: OnChainTx) {
  const incoming = tx.amount >= 0
  const counterparty = incoming ? tx.from : tx.to
  return {
    icon: incoming ? 'call_received' : 'call_made',
    iconBg: incoming ? 'bg-noda-teal/10' : 'bg-blue-400/10',
    iconColor: incoming ? 'text-noda-teal' : 'text-blue-400',
    direction: incoming ? 'Received' : 'Sent',
    counterparty: counterparty ?? 'unknown',
    date: tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '—',
    amount: `${incoming ? '+' : ''}${tx.amount.toFixed(6)} ${tx.currency}`,
    amountClass: incoming ? 'text-noda-teal' : '',
  }
}

function handleSignOut() {
  session.clear()
  router.push({ name: 'auth' })
}
</script>

<template>
  <MainLayout :displayName="displayName" userEmail="" :nonCustodial="true" @signOut="handleSignOut">
    <section class="p-8 max-w-5xl mx-auto w-full">

      <div class="flex justify-between items-center mb-8">
        <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted">Ledger</h1>
        <button
          @click="refresh(true)"
          class="flex items-center gap-2 px-3 py-1.5 border border-border-subtle rounded-full text-text-secondary hover:text-white hover:bg-white/5 transition-all">
          <span class="material-symbols-outlined text-sm">refresh</span>
          <span class="font-['JetBrains_Mono'] text-xs">Refresh</span>
        </button>
      </div>

      <p v-if="errorMsg" class="mb-6 text-sm text-red-400">{{ errorMsg }}</p>

      <div class="bg-noda-navy-2 border border-border-subtle rounded-xl overflow-hidden">
        <table class="w-full text-left">
          <thead class="bg-noda-navy-3 border-b border-border-subtle">
            <tr>
              <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Transaction</th>
              <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Chain</th>
              <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase text-right">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle">
            <template v-if="loading">
              <tr v-for="i in 5" :key="i" class="animate-pulse">
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded bg-white/10"></div>
                    <div class="flex flex-col gap-1">
                      <div class="w-40 h-3 rounded bg-white/10"></div>
                      <div class="w-24 h-2 rounded bg-white/10"></div>
                    </div>
                  </div>
                </td>
                <td class="px-6 py-4"><div class="w-12 h-3 rounded bg-white/10"></div></td>
                <td class="px-6 py-4 flex justify-end"><div class="w-24 h-3 rounded bg-white/10"></div></td>
              </tr>
            </template>

            <tr v-else-if="rows.length === 0">
              <td colspan="3" class="px-6 py-10 text-center text-text-muted font-['JetBrains_Mono'] text-xs">
                No transactions on this address yet
              </td>
            </tr>

            <tr v-else v-for="row in rows" :key="row.tx.txId" class="hover:bg-white/[0.02] transition-colors">
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded flex items-center justify-center shrink-0"
                    :class="txToDisplay(row.tx).iconBg">
                    <span class="material-symbols-outlined text-lg" :class="txToDisplay(row.tx).iconColor">
                      {{ txToDisplay(row.tx).icon }}
                    </span>
                  </div>
                  <div class="min-w-0">
                    <p class="text-[14px]">
                      {{ txToDisplay(row.tx).direction }}
                      <span class="text-text-muted">·</span>
                      <span class="font-['JetBrains_Mono'] text-[12px] text-text-secondary">
                        {{ txToDisplay(row.tx).counterparty }}
                      </span>
                    </p>
                    <p class="text-[12px] text-text-muted">{{ txToDisplay(row.tx).date }}</p>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 font-['JetBrains_Mono'] text-xs text-text-secondary">
                {{ chainLabels[row.chain] }}
              </td>
              <td class="px-6 py-4 text-right font-['JetBrains_Mono'] text-sm"
                :class="txToDisplay(row.tx).amountClass">
                {{ txToDisplay(row.tx).amount }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="mt-4 font-['JetBrains_Mono'] text-[11px] text-text-muted">
        Read live from the blockchain — the most recent 100 transactions per address. Nothing is stored.
      </p>

    </section>
  </MainLayout>
</template>
