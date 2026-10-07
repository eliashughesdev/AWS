<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAccounts } from '@loudibly/core/composables/useAccounts'
import { useCurrentUser } from '@loudibly/core/composables/useCurrentUser'
import { usePrices } from '@loudibly/core/composables/usePrices'
import PageAction from '../components/PageAction.vue'
import AccountCard from '../components/AccountCard.vue'
import AppDialog from '../components/AppDialog.vue'
import AppIcon from '../components/AppIcon.vue'
import ListState from '../components/ListState.vue'
import { coinFor, newAccountChains } from '../coins'
import { usd } from '../format'
import { placeholderName } from '../placeholders/accountNames'

const router = useRouter()
const { cryptoAccounts, failed, load, refresh, create } = useAccounts()
const { prices, load: loadPrices } = usePrices()
const { userEmail, displayName, load: loadUser } = useCurrentUser()

const state = ref<'loading' | 'failed' | 'ready'>('loading')

const readPrices = () => loadPrices(cryptoAccounts.value.map(account => account.chain))

async function read() {
  state.value = 'loading'
  try {
    await load()
  } catch {
    state.value = 'failed'
    return
  }
  state.value = failed.value ? 'failed' : 'ready'
  readPrices()
}

onMounted(read)

function balanceOf(account: { chain: string; balance: number }) {
  // Nothing is worth nothing at any price.
  if (account.balance === 0) return usd(0)
  const price = prices.value[account.chain]
  // Not read yet: the line stays empty and keeps its height.
  if (price === undefined) return ' '
  return usd(price === null ? null : account.balance * price)
}

const cards = computed(() => cryptoAccounts.value.map(account => ({
  accountNo: account.accountNo,
  name:      placeholderName(account.accountNo),
  status:    account.status,
  balance:   balanceOf(account),
  address:   account.depositAddress,
  // The backend keeps one currency per account.
  holdings:  [coinFor(account.chain).symbol],
})))

// New Account. Not in Figma: the whole dialog, put together from Deposit's tiles and Withdraw's
// warning box and button.
const options = newAccountChains.map(chain => ({ chain, ...coinFor(chain) }))
const dialogOpen = ref(false)
const chain = ref(newAccountChains[0])
const creating = ref(false)
const problem = ref('')

const problems = {
  unavailable: (symbol: string) => `${symbol} accounts are not available yet.`,
  refused: 'The account could not be created. Try again later.',
  unsure: 'We could not confirm that the account was created. If it is not in the list, try again.',
}

function openDialog() {
  chain.value = newAccountChains[0]
  problem.value = ''
  dialogOpen.value = true
}

async function requestAccount(): Promise<'created' | keyof typeof problems> {
  try {
    // The backend takes this name for the person's profile, when they have none yet.
    const { ok, status, data } = await create({ chain: chain.value, accountName: displayName.value, email: userEmail.value })
    if (ok && data.success) return 'created'
    // The merchant has no master for this token.
    if (data.error_code === 100050) return 'unavailable'
    return status >= 500 ? 'unsure' : 'refused'
  } catch {
    return 'unsure'
  }
}

async function createAccount() {
  creating.value = true
  problem.value = ''
  if (!userEmail.value && !(await loadUser())) {
    router.push({ name: 'auth' })
    return
  }

  const outcome = await requestAccount()
  // An answer that never arrived does not mean the account was not created.
  if (outcome === 'created' || outcome === 'unsure') {
    await refresh().catch(() => {})
    readPrices()
  }
  creating.value = false

  if (outcome === 'created') dialogOpen.value = false
  else if (outcome === 'unavailable') problem.value = problems.unavailable(coinFor(chain.value).symbol)
  else problem.value = problems[outcome]
}

const frame = 'bg-account mt-[20px] rounded-[10px] border border-card-line lg:-ml-px lg:-mr-[2px] lg:mt-[24px]'
const newAccount = 'bg-cta h-[32px] w-[100px] rounded-[7.5px] text-[10px] font-semibold lg:h-[40px] lg:w-[128px] lg:rounded-[10px] lg:text-[14px] lg:font-medium'
const dialogButton = 'h-[45px] rounded-[5px] text-[12px] font-semibold disabled:opacity-60 lg:h-[50px] lg:text-[16px] lg:font-medium'
</script>

