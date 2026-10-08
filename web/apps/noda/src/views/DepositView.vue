<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useAccounts } from '@loudibly/core/composables/useAccounts'
import { usePrices } from '@loudibly/core/composables/usePrices'
import { useTransactions, type AccountTransaction } from '@loudibly/core/composables/useTransactions'
import AppIcon from '../components/AppIcon.vue'
import QrCode from '../components/QrCode.vue'
import DataTable from '../components/DataTable.vue'
import DropdownList from '../components/DropdownList.vue'
import ListState from '../components/ListState.vue'
import StatusPill from '../components/StatusPill.vue'
import { accountChoices } from '../accountChoices'
import { activityKind } from '../activity'
import { coinFor } from '../coins'
import { BLANK, coinAmount, priced, timeAgo, usdValue } from '../format'
import type { IconName } from '../icons'
import { rules } from '../placeholders/deposit'
import { useReread } from '../reread'

// Only the Crypto method is drawn, so the other two cannot be chosen yet.
const methods: { title: string; note: string; icon: IconName; mobileIcon: IconName; selected?: boolean }[] = [
  { title: 'Crypto',            note: 'instant deposit',   icon: 'wallet', mobileIcon: 'wallet-sm', selected: true },
  { title: 'Credit/Debit card', note: '2-3% fee',          icon: 'card',   mobileIcon: 'card-sm' },
  { title: 'Bank Transfer',     note: '1-3 business days', icon: 'bank',   mobileIcon: 'bank-sm' },
]

const columns = ['Currency', 'Amount', 'USD Value', 'Status', 'Time']
// The Time column is not drawn on mobile; its width there is not from the design.
const grid = 'grid-cols-[87px_80px_93px_91px_90px] lg:min-w-[880px] lg:grid-cols-[306fr_298fr_314fr_288fr_143fr]'

// As many rows as the design draws.
const RECENT_ROWS = 4

const { cryptoAccounts, failed: accountsFailed, load: loadAccounts, refresh: rereadAccounts } = useAccounts()
const { prices, load: loadPrices } = usePrices()
const { transactions, failed: rowsFailed, load: loadTransactions } = useTransactions()

type ReadState = 'loading' | 'failed' | 'ready'
const state = ref<ReadState>('loading')          // the accounts
const depositsState = ref<ReadState>('loading')  // their rows

// The rows of the last complete read, and the balances it was made with.
const listed = shallowRef<AccountTransaction[]>([])
let readWith = ''
const balances = () => cryptoAccounts.value.map(account => `${account.accountNo}:${account.balance}`).join()

async function readDeposits() {
  const reading = balances()
  loadPrices(cryptoAccounts.value.map(account => account.chain))
  // Every row of every account: the endpoint has no paging and cannot be asked for one type.
  await loadTransactions(cryptoAccounts.value)
  if (rowsFailed.value) return false
  listed.value = transactions.value
  readWith = reading
  return true
}

async function read() {
  state.value = depositsState.value = 'loading'
  try {
    await loadAccounts()
  } catch {
    state.value = depositsState.value = 'failed'
    return
  }
  if (accountsFailed.value) {
    state.value = depositsState.value = 'failed'
    return
  }
  state.value = 'ready'
  depositsState.value = await readDeposits() ? 'ready' : 'failed'
}

// The page asks again while it is in view. One request, for the balances: a deposit's row is written
// before its balance moves, so the rows are read again only when a balance did. A read that fails
// leaves the screen as it is.
let rereading = false

async function reread() {
  if (rereading || state.value !== 'ready') return
  rereading = true
  await rereadAccounts().catch(() => {})
  if (balances() !== readWith && await readDeposits()) depositsState.value = 'ready'
  rereading = false
}

onMounted(read)
useReread(reread)

// The dropdown lists accounts, where the design lists currencies.
const options = computed(() => accountChoices(cryptoAccounts.value))

// The first account that can receive until another is picked, and again if the picked one is gone.
const picked = ref('')
const account = computed(() =>
  options.value.find(option => option.value === picked.value) ?? options.value.find(option => option.address) ?? options.value[0])
const chosen = computed({
  get: () => account.value?.value ?? '',
  set: (value) => { picked.value = value },
})
const open = ref(false)

// While the accounts are read the form is drawn with nothing in it, so the page does not jump.
// The first line is a rule the backend keeps: another coin sent to the address is not credited.
const notes = computed(() => {
  if (!account.value) return [BLANK, BLANK, BLANK]
  const { symbol } = account.value
  return [`Send only ${symbol} to this address`, `Minimum deposit: ${rules.minimum} ${symbol}`, rules.confirmations].map(note => `– ${note}`)
})

