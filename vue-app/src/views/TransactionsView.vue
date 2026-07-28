<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { signOut, fetchUserAttributes, fetchAuthSession } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'

const API_BASE = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1'

const router = useRouter()

const displayName       = ref('...')
const userEmail         = ref('')
const accounts          = ref<any[]>([])
const selectedAccount   = ref<string | null>(null)
const transactions      = ref<any[]>([])
const transactionsLoading = ref(true)

async function getAuthHeaders() {
  const session = await fetchAuthSession()
  const token = session.tokens?.accessToken?.toString()
  return { Authorization: `Bearer ${token}`, 'X-Project': 'web' }
}

async function fetchTransactions() {
  transactionsLoading.value = true
  try {
    const headers = await getAuthHeaders()
    const targets = selectedAccount.value === null
      ? accounts.value
      : accounts.value.filter(a => a.accountNumber === selectedAccount.value)

    const results = await Promise.all(
      targets.map((a: any) =>
        fetch(`${API_BASE}/accounts/transactions`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountNumber: a.accountNo }),
        }).then(r => r.json()).catch(() => ({ transactions: [] }))
      )
    )
    transactions.value = results
      .flatMap((r: any) => r.transactions ?? [])
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } finally {
    transactionsLoading.value = false
  }
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
    accounts.value = data.accounts ?? []
    await fetchTransactions()
  } catch {
    transactionsLoading.value = false
  }
})

watch(selectedAccount, fetchTransactions)

function selectAccount(accountNumber: string | null) {
  selectedAccount.value = accountNumber
}

async function handleSignOut() {
  await signOut()
  router.push('/auth')
}

function txToDisplay(tx: any) {
  const isDeposit          = tx.type === 'DEPOSIT' || tx.type === 'DEPOSIT_FAILED'
  const isTransferReceived = tx.type === 'TRANSFER_RECEIVED'
  const isTransferSent     = tx.type === 'TRANSFER_SENT'
  const isTransfer         = isTransferReceived || isTransferSent
  const isIncoming         = isDeposit || isTransferReceived
  const isFailed           = tx.type.includes('FAILED')
  return {
    id:          tx.txId,
    icon:        isTransferSent ? 'compare_arrows' : isIncoming ? 'call_received' : 'call_made',
    iconBg:      isFailed ? 'bg-red-400/10' : isTransfer ? 'bg-amber-400/10' : isDeposit ? 'bg-blue-400/10' : 'bg-noda-teal/10',
    iconColor:   isFailed ? 'text-red-400'  : isTransfer ? 'text-amber-400'  : isDeposit ? 'text-blue-400'  : 'text-noda-teal',
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
    amountClass: isTransferReceived ? 'text-amber-400' : isDeposit && !isFailed ? 'text-noda-teal' : '',
    accountLabel: (() => {
      const acct = accounts.value.find(a => a.accountNumber === tx.accountNumber)
      return acct?.chain ?? acct?.currency ?? '—'
    })(),
  }
}

const showAccountColumn = () => selectedAccount.value === null
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">
    <section class="p-8 max-w-7xl mx-auto w-full">

      <div class="mb-8">
        <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-1">Ledger</h1>
        <p class="text-[14px] text-text-secondary">Full transaction history, newest first.</p>
      </div>

      <!-- Account selector -->
      <div class="flex flex-wrap gap-2 mb-8">
        <button
          @click="selectAccount(null)"
          :class="selectedAccount === null
            ? 'bg-noda-teal text-noda-navy font-bold'
            : 'bg-noda-navy-2 text-text-secondary border border-border-subtle hover:text-white hover:border-white/20'"
          class="font-['JetBrains_Mono'] text-xs px-4 py-2 rounded-full transition-all">
          All Accounts
        </button>
        <button
          v-for="acct in accounts"
          :key="acct.accountNumber"
          @click="selectAccount(acct.accountNumber)"
          :class="selectedAccount === acct.accountNumber
            ? 'bg-noda-teal text-noda-navy font-bold'
            : 'bg-noda-navy-2 text-text-secondary border border-border-subtle hover:text-white hover:border-white/20'"
          class="font-['JetBrains_Mono'] text-xs px-4 py-2 rounded-full transition-all">
          {{ acct.chain ?? acct.currency ?? acct.accountNumber }}
        </button>
      </div>

      <!-- Transaction table -->
      <div class="bg-noda-navy-2 border border-border-subtle rounded-xl overflow-hidden">
        <table class="w-full text-left">
          <thead class="bg-noda-navy-3 border-b border-border-subtle">
            <tr>
              <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Transaction</th>
              <th v-if="showAccountColumn()" class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Account</th>
              <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Status</th>
              <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase text-right">Amount</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle">
            <!-- Loading skeleton -->
            <template v-if="transactionsLoading">
              <tr v-for="i in 5" :key="i" class="animate-pulse">
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded bg-white/10"></div>
                    <div class="flex flex-col gap-1">
                      <div class="w-36 h-3 rounded bg-white/10"></div>
                      <div class="w-24 h-2 rounded bg-white/10"></div>
                    </div>
                  </div>
                </td>
                <td v-if="showAccountColumn()" class="px-6 py-4"><div class="w-12 h-4 rounded bg-white/10"></div></td>
                <td class="px-6 py-4"><div class="w-16 h-4 rounded bg-white/10"></div></td>
                <td class="px-6 py-4 flex justify-end"><div class="w-20 h-3 rounded bg-white/10"></div></td>
              </tr>
            </template>
            <!-- Empty state -->
            <tr v-else-if="transactions.length === 0">
              <td :colspan="showAccountColumn() ? 4 : 3" class="px-6 py-12 text-center text-text-muted font-['JetBrains_Mono'] text-xs">
                No transactions found for this account.
              </td>
            </tr>
            <!-- Real rows -->
            <tr
              v-else
              v-for="tx in transactions.map(txToDisplay)"
              :key="tx.id"
              class="hover:bg-white/[0.02] transition-colors">
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded flex items-center justify-center" :class="tx.iconBg">
                    <span class="material-symbols-outlined text-lg" :class="tx.iconColor">{{ tx.icon }}</span>
                  </div>
                  <div>
                    <p class="text-[14px]">{{ tx.description }}</p>
                    <p class="text-[12px] text-text-muted">{{ tx.date }}</p>
                  </div>
                </div>
              </td>
              <td v-if="showAccountColumn()" class="px-6 py-4">
                <span class="font-['JetBrains_Mono'] text-[10px] px-2 py-0.5 rounded bg-white/5 border border-border-subtle text-text-secondary">
                  {{ tx.accountLabel }}
                </span>
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

    </section>
  </MainLayout>
</template>