<template>
  <PageAction>
    <button type="button" class="mt-[13px] lg:mt-0" :class="newAccount" @click="openDialog">+ New Account</button>
  </PageAction>

  <!-- Not in Figma: the three states below. -->
  <ListState v-if="state === 'loading'" kind="loading" title="Loading your accounts…" />

  <div v-else-if="state === 'failed'" :class="frame">
    <ListState kind="error" title="Your accounts could not be loaded" text="Try again in a moment.">
      <button type="button" class="button-outline h-[40px] rounded-[5px] px-[24px] text-[12px] font-semibold lg:text-[14px]" @click="read">Try again</button>
    </ListState>
  </div>

  <div v-else-if="!cards.length" :class="frame">
    <ListState title="No accounts yet" text="Create an account to get an address you can receive crypto at.">
      <button type="button" :class="newAccount" @click="openDialog">+ New Account</button>
    </ListState>
  </div>

  <div v-else class="mt-[20px] grid grid-cols-1 gap-[15px] sm:grid-cols-2 lg:-ml-px lg:-mr-[2px] lg:mb-[67px] lg:mt-[24px] lg:grid-cols-3">
    <AccountCard
      v-for="card in cards"
      :key="card.accountNo"
      :name="card.name"
      :status="card.status"
      :balance="card.balance"
      :address="card.address"
      :holdings="card.holdings"
    />
  </div>

  <AppDialog v-if="dialogOpen" title="New Account" :locked="creating" @close="dialogOpen = false">
    <form @submit.prevent="createAccount">
      <p class="text-[12px] leading-none font-semibold text-muted lg:text-[14px]">Select Currency</p>
      <div class="mt-[16.5px] space-y-[15px] lg:mt-[20px]">
        <button
          v-for="option in options"
          :key="option.chain"
          type="button"
          :aria-pressed="option.chain === chain"
          :disabled="creating"
          class="flex h-[65px] w-full items-center rounded-[10px] border pl-[11px] text-left lg:h-[91px] lg:pl-[17px]"
          :class="option.chain === chain ? 'tile-selected' : 'border-card-line bg-card'"
          @click="chain = option.chain"
        >
          <img :src="option.image" alt="" class="size-[40px] shrink-0 lg:size-[53px]" />
          <span class="ml-[15px] mt-[1.5px] lg:-mt-[2px] lg:ml-[12px]">
            <span class="block text-[16px] leading-none font-medium lg:text-[18px] lg:font-semibold">{{ option.symbol }}</span>
            <span class="mt-[7px] block text-[12px] leading-none font-semibold text-muted lg:mt-[5px] lg:text-[14px]">{{ option.network ? `${option.name}, on ${option.network}` : option.name }}</span>
          </span>
        </button>
      </div>

      <div v-if="problem" role="alert" class="mt-[15px] flex rounded-[10px] border-[0.5px] border-yellow bg-warn px-[11px] py-[13px] text-yellow [--icon-scale:0.78] lg:mt-[20px] lg:border lg:px-[17px] lg:py-[16px] lg:[--icon-scale:1]">
        <AppIcon name="info" />
        <p class="ml-[9px] text-[12px] leading-[14px] lg:ml-[9.5px] lg:text-[14px] lg:leading-[18px]">{{ problem }}</p>
      </div>

      <div class="mt-[20px] grid grid-cols-2 gap-[15px] lg:mt-[28.5px]">
        <button type="button" class="button-outline" :class="dialogButton" :disabled="creating" @click="dialogOpen = false">Cancel</button>
        <button type="submit" class="bg-cta border-[0.5px] border-card-line" :class="dialogButton" :disabled="creating">{{ creating ? 'Creating…' : 'Create account' }}</button>
      </div>
    </form>
  </AppDialog>
</template>
