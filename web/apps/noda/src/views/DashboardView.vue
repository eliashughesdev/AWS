<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAccounts } from '@loudibly/core/composables/useAccounts'
import { useKyc } from '@loudibly/core/composables/useKyc'
import { usePrices } from '@loudibly/core/composables/usePrices'
import { useTransactions } from '@loudibly/core/composables/useTransactions'
import PortfolioCard from '../components/PortfolioCard.vue'
import SecurityCard from '../components/SecurityCard.vue'
import AchievementsCard, { type KycRow } from '../components/AchievementsCard.vue'
import AssetRow from '../components/AssetRow.vue'
import StatCard from '../components/StatCard.vue'
import ActivityItem from '../components/ActivityItem.vue'
import ListState from '../components/ListState.vue'
import { activityKinds } from '../activity'
import { coinFor } from '../coins'
import { BLANK, coinAmount, priced, timeAgo, usdSum, usdValue, type UsdValue } from '../format'
import type { IconName } from '../icons'
import type { Tone } from '../tones'
import { changes, stats } from '../placeholders/dashboard'

const ACTIVITY_ROWS = 3
const PRICE_WAIT_MS = 3000

const { cryptoAccounts, failed: accountsFailed, load: loadAccounts } = useAccounts()
const { prices, load: loadPrices } = usePrices()
const { transactions, failed: activityFailed, load: loadTransactions } = useTransactions()
const { status: kycStatus, failed: kycFailed, load: loadKyc, start: startKyc } = useKyc()

const state = ref<'loading' | 'failed' | 'ready'>('loading')
const activityRead = ref(false)
const refreshing = ref(false)

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function readAccounts() {
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
  const pricesRead = loadPrices(cryptoAccounts.value.map(account => account.chain))
  // Every row, not the newest three: the rows that are not listed are dropped afterwards.
  const activityDone = loadTransactions(cryptoAccounts.value).then(() => { activityRead.value = true })
  // The rows are ordered by value, so they come with their prices, unless those take too long.
  await Promise.race([pricesRead, wait(PRICE_WAIT_MS)])
  state.value = 'ready'
  await Promise.all([pricesRead, activityDone])
}

const read = () => Promise.all([readAccounts(), readKyc()])

function retry() {
  state.value = 'loading'
  activityRead.value = false
  read()
}

// What is on screen stays there until the new read answers.
async function refresh() {
  refreshing.value = true
  // Long enough to see that the click did something.
  await Promise.all([read(), wait(600)])
  refreshing.value = false
}

const valueOf = (amount: number, chain: string) => usdValue(amount, prices.value[chain])

// One per currency: two accounts in the same one are added up.
const holdings = computed(() => {
  const amounts = new Map<string, number>()
  for (const { chain, balance } of cryptoAccounts.value) amounts.set(chain, (amounts.get(chain) ?? 0) + balance)
  return [...amounts].map(([chain, amount]) => ({ chain, amount, value: valueOf(amount, chain) }))
})

// The sum of the rows under it, so unknown as soon as one of them cannot be priced.
const total = computed<UsdValue>(() => {
  if (state.value === 'loading') return undefined
  if (state.value === 'failed') return null
  return usdSum(holdings.value.map(holding => holding.value))
})

function shareOf(value: UsdValue, sum: UsdValue): UsdValue {
  if (typeof value === 'number' && typeof sum === 'number') return sum === 0 ? 0 : value / sum * 100
  // A share of an unknown total is unknown too.
  return sum === undefined ? undefined : null
}

const assets = computed(() => holdings.value
  .map(({ chain, amount, value }) => {
    const coin = coinFor(chain)
    const share = shareOf(value, total.value)
    return {
      chain,
      worth:  value ?? -1,
      symbol: coin.symbol,
      // A currency the catalogue does not know has its code for a name.
      name:   coin.name === coin.symbol ? '' : coin.name,
      image:  coin.image,
      amount: `${coinAmount(amount)} ${coin.symbol}`,
      value:  priced(value),
      change: changes[coin.symbol],
      share:  share === undefined ? BLANK : share === null ? '—' : `${Math.round(share)}%`,
      fill:   share ?? 0,
    }
  })
  // Largest first; a coin that cannot be priced goes last.
  .sort((a, b) => b.worth - a.worth || a.symbol.localeCompare(b.symbol)))

