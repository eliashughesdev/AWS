<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAccounts } from '@loudibly/core/composables/useAccounts'
import { usePrices } from '@loudibly/core/composables/usePrices'
import { useTransactions } from '@loudibly/core/composables/useTransactions'
import AppIcon from '../components/AppIcon.vue'
import SummaryCard from '../components/SummaryCard.vue'
import FilterButton from '../components/FilterButton.vue'
import DataTable from '../components/DataTable.vue'
import ListState from '../components/ListState.vue'
import StatusPill from '../components/StatusPill.vue'
import { activityKinds } from '../activity'
import { coinFor } from '../coins'
import { BLANK, accountLabel, coinAmount, dateTime, priced, shorten, usdSum, usdValue } from '../format'
import { summary } from '../placeholders/transactions'

const columns = ['ID', 'Type', 'Currency', 'Amount', 'From/To', 'Fee', 'Status', 'Date/Time']
// Only the first three columns are drawn on mobile; the widths of the others are not from the design.
// On desktop the columns share the width in the design's proportions, down to a width where they still fit.
const grid = 'grid-cols-[148px_111px_70px_100px_120px_100px_91px_112px] lg:min-w-[1108px] lg:grid-cols-[144fr_163fr_190fr_182fr_184fr_154fr_172fr_160fr]'

// Deposit and Withdraw are drawn. Not in Figma: Transfer, in the colour of the design's Payment
// badge, and Fee, in the palette's brown, which nothing else uses.
const badges: Record<string, string> = {
  Deposit:  'bg-green',
  Withdraw: 'bg-blue',
  Transfer: 'bg-orange',
  Fee:      'bg-brown',
}

const PAGE_ROWS = 50
const DAY_MS = 86_400_000

const { cryptoAccounts, failed: accountsFailed, load: loadAccounts } = useAccounts()
const { prices, load: loadPrices } = usePrices()
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
  loadPrices(cryptoAccounts.value.map(account => account.chain))
  await loadTransactions(cryptoAccounts.value)
  // Missing rows would make the totals wrong, so a list read in part counts as not read.
  state.value = rowsFailed.value ? 'failed' : 'ready'
}

onMounted(read)

const valueOf = (amount: number, chain: string) => usdValue(amount, prices.value[chain])

// Every transaction the page lists, newest first. What activity.ts does not list is left out.
const rows = computed(() => {
  const chainOf = new Map(cryptoAccounts.value.map(account => [account.accountNo, account.chain]))
  // The user's own accounts under their names, by number (a transfer) and by address.
  const names = new Map(cryptoAccounts.value.flatMap((account): [string, string][] => {
    const name = accountLabel(account)
    return [[account.accountNo, name], [account.depositAddress, name]]
  }))
  const party = (value: unknown) => {
    const text = String(value ?? '')
    return text ? names.get(text) ?? shorten(text) : '—'
  }
  // What a withdrawal cost its account: the FEE row of the same chain transaction.
  const feeOf = new Map(transactions.value
    .filter(tx => tx.type === 'FEE')
    .map(tx => [`${tx.accountNo}:${tx.txId}`, Number(tx.amount)]))

  const kindOf = activityKinds(transactions.value)

  return transactions.value.flatMap(tx => {
    const kind = kindOf(tx)
    if (!kind) return []
    const chain = chainOf.get(tx.accountNo) ?? String(tx.currency ?? '')
    const coin = coinFor(chain)
    const amount = Number(tx.amount)
    const known = Number.isFinite(amount)
    // A withdrawal that failed or is uncertain has no chain transaction, only its request's id.
    const id = String(tx.txId ?? tx.reference ?? '')
    // The user's side is the account, whichever address signed (a token leaves from the master's).
    const own = party(tx.accountNo)
    const other = party(kind.incoming ? tx.from : tx.to)
    // A fee listed by itself has its amount in the Amount column.
    const fee = tx.type === 'FEE' ? undefined : feeOf.get(`${tx.accountNo}:${tx.txId}`)
    return [{
      key:      `${tx.accountNo}:${tx.type}:${id || tx.createdAt}`,
      id,
      kind:     kind.label,
      status:   kind.status,
      incoming: kind.incoming,
      currency: coin.symbol,
      amount:   known ? `${kind.incoming ? '+' : '-'}${coinAmount(amount)}` : '',
      // At today's price: the price at the time is not kept anywhere.
      value:    known ? valueOf(amount, chain) : null,
      from:     kind.incoming ? other : own,
      to:       kind.incoming ? own : other,
      // A dash where the account was charged none, or the chain has not reported it yet.
      fee:      Number.isFinite(fee) ? `${coinAmount(fee!)} ${coin.symbol}` : '—',
      date:     dateTime(tx.createdAt),
      at:       new Date(tx.createdAt).getTime(),
      search:   [id, tx.reference, tx.from, tx.to, own, other, coin.symbol, coin.name, kind.label, kind.status].join(' ').toLowerCase(),
    }]
  })
})

