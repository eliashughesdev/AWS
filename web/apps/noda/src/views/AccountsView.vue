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
import CoinImage from '../components/CoinImage.vue'
import ListState from '../components/ListState.vue'
import { coinFor, newAccountChains } from '../coins'
import { accountLabel, priced, typedName, usdValue } from '../format'

const router = useRouter()
const { cryptoAccounts, failed, load, refresh, create, rename } = useAccounts()
const { prices, load: loadPrices } = usePrices()
const { userEmail, load: loadUser } = useCurrentUser()

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

const cards = computed(() => cryptoAccounts.value.map(account => ({
  accountNo: account.accountNo,
  name:      accountLabel(account),
  typed:     typedName(account),
  status:    account.status,
  balance:   priced(usdValue(account.balance, prices.value[account.chain])),
  address:   account.depositAddress,
  // The backend keeps one currency per account.
  holdings:  [coinFor(account.chain).symbol],
})))

// New Account. Not in Figma: the whole dialog, put together from Deposit's tiles and Withdraw's
// field, warning box and button. Light draws a chosen tile like the others, so here it keeps its border.
const options = newAccountChains.map(chain => ({ chain, ...coinFor(chain) }))
const dialogOpen = ref(false)
const chain = ref(newAccountChains[0])
const accountName = ref('')
const creating = ref(false)
const problem = ref('')

const problems = {
  unavailable: (symbol: string) => `${symbol} accounts are not available yet.`,
  refused: 'The account could not be created. Try again later.',
  unsure: 'We could not confirm that the account was created. If it is not in the list, try again.',
}

function openDialog() {
  chain.value = newAccountChains[0]
  accountName.value = ''
  problem.value = ''
  dialogOpen.value = true
}