const assetCount = computed(() => `${assets.value.length} ${assets.value.length === 1 ? 'Asset' : 'Assets'}`)

const activityState = computed(() => {
  if (state.value === 'failed') return 'failed'
  if (state.value === 'loading' || !activityRead.value) return 'loading'
  return activityFailed.value ? 'failed' : 'ready'
})

// A row is drawn by its direction, as the design's Deposit and Withdraw rows are.
type Look = { icon: IconName; mobileIcon?: IconName; tone: Tone }
const incoming: Look = { icon: 'deposit', tone: 'green' }
const outgoing: Look = { icon: 'withdraw', mobileIcon: 'withdraw-sm', tone: 'yellow' }

const activity = computed(() => {
  const chainOf = new Map(cryptoAccounts.value.map(account => [account.accountNo, account.chain]))
  const kindOf = activityKinds(transactions.value)
  return transactions.value
    .flatMap(tx => {
      const kind = kindOf(tx)
      if (!kind) return []
      const chain = chainOf.get(tx.accountNo) ?? String(tx.currency ?? '')
      const amount = Number(tx.amount)
      const known = Number.isFinite(amount)
      return [{
        key:    `${tx.accountNo}:${tx.type}:${tx.txId ?? tx.reference ?? tx.createdAt}`,
        kind:   kind.name ?? kind.label,
        asset:  coinFor(chain).symbol,
        amount: known ? `${kind.incoming ? '+' : '-'}${coinAmount(amount)}` : '',
        // At today's price: the price at the time is not kept anywhere.
        usd:    known ? priced(valueOf(amount, chain)) : '',
        time:   timeAgo(tx.createdAt),
        status: kind.status,
        look:   kind.incoming ? incoming : outgoing,
      }]
    })
    .slice(0, ACTIVITY_ROWS)
})

// KYC. Opening a session resets the stored status, so the row offers it only when the status is known.
const kycKnown = ref(false)
const kycStart = ref<'idle' | 'starting' | 'failed'>('idle')

async function readKyc() {
  try {
    await loadKyc()
    kycKnown.value = !kycFailed.value
  } catch {
    kycKnown.value = false
  }
}

const kycRow = computed<KycRow>(() => {
  if (kycStart.value === 'starting') return 'starting'
  if (!kycKnown.value || !kycStatus.value) return 'unknown'
  const canStart = kycStatus.value === 'not-started' || kycStatus.value === 'failed'
  return canStart && kycStart.value === 'failed' ? 'start-failed' : kycStatus.value
})

async function verify() {
  kycStart.value = 'starting'
  // When it starts, the browser leaves for Didit's page and the row stays as it is.
  if (!(await startKyc())) kycStart.value = 'failed'
}

// Back from Didit with the browser's back button, the page is shown as it was left.
function onPageShow(event: PageTransitionEvent) {
  if (!event.persisted) return
  kycStart.value = 'idle'
  readKyc()
}

onMounted(() => {
  read()
  window.addEventListener('pageshow', onPageShow)
})
onUnmounted(() => window.removeEventListener('pageshow', onPageShow))

// Not in Figma: the box a list's loading, empty and failed states sit in, drawn like one of its rows.
const box = 'card rounded-[10px]'
const tryAgain = 'button-outline h-[40px] rounded-[5px] px-[24px] text-[12px] font-semibold lg:text-[14px]'
</script>

