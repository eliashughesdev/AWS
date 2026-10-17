<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAccounts } from '@loudibly/core/composables/useAccounts'
import { useTransactions } from '@loudibly/core/composables/useTransactions'
import AppIcon from '../components/AppIcon.vue'
import DataTable from '../components/DataTable.vue'
import ListState from '../components/ListState.vue'
import StatusPill from '../components/StatusPill.vue'
import { activityKind } from '../activity'
import { coinFor } from '../coins'
import { coinAmount, dateTime, shorten } from '../format'

const columns = ['#', 'Wallet', 'Amount', 'Status', 'Date', 'TX HASH']
// The Date and TX HASH columns are not drawn on mobile; their widths there are not from the design.
const grid = 'grid-cols-[60px_107px_93px_91px_121px_100px] lg:min-w-[900px] lg:grid-cols-[201fr_230fr_242fr_232fr_221fr_223fr]'

// Not in Figma: how many the page lists. The rest are on Transactions.
const RECENT_ROWS = 10

const { cryptoAccounts, failed: accountsFailed, load: loadAccounts } = useAccounts()
const { transactions, failed: rowsFailed, load: loadTransactions } = useTransactions()

const state = ref<'loading' | 'failed' | 'ready'>('loading')

async function read() {
  state.value = 'loading'
  try {
    await loadAccounts()
  } catch {
    state.value = 'failed'
    return
  }
  if (accountsFailed.value) {
    state.value = 'failed'
    return
  }
  // Every row of every account: the endpoint has no paging and cannot be asked for one type.
  await loadTransactions(cryptoAccounts.value)
  state.value = rowsFailed.value ? 'failed' : 'ready'
}

onMounted(read)

// Every account's withdrawals, newest first: sent, failed, and those whose outcome is not known.
const withdrawals = computed(() => {
  const chainOf = new Map(cryptoAccounts.value.map(({ accountNo, chain }) => [accountNo, chain]))
  return transactions.value.flatMap(tx => {
    const kind = activityKind(tx.type)
    if (kind?.label !== 'Withdraw') return []
    const amount = Number(tx.amount)
    return [{
      // Where it was sent.
      wallet:   String(tx.to ?? ''),
      amount:   Number.isFinite(amount) ? coinAmount(amount) : '',
      currency: coinFor(chainOf.get(tx.accountNo) ?? String(tx.currency ?? '')).symbol,
      status:   kind.status,
      date:     dateTime(tx.createdAt),
      // Only a withdrawal that was broadcast has one.
      hash:     tx.txId ?? '',
    }]
  })
})
const rows = computed(() => state.value === 'ready' ? withdrawals.value.slice(0, RECENT_ROWS) : [])

// Not in Figma: the copy icon turns teal (in light, the text colour) for two seconds once the hash is on the clipboard.
const copied = ref(-1)

async function copyHash(index: number, hash: string) {
  try {
    await navigator.clipboard.writeText(hash)
  } catch {
    return
  }
  copied.value = index
  setTimeout(() => { if (copied.value === index) copied.value = -1 }, 2000)
}

// The chips are narrower on mobile, so an address and a hash are cut shorter there.
const cell = 'text-[12px] font-semibold lg:text-[16px] lg:font-medium'
const chip = 'flex h-[28px] items-center rounded-[10px] border border-line text-[12px] font-semibold light:border-muted light:text-muted lg:h-[29px] lg:font-medium'
</script>

<template>
  <DataTable
    title="Recent Withdrawals"
    :columns="columns"
    :rows="rows"
    :grid="grid"
    class="table-tall mt-[20px] lg:mt-[15px]"
  >
    <template #default="{ row, index }">
      <span role="cell" :class="cell">{{ index + 1 }}</span>
      <span role="cell">
        <span v-if="row.wallet" :title="row.wallet" class="w-[72px] px-[3.5px] lg:w-[104px] lg:justify-center" :class="chip">
          <span class="truncate"><span class="lg:hidden">{{ shorten(row.wallet, 3, 3) }}</span><span class="max-lg:hidden">{{ shorten(row.wallet) }}</span></span>
        </span>
      </span>
      <span role="cell" class="lg:-mt-[3px]" :class="cell">{{ row.amount }} <span class="text-accent">{{ row.currency }}</span></span>
      <span role="cell"><StatusPill :status="row.status" /></span>
      <span role="cell" class="text-[12px] font-semibold lg:pl-[2.5px] lg:text-[14px] lg:font-medium">{{ row.date }}</span>
      <span role="cell">
        <button v-if="row.hash" type="button" :title="row.hash" :aria-label="copied === index ? 'Transaction hash copied' : 'Copy transaction hash'" class="w-[100px] justify-between pl-[9px] pr-[7px] [--icon-scale:0.667] lg:w-[120px] lg:pl-[13.5px] lg:pr-[8.5px]" :class="chip" @click="copyHash(index, row.hash)">
          <span class="min-w-0 truncate"><span class="lg:hidden">{{ shorten(row.hash, 4, 4) }}</span><span class="max-lg:hidden">{{ shorten(row.hash, 5, 4) }}</span></span>
          <AppIcon name="copy-light" :class="copied === index ? 'text-accent light:text-ink' : 'text-faint'" />
        </button>
        <!-- Not in Figma: a withdrawal that failed, or whose outcome is not known, has no hash. -->
        <span v-else class="pl-[9px] text-muted lg:pl-[13.5px]" :class="cell">—</span>
      </span>
    </template>

    <!-- Not in Figma: the link to the rest, drawn like the Dashboard's, and the three states. -->
    <template v-if="withdrawals.length > rows.length && rows.length" #tools>
      <RouterLink :to="{ name: 'transactions', query: { type: 'Withdraw', range: 'all' } }" class="block text-[12px] leading-none font-medium text-muted max-lg:mt-[5px] lg:mt-[6px] lg:text-[14px]">View All</RouterLink>
    </template>
    <template #after>
      <ListState v-if="state === 'loading'" kind="loading" title="Loading your withdrawals…" />
      <ListState v-else-if="state === 'failed'" kind="error" title="Your withdrawals could not be loaded" text="Try again in a moment.">
        <button type="button" class="button-outline h-[40px] rounded-[5px] px-[24px] text-[12px] font-semibold lg:text-[14px]" @click="read">Try again</button>
      </ListState>
      <ListState v-else-if="!withdrawals.length" title="No withdrawals yet" text="A withdrawal shows here once it is sent." />
    </template>
  </DataTable>
</template>