async function requestAccount(): Promise<'created' | keyof typeof problems> {
  try {
    // Without a name the backend names the account by its number.
    const { ok, status, data } = await create({ chain: chain.value, accountName: accountName.value.trim() || undefined, email: userEmail.value })
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

// Rename. Not in Figma: the pencil on a card and this dialog.
const renaming = ref('')
const newName = ref('')
const saving = ref(false)
const renameProblem = ref('')

function openRename(card: { accountNo: string; typed: string }) {
  newName.value = card.typed
  renameProblem.value = ''
  renaming.value = card.accountNo
}

async function saveName() {
  saving.value = true
  renameProblem.value = ''
  // Sending it again does no harm, so every failure is the same to the user.
  const result = await rename(renaming.value, newName.value.trim()).catch(() => null)
  const saved = !!result?.ok && !!result.data.success
  if (saved) await refresh().catch(() => {})
  saving.value = false

  if (saved) renaming.value = ''
  else renameProblem.value = 'The name could not be saved. Try again.'
}

const frame = 'card bg-account mt-[20px] rounded-[10px] lg:-ml-px lg:-mr-[2px] lg:mt-[24px]'
const newAccount = 'bg-cta h-[32px] w-[100px] rounded-[7.5px] text-[10px] font-semibold text-white lg:h-[40px] lg:w-[128px] lg:rounded-[10px] lg:text-[14px] lg:font-medium'
const dialogButton = 'h-[45px] rounded-[5px] text-[12px] font-semibold disabled:opacity-60 lg:h-[50px] lg:text-[16px] lg:font-medium'
const label = 'text-[12px] leading-none font-semibold text-muted lg:text-[14px]'
// A hint stays grey in light too: in ink it would read as a name already typed.
// Not in Figma: the box shows the focus. The browser's ring around the bare <input> covers the caret.
const input = 'mt-[16.5px] flex h-[35px] items-center rounded-[5px] border-[0.5px] border-card-line bg-field px-[9px] text-[12px] font-medium focus-within:border-accent light:shadow-(--shadow-card) lg:mt-[20px] lg:h-[50px] lg:px-[17px] lg:text-[14px]'
const field = 'min-w-0 flex-1 bg-transparent text-ink text-ellipsis outline-none placeholder:text-muted'
const warning = 'mt-[15px] flex rounded-[10px] border-[0.5px] border-yellow bg-warn px-[11px] py-[13px] text-warn-ink [--icon-scale:0.78] lg:mt-[20px] lg:border lg:px-[17px] lg:py-[16px] lg:[--icon-scale:1]'
const warningText = 'ml-[9px] text-[12px] leading-[14px] lg:ml-[9.5px] lg:text-[14px] lg:leading-[18px]'
const dialogButtons = 'mt-[20px] grid grid-cols-2 gap-[15px] lg:mt-[28.5px]'
const mainButton = 'bg-cta border-[0.5px] border-card-line text-white light:border-0'
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
      @rename="openRename(card)"
    />
  </div>

  <AppDialog v-if="dialogOpen" title="New Account" :locked="creating" @close="dialogOpen = false">
    <form @submit.prevent="createAccount">
      <p :class="label">Select Currency</p>
      <div class="mt-[16.5px] space-y-[15px] lg:mt-[20px]">
        <button
          v-for="option in options"
          :key="option.chain"
          type="button"
          :aria-pressed="option.chain === chain"
          :disabled="creating"
          class="flex h-[65px] w-full items-center rounded-[10px] border pl-[11px] text-left lg:h-[91px] lg:pl-[17px]"
          :class="option.chain === chain ? 'tile-selected light:border-accent!' : 'card'"
          @click="chain = option.chain"
        >
          <CoinImage v-if="option.image" :coin="option.image" class="size-[40px] lg:size-[53px]" />
          <span class="ml-[15px] mt-[1.5px] lg:-mt-[2px] lg:ml-[12px]">
            <span class="block text-[16px] leading-none font-medium lg:text-[18px] lg:font-semibold">{{ option.symbol }}</span>
            <span class="mt-[7px] block text-[12px] leading-none font-semibold text-muted lg:mt-[5px] lg:text-[14px]">{{ option.network ? `${option.name}, on ${option.network}` : option.name }}</span>
          </span>
        </button>
      </div>

      <p class="mt-[20px] lg:mt-[28.5px]" :class="label">Account Name</p>
      <label :class="input">
        <input v-model="accountName" type="text" maxlength="40" autocomplete="off" placeholder="Leave empty to use the account number" aria-label="Account name" :disabled="creating" :class="field" />
      </label>

      <div v-if="problem" role="alert" :class="warning">
        <AppIcon name="info" />
        <p :class="warningText">{{ problem }}</p>
      </div>

      <div :class="dialogButtons">
        <button type="button" class="button-outline" :class="dialogButton" :disabled="creating" @click="dialogOpen = false">Cancel</button>
        <button type="submit" :class="[mainButton, dialogButton]" :disabled="creating">{{ creating ? 'Creating…' : 'Create account' }}</button>
      </div>
    </form>
  </AppDialog>

  <AppDialog v-if="renaming" title="Rename Account" :locked="saving" @close="renaming = ''">
    <form @submit.prevent="saveName">
      <p :class="label">Account Name</p>
      <label :class="input">
        <!-- At 10px the whole number fits a 320px screen. -->
        <input v-model="newName" type="text" maxlength="40" autocomplete="off" :placeholder="renaming" aria-label="Account name" :disabled="saving" class="max-lg:placeholder:text-[10px]" :class="field" />
      </label>
      <p class="mt-[10.5px] text-[10px] leading-none font-medium text-muted lg:mt-[14.5px] lg:text-[14px]">Leave empty to use the account number.</p>

      <div v-if="renameProblem" role="alert" :class="warning">
        <AppIcon name="info" />
        <p :class="warningText">{{ renameProblem }}</p>
      </div>

      <div :class="dialogButtons">
        <button type="button" class="button-outline" :class="dialogButton" :disabled="saving" @click="renaming = ''">Cancel</button>
        <button type="submit" :class="[mainButton, dialogButton]" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </form>
  </AppDialog>
</template>