<template>
  <div class="grid gap-[20px] lg:grid-cols-[1fr_392px] lg:gap-[15px]">
    <PortfolioCard :balance="priced(total)" :refreshing="refreshing" @refresh="refresh" />
    <div class="flex flex-col gap-[15px]">
      <SecurityCard />
      <AchievementsCard class="lg:flex-1" :kyc="kycRow" @verify="verify" />
    </div>
  </div>

  <div class="mt-[29px] flex h-[22px] items-center justify-between lg:mt-[50px] lg:h-[36px]">
    <h2 class="text-[18px] font-medium lg:-mt-[3px] lg:text-[22px] lg:font-semibold">Portfolio Assets</h2>
    <span
      class="bg-pill grid h-[22px] w-[78px] place-items-center rounded-[8px] border-[0.5px] border-accent text-[10px] font-medium lg:h-[36px] lg:w-[128px] lg:text-[14px]"
      :class="{ invisible: state !== 'ready' }"
    >
      {{ assetCount }}
    </span>
  </div>
  <div class="mt-[20px] space-y-[10px] lg:mt-[28px] lg:space-y-[15px]">
    <!-- Not in Figma: the three states below, here and under Recent Activity. -->
    <ListState v-if="state === 'loading'" kind="loading" title="Loading your assets…" />
    <div v-else-if="state === 'failed'" :class="box">
      <ListState kind="error" title="Your assets could not be loaded" text="Try again in a moment.">
        <button type="button" :class="tryAgain" @click="retry">Try again</button>
      </ListState>
    </div>
    <div v-else-if="!assets.length" :class="box">
      <ListState title="No assets yet" text="Open an account to get an address you can receive crypto at.">
        <RouterLink :to="{ name: 'accounts' }" class="bg-cta grid h-[32px] place-items-center rounded-[7.5px] px-[16px] text-[10px] font-semibold text-white lg:h-[40px] lg:rounded-[10px] lg:px-[20px] lg:text-[14px] lg:font-medium">Go to Accounts</RouterLink>
      </ListState>
    </div>
    <template v-else>
      <AssetRow
        v-for="asset in assets"
        :key="asset.chain"
        :symbol="asset.symbol"
        :name="asset.name"
        :image="asset.image"
        :amount="asset.amount"
        :value="asset.value"
        :change="asset.change"
        :share="asset.share"
        :fill="asset.fill"
      />
    </template>
  </div>

  <div class="mt-[26px] grid grid-cols-2 gap-[10px] lg:mt-[30px] lg:grid-cols-4 lg:gap-[15px]">
    <StatCard v-for="stat in stats" :key="stat.label" :stat="stat" />
  </div>

  <section class="mt-[31px] lg:panel lg:mt-[30px] lg:rounded-[10px] lg:px-[28px] lg:pb-[29px] lg:pt-[39px]">
    <div class="flex items-center justify-between">
      <h2 class="text-[18px] leading-none font-medium lg:text-[22px] lg:font-[550]">Recent Activity</h2>
      <RouterLink :to="{ name: 'transactions' }" class="text-[12px] leading-none font-medium text-muted max-lg:mt-[5px] lg:text-[18px]">View All</RouterLink>
    </div>
    <div class="mt-[21px] space-y-[10px] lg:mt-[35px] lg:space-y-[15px]">
      <ListState v-if="activityState === 'loading'" kind="loading" title="Loading your activity…" />
      <div v-else-if="activityState === 'failed'" :class="box">
        <ListState kind="error" title="Your activity could not be loaded" text="Try again in a moment.">
          <button type="button" :class="tryAgain" @click="retry">Try again</button>
        </ListState>
      </div>
      <div v-else-if="!activity.length" :class="box">
        <ListState title="No activity yet" text="Your deposits and withdrawals will show here." />
      </div>
      <template v-else>
        <ActivityItem
          v-for="item in activity"
          :key="item.key"
          :kind="item.kind"
          :asset="item.asset"
          :amount="item.amount"
          :usd="item.usd"
          :time="item.time"
          :status="item.status"
          :icon="item.look.icon"
          :mobile-icon="item.look.mobileIcon"
          :tone="item.look.tone"
        />
      </template>
    </div>
  </section>
</template>