// Not in Figma: the copy icon turns teal for two seconds once the address is on the clipboard.
const copied = ref(false)
watch(chosen, () => { copied.value = false })

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(account.value.address)
  } catch {
    return
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

// Every account's deposits, newest first.
const deposits = computed(() => {
  const chainOf = new Map(cryptoAccounts.value.map(({ accountNo, chain }) => [accountNo, chain]))
  return listed.value.flatMap(tx => {
    const kind = activityKind(tx.type)
    // What came in from outside. A transfer from another user is on the Transactions page only.
    if (kind?.label !== 'Deposit') return []
    const chain = chainOf.get(tx.accountNo) ?? String(tx.currency ?? '')
    const amount = Number(tx.amount)
    const known = Number.isFinite(amount)
    return [{
      currency: coinFor(chain).symbol,
      amount:   known ? coinAmount(amount) : '',
      // At today's price: the price at the time is not kept anywhere.
      usd:      known ? priced(usdValue(amount, prices.value[chain])) : '',
      status:   kind.status,
      time:     timeAgo(tx.createdAt),
    }]
  })
})
const rows = computed(() => depositsState.value === 'ready' ? deposits.value.slice(0, RECENT_ROWS) : [])

const card = 'rounded-[10px] border border-line bg-[#02040E]'
const heading = 'text-[18px] leading-none font-medium lg:font-semibold'
const label = 'text-[12px] leading-none font-semibold text-muted lg:text-[14px]'
const cell = 'text-[12px] font-semibold lg:text-[16px] lg:font-medium'
const tryAgain = 'button-outline h-[40px] rounded-[5px] px-[24px] text-[12px] font-semibold lg:text-[14px]'
</script>

<template>
  <div class="mt-[9px] lg:-mr-px lg:mt-[16px] lg:grid lg:grid-cols-[450px_1fr] lg:gap-[15px]">
    <!-- A card on desktop; on mobile the three tiles stand alone. The space under the tiles shows
         only when the other card is the shorter one, which the design does not draw. -->
    <section class="lg:rounded-[10px] lg:border lg:border-line lg:bg-[#02040E] lg:px-[29px] lg:pb-[29px] lg:pt-[28.5px]">
      <h2 class="max-lg:hidden" :class="heading">Deposit Method</h2>
      <div class="space-y-[15px] lg:mt-[25.5px]">
        <button
          v-for="method in methods"
          :key="method.title"
          type="button"
          :aria-pressed="!!method.selected"
          :disabled="!method.selected"
          class="flex h-[65px] w-full items-center rounded-[10px] border pl-[11px] text-left lg:h-[91px] lg:pl-[17px]"
          :class="method.selected ? 'tile-selected' : 'border-card-line bg-card'"
        >
          <span
            class="grid size-[40px] shrink-0 place-items-center rounded-full lg:size-[53px]"
            :class="method.selected ? 'bg-linear-90 from-[#42E0E6] to-[#0E2951] text-white' : 'bg-card-line text-muted'"
          >
            <AppIcon :name="method.icon" :mobile="method.mobileIcon" />
          </span>
          <span class="ml-[15px] mt-[1.5px] lg:-mt-[2px] lg:ml-[12px]">
            <span class="block text-[16px] leading-none font-medium lg:text-[18px] lg:font-semibold">{{ method.title }}</span>
            <span class="mt-[7px] block text-[12px] leading-none font-semibold text-muted lg:mt-[5px] lg:text-[14px]">{{ method.note }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="mt-[30px] px-[14px] pb-[30.5px] pt-[24.5px] lg:mt-0 lg:px-[29px] lg:pb-[45.5px] lg:pt-[28.5px]" :class="card">
      <h2 :class="heading">Crypto Deposit</h2>

      <!-- Not in Figma: these two states, and the box for an account with no address. -->
      <ListState v-if="state === 'failed'" kind="error" title="Your accounts could not be loaded" text="Try again in a moment.">
        <button type="button" :class="tryAgain" @click="read">Try again</button>
      </ListState>
      <ListState v-else-if="state === 'ready' && !account" title="No accounts yet" text="Open an account to get an address you can receive crypto at.">
        <RouterLink :to="{ name: 'accounts' }" class="bg-cta grid h-[32px] place-items-center rounded-[7.5px] px-[16px] text-[10px] font-semibold lg:h-[40px] lg:rounded-[10px] lg:px-[20px] lg:text-[14px] lg:font-medium">Go to Accounts</RouterLink>
      </ListState>

      <template v-else>
        <p class="mt-[27px] lg:mt-[26px]" :class="label">Select Currency</p>
        <div class="relative mt-[11.5px] lg:mt-[13.5px]" @keydown.esc="open = false">
          <button
            type="button"
            aria-haspopup="listbox"
            :aria-expanded="open"
            :disabled="!account"
            class="flex h-[35px] w-full items-center justify-between rounded-[5px] border-[0.5px] border-card-line bg-card pl-[9px] pr-[12.5px] text-[12px] font-semibold text-muted lg:pl-[14px] lg:pr-[11.5px] lg:text-[14px]"
            @click="open = !open"
          >
            <span v-if="account" class="mr-[8px] min-w-0 truncate"><span class="text-white">{{ account.title }}</span> · {{ account.name }}</span>
            <!-- Shown after ListState's delay: a read that answers at once never says "loading". -->
            <span v-else class="list-state-loading">Loading your accounts…</span>
            <AppIcon name="caret-sm" />
          </button>
          <DropdownList v-if="open" v-model="chosen" :options="options" @close="open = false">
            <template #default="{ option }">
              <span class="min-w-0 truncate">{{ option.title }}<span class="text-muted"> · {{ option.name }}</span></span>
            </template>
          </DropdownList>
        </div>
        <p class="mt-[10px] tracking-normal lg:mt-[12px]" :class="label">{{ account ? `Network: ${account.network}` : BLANK }}</p>

        <div class="info-box mt-[22px] flex rounded-[5px] pb-[11px] pl-[11px] pt-[16.5px] [--icon-scale:0.78] lg:mt-[27px] lg:pb-[20px] lg:pl-[16.5px] lg:pt-[23px] lg:[--icon-scale:1]">
          <AppIcon name="info" class="-mt-[0.5px] text-accent lg:-mt-[1.5px]" />
          <div class="ml-[9px] text-[12px] lg:ml-[9.5px] lg:text-[14px]">
            <p class="leading-none font-semibold">important:</p>
            <ul class="mt-[9.5px] leading-[22px] lg:mt-[7.5px] lg:leading-[26px]">
              <li v-for="(note, index) in notes" :key="index">{{ note }}</li>
            </ul>
          </div>
        </div>

        <!-- A heading on desktop, a field label on mobile. -->
        <h2 class="mt-[20.5px] text-[12px] leading-none font-semibold text-muted lg:mt-[24.5px] lg:text-[18px] lg:text-white">Deposit Address</h2>
        <div v-if="account && !account.address" role="alert" class="mt-[11.5px] flex rounded-[10px] border-[0.5px] border-yellow bg-warn px-[11px] py-[13px] text-yellow [--icon-scale:0.78] lg:mt-[20.5px] lg:border lg:px-[17px] lg:py-[16px] lg:[--icon-scale:1]">
          <AppIcon name="info" />
          <p class="ml-[9px] text-[12px] leading-[14px] lg:ml-[9.5px] lg:text-[14px] lg:leading-[18px]">This account has no deposit address yet.</p>
        </div>
        <template v-else>
          <div class="mt-[11.5px] flex gap-[10px] lg:mt-[20.5px]">
            <p class="flex h-[35px] min-w-0 flex-1 items-center rounded-[5px] border-[0.5px] border-card-line bg-card pl-[10px] pr-[8px] text-[12px] font-semibold lg:h-[40px] lg:pl-[15px] lg:text-[14px]">
              <span class="truncate tracking-[0.004em]">{{ account?.address }}</span>
            </p>
            <button
              type="button"
              :aria-label="copied ? 'Address copied' : 'Copy address'"
              :disabled="!account"
              class="bg-copy grid size-[35px] place-items-center rounded-[5px] lg:size-[40px]"
              :class="{ 'text-accent': copied }"
              @click="copyAddress"
            >
              <AppIcon name="copy-light" mobile="copy-light-sm" />
            </button>
          </div>

          <div class="mx-auto mt-[22px] h-[137px] w-[136px] rounded-[5px] bg-white p-[7.5px] lg:mt-[38px] lg:h-[210px] lg:w-[209px] lg:rounded-[8px] lg:p-[12.5px]">
            <QrCode v-if="account" :value="account.address" class="block w-full" />
          </div>
          <p class="mt-[12px] text-center text-[12px] leading-none font-semibold lg:mt-[16.5px] lg:text-[14px]">Scan QR code</p>
        </template>
      </template>
    </section>
  </div>

  <DataTable
    title="Recent Deposits"
    :columns="columns"
    :rows="rows"
    :grid="grid"
    class="mt-[30px] lg:-mb-[2px] lg:mt-[20px] lg:[--table-foot:25px] lg:[--table-head-gap:49px]"
  >
    <template #default="{ row }">
      <span role="cell" :class="cell">{{ row.currency }}</span>
      <span role="cell" :class="cell">{{ row.amount }}</span>
      <span role="cell" :class="cell">{{ row.usd }}</span>
      <span role="cell"><StatusPill :status="row.status" /></span>
      <span role="cell" :class="cell">{{ row.time }}</span>
    </template>

    <!-- Not in Figma: the link to the rest, drawn like the Dashboard's, and the three states. -->
    <template v-if="depositsState === 'ready' && deposits.length > RECENT_ROWS" #tools>
      <RouterLink :to="{ name: 'transactions', query: { type: 'Deposit', range: 'all' } }" class="block text-[12px] leading-none font-medium text-muted max-lg:mt-[5px] lg:mt-[3px] lg:text-[14px]">View All</RouterLink>
    </template>
    <template #after>
      <ListState v-if="depositsState === 'loading'" kind="loading" title="Loading your deposits…" />
      <ListState v-else-if="depositsState === 'failed'" kind="error" title="Your deposits could not be loaded" text="Try again in a moment.">
        <button type="button" :class="tryAgain" @click="read">Try again</button>
      </ListState>
      <ListState v-else-if="!deposits.length" title="No deposits yet" text="A deposit shows here once it is credited to your account." />
    </template>
  </DataTable>
</template>