// Not in Figma: what each dropdown offers. The first of each is the label the design draws.
const types = [
  { value: 'all', label: 'All Types' },
  ...Object.keys(badges).map(kind => ({ value: kind, label: kind })),
]
const statuses = [
  { value: 'all', label: 'All Status' },
  ...['Completed', 'Pending', 'Failed'].map(name => ({ value: name, label: name })),
]
const ranges = [
  { value: '7',   label: 'Last 7 days' },
  { value: '30',  label: 'Last 30 days' },
  { value: '90',  label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

// A link can open the page on a type and a range: Deposit's "View All" does.
const route = useRoute()
function asked(name: string, options: { value: string }[], otherwise: string) {
  const value = route.query[name]
  return options.some(option => option.value === value) ? String(value) : otherwise
}

const query  = ref('')
const type   = ref(asked('type', types, 'all'))
const status = ref('all')
const range  = ref(asked('range', ranges, '30'))

const rangeLabel = computed(() => ranges.find(option => option.value === range.value)!.label)

// The cards add up the period; the search and the other two filters only narrow the table.
const inRange = computed(() => {
  if (range.value === 'all') return rows.value
  const since = Date.now() - Number(range.value) * DAY_MS
  return rows.value.filter(row => row.at >= since)
})

const matching = computed(() => {
  const text = query.value.trim().toLowerCase()
  return inRange.value.filter(row =>
    (type.value === 'all' || row.kind === type.value) &&
    (status.value === 'all' || row.status === status.value) &&
    row.search.includes(text))
})

function clearFilters() {
  query.value = ''
  type.value = status.value = 'all'
}

const tableState = computed(() => {
  if (state.value !== 'ready') return state.value
  if (!rows.value.length) return 'empty'
  if (!inRange.value.length) return 'none-in-range'
  return matching.value.length ? 'rows' : 'no-match'
})

// Not in Figma: the table grows a page at a time, since the backend sends every row at once.
const shown = ref(PAGE_ROWS)
watch([query, type, status, range], () => { shown.value = PAGE_ROWS })
const visible = computed(() => tableState.value === 'rows' ? matching.value.slice(0, shown.value) : [])

const cards = computed(() => {
  // Only what moved: a failed withdrawal went back, and an uncertain one may not have left.
  const moved = inRange.value.filter(row => row.status === 'Completed')
  const incoming = usdSum(moved.filter(row => row.incoming).map(row => row.value))
  const outgoing = usdSum(moved.filter(row => !row.incoming).map(row => row.value))
  const values = [usdSum([incoming, outgoing]), incoming, outgoing].map(priced)
  values.push(inRange.value.length.toLocaleString('en-US'))
  return summary.map((card, index) => ({
    ...card,
    value: state.value === 'loading' ? BLANK : state.value === 'failed' ? '—' : values[index],
  }))
})

// Not in Figma: a click on an id copies all of it, and its icon turns teal for two seconds.
const copied = ref('')

async function copyId(key: string, id: string) {
  try {
    await navigator.clipboard.writeText(id)
  } catch {
    return
  }
  copied.value = key
  setTimeout(() => { if (copied.value === key) copied.value = '' }, 2000)
}

const action = 'button-outline h-[40px] rounded-[5px] px-[24px] text-[12px] font-semibold lg:text-[14px]'
</script>

<template>
  <div class="mt-[19px] grid grid-cols-1 gap-[15px] sm:grid-cols-2 lg:-mr-px lg:mt-[24px] lg:grid-cols-4">
    <SummaryCard v-for="card in cards" :key="card.label" :item="card" />
  </div>

  <!-- Positioned while a filter is open, so that on mobile its list hangs under the whole block. -->
  <div class="mt-[20px] has-[[aria-expanded=true]]:relative lg:-ml-px lg:mt-[30px] lg:flex lg:gap-[15px]">
    <label class="flex h-[40px] items-center card rounded-[10px] pl-[9px] pr-[10px] text-muted [--icon-scale:0.78] focus-within:border-accent lg:h-[50px] lg:max-w-[684px] lg:flex-1 lg:pl-[14px] lg:[--icon-scale:1]">
      <AppIcon name="search" />
      <input v-model="query" type="search" placeholder="Search payments..." class="ml-[8px] min-w-0 flex-1 bg-transparent text-[12px] font-medium text-ink outline-none placeholder:text-muted lg:ml-[10px] lg:text-[16px]" />
    </label>
    <!-- On mobile the buttons run past the screen's edge and scroll sideways. -->
    <div class="no-scrollbar -mr-[10px] mt-[10px] flex gap-[10px] overflow-x-auto pr-[10px] lg:m-0 lg:gap-[15px] lg:overflow-visible lg:p-0">
      <FilterButton v-model="type" icon="filter" mobile-icon="filter-sm" :options="types" />
      <FilterButton v-model="status" icon="pulse" mobile-icon="pulse-sm" :options="statuses" />
      <FilterButton v-model="range" icon="calendar" mobile-icon="calendar-sm" :options="ranges" />
    </div>
  </div>

  <DataTable
    title="Payment History"
    :columns="columns"
    :rows="visible"
    :grid="grid"
    class="mb-[6px] mt-[15px] lg:-mb-[10px] lg:-ml-px lg:mr-px lg:mt-[30px]"
  >
    <template #default="{ row }">
      <span role="cell">
        <button v-if="row.id" type="button" :title="row.id" class="flex items-center gap-[6px] text-[12px] font-semibold text-muted [--icon-scale:0.667]" @click="copyId(row.key, row.id)">
          <span class="text-ink">{{ shorten(row.id) }}</span>
          <AppIcon name="copy-light" :class="{ 'text-accent light:text-ink': copied === row.key }" />
        </button>
      </span>
      <span role="cell">
        <span class="grid h-[23px] w-[72px] place-items-center rounded-[10px] pb-[2px] text-[10px] leading-none font-semibold text-white" :class="badges[row.kind]">{{ row.kind }}</span>
      </span>
      <span role="cell" class="text-[14px] font-medium">{{ row.currency }}</span>
      <div role="cell">
        <p class="flex items-center gap-px text-[14px] leading-none font-medium" :class="row.incoming ? 'text-accent' : 'text-red'">
          <AppIcon name="arrow-up" class="[--icon-scale:0.8]" :class="{ 'rotate-180': !row.incoming }" />
          {{ row.amount }}
        </p>
        <p class="mt-[3.5px] text-[10px] leading-none font-medium text-muted">{{ priced(row.value) }}</p>
      </div>
      <!-- A long account name is cut to the column: without the containment it would widen the whole table. -->
      <div role="cell" class="min-w-0 contain-inline-size pb-[2px] pl-[2.5px] pr-[8px] text-[12px] leading-[14px] font-semibold">
        <p class="truncate" :title="row.from">{{ row.from }}</p>
        <p class="flex items-center gap-[3px] pl-[2px]"><AppIcon name="arrow-right" /><span class="truncate" :title="row.to">{{ row.to }}</span></p>
      </div>
      <span role="cell" class="text-[14px] font-medium">{{ row.fee }}</span>
      <span role="cell"><StatusPill :status="row.status" /></span>
      <span role="cell" class="text-[14px] font-medium">{{ row.date }}</span>
    </template>

    <!-- Not in Figma: the five states and the button for more rows. -->
    <template #after>
      <ListState v-if="tableState === 'loading'" kind="loading" title="Loading your transactions…" />
      <ListState v-else-if="tableState === 'failed'" kind="error" title="Your transactions could not be loaded" text="Try again in a moment.">
        <button type="button" :class="action" @click="read">Try again</button>
      </ListState>
      <ListState v-else-if="tableState === 'empty'" title="No transactions yet" text="Your deposits and withdrawals will show here." />
      <ListState v-else-if="tableState === 'none-in-range'" :title="`No transactions in the ${rangeLabel.toLowerCase()}`" text="Older ones are still in your history.">
        <button type="button" :class="action" @click="range = 'all'">Show all time</button>
      </ListState>
      <ListState v-else-if="tableState === 'no-match'" title="No transactions match" text="Try another search or filter.">
        <button type="button" :class="action" @click="clearFilters">Clear filters</button>
      </ListState>
      <div v-else-if="matching.length > visible.length" class="mt-[24px] flex justify-center">
        <button type="button" :class="action" @click="shown += PAGE_ROWS">Show more</button>
      </div>
    </template>
  </DataTable>
</template>
