<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAccounts } from '@loudibly/core/composables/useAccounts'
import { useCurrentUser } from '@loudibly/core/composables/useCurrentUser'
import { looksLikeAddress, useWithdraw, withdrawalFeeReserve } from '@loudibly/core/composables/useWithdraw'
import { KYC_REQUIRED, useKyc, verificationNeeded } from '@loudibly/core/composables/useKyc'
import AppDialog from '../components/AppDialog.vue'
import AppIcon from '../components/AppIcon.vue'
import CoinRow from '../components/CoinRow.vue'
import DropdownList from '../components/DropdownList.vue'
import KycNotice from '../components/KycNotice.vue'
import ListState from '../components/ListState.vue'
import { accountChoices } from '../accountChoices'
import { BLANK, coinAmount, shorten } from '../format'
import { fee, limits } from '../placeholders/withdraw'
import { useReread } from '../reread'

const router = useRouter()
const { cryptoAccounts, failed: accountsFailed, load: loadAccounts, refresh } = useAccounts()
const { userId, load: loadUser } = useCurrentUser()

const state = ref<'loading' | 'failed' | 'ready'>('loading')

// Not in Figma: the design's chips choose a currency, and a user can hold two accounts in one. A chip
// per currency held; when the chosen one has several accounts, a dropdown under the chips chooses.
const choices = computed(() => accountChoices(cryptoAccounts.value))
const coins = computed(() => [...new Set(choices.value.map(choice => choice.symbol))])

const pickedCoin = ref('')
const pickedAccount = ref('')
const coin = computed(() => coins.value.includes(pickedCoin.value) ? pickedCoin.value : coins.value[0] ?? '')
const inCoin = computed(() => choices.value.filter(choice => choice.symbol === coin.value))
const account = computed(() => inCoin.value.find(choice => choice.value === pickedAccount.value) ?? inCoin.value[0])
const chosenAccount = computed({
  get: () => account.value?.value ?? '',
  set: (value) => { pickedAccount.value = value },
})
const open = ref(false)

// A currency opens on its account with the most to withdraw. It is picked once, so that a balance
// that moves later does not change the account under the user's hands.
function pick(symbol: string) {
  const accounts = choices.value.filter(choice => choice.symbol === symbol)
  pickedCoin.value = symbol
  pickedAccount.value = accounts.reduce((best, choice) => choice.available > best.available ? choice : best, accounts[0])?.value ?? ''
}

async function read() {
  state.value = 'loading'
  try {
    await loadAccounts()
  } catch {
    state.value = 'failed'
    return
  }
  state.value = accountsFailed.value ? 'failed' : 'ready'
  if (!coins.value.includes(pickedCoin.value)) pick(coins.value[0] ?? '')
}

onMounted(read)

// Whether the user's identity is verified: the chosen account's merchant may want it for
// withdrawals in its currency. Unknown while unread or when the read fails, and then the form
// sends as usual and the API decides.
const { status: kycStatus, failed: kycFailed, load: loadKyc } = useKyc()
const kyc = computed(() => kycFailed.value ? null : kycStatus.value)

async function readKyc() {
  await loadKyc().catch(() => { kycStatus.value = null })
}

const mustVerify = computed(() => !!account.value && verificationNeeded(account.value.kycRequired?.withdraw, kyc.value))

onMounted(readKyc)

// Back from Didit with the browser's back button, the page is shown as it was left.
function onPageShow(event: PageTransitionEvent) {
  if (event.persisted) readKyc()
}
onMounted(() => window.addEventListener('pageshow', onPageShow))
onUnmounted(() => window.removeEventListener('pageshow', onPageShow))

const amount = ref('')
const address = ref('')
// Not in Figma: what the form says when it will not send.
const amountProblem = ref('')
const addressProblem = ref('')

// An amount typed for one coin means nothing in another.
function chooseCoin(symbol: string) {
  if (symbol === coin.value) return
  pick(symbol)
  amount.value = amountProblem.value = addressProblem.value = ''
}

// TRX and USDT have six decimals, and the page shows no more for any coin.
const DECIMALS = 6
const UNIT = 10 ** DECIMALS
// Cut, never rounded up: an amount must not come out above what the account holds.
const cut = (value: number) => Math.floor(Math.max(0, value) * UNIT + 1e-6) / UNIT

// What the account can send: its available amount, less what a network's own coin must leave for
// the fee. The backend only checks the first; a withdrawal that takes the fee's share fails later.
const reserve = computed(() => account.value ? withdrawalFeeReserve(account.value.chain) : 0)
const most = computed(() => account.value ? cut(account.value.available - reserve.value) : 0)
const feeNote = computed(() => `${reserve.value} ${account.value?.symbol} must stay in the account for the network fee.`)

function fillMax() {
  if (!account.value) return
  amount.value = most.value ? String(most.value) : ''
  if (most.value) amountProblem.value = ''
  else amountProblem.value = account.value.available > 0 ? `${feeNote.value} That leaves nothing to withdraw.` : 'This account has nothing to withdraw.'
}

const typedAmount = computed(() => {
  const typed = amount.value.trim()
  return /^(\d+\.?\d*|\.\d+)$/.test(typed) ? Number(typed) : NaN
})

function check() {
  const { symbol, available, chain, coin: { name, network }, address: own } = account.value
  const value = typedAmount.value
  if (Number.isNaN(value)) amountProblem.value = 'Enter the amount as a number, like 12.5.'
  else if (value === 0) amountProblem.value = 'Enter an amount greater than 0.'
  else if ((amount.value.trim().split('.')[1] ?? '').length > DECIMALS) amountProblem.value = `Use at most ${DECIMALS} decimals.`
  else if (value > available) amountProblem.value = `You have ${coinAmount(cut(available))} ${symbol} available.`
  else if (value > most.value) amountProblem.value = `${feeNote.value} The most you can withdraw is ${coinAmount(most.value)} ${symbol}.`
  else amountProblem.value = ''

  const to = address.value.trim()
  if (!to) addressProblem.value = 'Enter a destination address.'
  else if (!looksLikeAddress(chain, to)) addressProblem.value = `This is not a ${network ?? name} address.`
  else if (to === own) addressProblem.value = "This is the account's own deposit address."
  else addressProblem.value = ''

  return !amountProblem.value && !addressProblem.value
}

// The fee is charged on top, so what is sent is what arrives.
const receive = computed(() => typedAmount.value > 0 ? coinAmount(typedAmount.value) : '0.00')

// Not in Figma: the result dialog. Core's `error` is not shown: a refusal carries the server's own
// words, so each failure is worded here from its kind.
const wording = {
  rejected:   'The withdrawal could not be started. Try again in a moment.',
  failed:     'The withdrawal did not go through. The amount was returned to your account.',
  timeout:    'The result has not arrived yet. The withdrawal may still go through, so do not send it again. Check History in a few minutes.',
  unexpected: 'We could not confirm that the withdrawal started. Check History before trying again.',
}
const titles = {
  rejected:   'Withdrawal not sent',
  failed:     'Withdrawal failed',
  timeout:    'Still processing',
  unexpected: 'Withdrawal not confirmed',
}
// /accounts/withdraw's refusals, by error_code.
const refusals: Record<number, string> = {
  100001: 'This account cannot withdraw.',
  100005: 'This account cannot withdraw.',
  100006: 'This account cannot withdraw.',
  100007: 'The account does not have that much available.',
  100008: 'Enter a destination address.',
  100009: 'Withdrawals are not available for this currency yet.',
  100048: 'That is not an address on this network.',
  [KYC_REQUIRED]: 'Withdrawals in this currency need a verified identity. Verify it, then try again.',
}

const { status, failure, errorCode, txId, send, reset } = useWithdraw(wording)

// A refusal with no error_code (a gateway error) is no clear answer either.
const kind = computed(() => failure.value === 'rejected' && !errorCode.value ? 'unexpected' : failure.value || 'failed')
// The withdrawal may be under way, or may still start.
const unsure = computed(() => kind.value === 'timeout' || kind.value === 'unexpected')

// What the dialog talks about: the form is emptied while it is open.
const sent = ref({ amount: '', to: '' })
const starting = ref(false)

const outcome = computed(() => {
  const { amount: sum, to } = sent.value
  if (status.value === 'processing') return { title: 'Withdrawing', text: `Sending ${sum} to ${shorten(to)}. This can take up to a minute. Keep this page open.` }
  if (status.value === 'success') return { title: 'Withdrawal sent', text: `${sum} was sent to ${shorten(to)}.`, history: true }
  const text = kind.value === 'rejected' ? refusals[errorCode.value!] ?? wording.rejected : wording[kind.value]
  return { title: titles[kind.value], text, history: unsure.value }
})

async function withdraw() {
  if (!account.value || starting.value || status.value !== 'idle' || mustVerify.value || !check()) return
  starting.value = true
  // The result is pushed to the user's own connection.
  if (userId.value || await loadUser()) {
    const { value: accountNo, chain, symbol } = account.value
    const to = address.value.trim()
    sent.value = { amount: `${coinAmount(typedAmount.value)} ${symbol}`, to }
    await send({ accountNo, chain, amount: typedAmount.value, unit: 'crypto', userId: userId.value, destinationAddress: to })
  } else {
    router.push({ name: 'auth' })
  }
  starting.value = false
}

watch(status, (now) => {
  if (now !== 'success' && now !== 'failed') return
  // A withdrawal that may be under way must not be sent again by reflex.
  if (now === 'success' || unsure.value) amount.value = address.value = ''
  // The amount left the account, or came back to it.
  refresh().catch(() => {})
  // The policy refused it: the status read before may be out of date, and the notice must show
  if (errorCode.value === KYC_REQUIRED) readKyc()
})

const copied = ref(false)

async function copyTxId() {
  try {
    await navigator.clipboard.writeText(txId.value)
  } catch {
    return
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function closeDialog() {
  copied.value = false
  reset()
}

// A deposit, or the fee of a withdrawal just sent, moves the available amount.
let rereading = false

async function reread() {
  if (rereading || state.value !== 'ready' || status.value === 'processing') return
  rereading = true
  await refresh().catch(() => {})
  rereading = false
}

useReread(reread)

// Still the mockup's numbers, in the chosen account's coin.
const inCoinUnits = (value: string) => state.value === 'loading' ? BLANK : account.value ? `${value} ${account.value.symbol}` : '—'

const card = 'panel rounded-[10px]'
const title = 'border-b border-rule pb-[20.5px] pl-[14px] pt-[19.5px] text-[18px] leading-none font-medium lg:pb-[31px] lg:pl-[29px] lg:pt-[29px] lg:text-[22px] lg:font-semibold'
const label = 'text-[12px] leading-none font-semibold text-muted lg:text-[16px] lg:font-medium lg:text-ink light:text-muted'
// Not in Figma: the box shows the focus. The browser's ring around the bare <input> covers the caret.
const input = 'flex h-[35px] items-center rounded-[5px] border-[0.5px] border-card-line bg-field pl-[9px] pr-[10.5px] text-[12px] font-medium text-muted focus-within:border-accent light:shadow-(--shadow-card) lg:h-[50px] lg:pl-[17px] lg:pr-[19px] lg:text-[14px]'
const field = 'min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted light:placeholder:text-ink'
const line = 'flex items-center justify-between text-[12px] leading-none lg:text-[16px]'
const problem = 'mt-[8px] text-[10px] leading-[14px] font-medium text-red lg:mt-[10px] lg:text-[14px] lg:leading-[18px]'
const tryAgain = 'button-outline h-[40px] rounded-[5px] px-[24px] text-[12px] font-semibold lg:text-[14px]'
const dialogButton = 'grid h-[45px] place-items-center rounded-[5px] text-[12px] font-semibold lg:h-[50px] lg:text-[16px] lg:font-medium'
</script>

<template>
  <div class="mt-[20px] grid grid-cols-1 gap-[30px] lg:mt-[15px] lg:grid-cols-2">
    <section :class="card">
      <h2 :class="title">Withdraw Details</h2>

      <!-- Not in Figma: these two states. While the accounts are read the form is drawn with nothing in it. -->
      <ListState v-if="state === 'failed'" kind="error" title="Your accounts could not be loaded" text="Try again in a moment.">
        <button type="button" :class="tryAgain" @click="read">Try again</button>
      </ListState>
      <ListState v-else-if="state === 'ready' && !account" title="No accounts yet" text="Open an account and deposit to it before you withdraw.">
        <RouterLink :to="{ name: 'accounts' }" class="bg-cta grid h-[32px] place-items-center rounded-[7.5px] px-[16px] text-[10px] font-semibold text-white lg:h-[40px] lg:rounded-[10px] lg:px-[20px] lg:text-[14px] lg:font-medium">Go to Accounts</RouterLink>
      </ListState>

      <form v-else novalidate class="px-[14px] pb-[29px] pt-[20.5px] lg:px-[29px] lg:pt-[32px]" @submit.prevent="withdraw">
        <p :class="label">Select Currency</p>
        <div class="mt-[16.5px] flex min-h-[34px] flex-wrap gap-[8.33px] lg:-ml-px lg:mt-[22px] lg:min-h-[45px] lg:gap-[15px]">
          <button
            v-for="symbol in coins"
            :key="symbol"
            type="button"
            :aria-pressed="symbol === coin"
            class="currency-chip grid h-[34px] w-[61px] place-items-center rounded-[10px] text-[12px] leading-none font-semibold lg:h-[45px] lg:w-auto lg:max-w-[111px] lg:flex-1 lg:text-[18px] lg:font-medium"
            :class="symbol === coin ? 'text-white' : 'text-accent'"
            @click="chooseCoin(symbol)"
          >{{ symbol }}</button>
        </div>

        <div v-if="inCoin.length > 1" class="relative mt-[10px] lg:mt-[15px]" @keydown.esc="open = false">
          <button type="button" aria-haspopup="listbox" :aria-expanded="open" aria-label="Account" class="w-full justify-between" :class="input" @click="open = !open">
            <span class="mr-[8px] min-w-0 truncate"><span class="text-ink">{{ account.name }}</span> · {{ coinAmount(cut(account.available)) }} {{ account.symbol }}</span>
            <AppIcon name="caret-sm" class="light:text-ink" />
          </button>
          <DropdownList v-if="open" v-model="chosenAccount" :options="inCoin" @close="open = false">
            <template #default="{ option }">
              <span class="min-w-0 truncate">{{ option.name }}<span class="text-muted"> · {{ coinAmount(cut(option.available)) }} {{ option.symbol }}</span></span>
            </template>
          </DropdownList>
        </div>

        <p class="mt-[25.5px] lg:mt-[39px]" :class="label">Amount</p>
        <label class="mt-[16.5px] lg:mt-[17px]" :class="[input, { 'border-red!': amountProblem }]">
          <input v-model="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Amount" :aria-invalid="!!amountProblem" :class="field" @input="amountProblem = ''" />
          {{ account?.symbol }}
        </label>
        <p class="mt-[10.5px] flex items-center justify-between text-[10px] leading-none font-medium text-muted lg:mt-[14.5px] lg:text-[14px]">
          {{ account ? `Available: ${coinAmount(cut(account.available))} ${account.symbol}` : BLANK }}
          <button type="button" class="font-semibold text-accent underline underline-offset-[2.5px] lg:underline-offset-[3px]" @click="fillMax">Max</button>
        </p>
        <p v-if="amountProblem" role="alert" :class="problem">{{ amountProblem }}</p>

        <p class="mt-[36.5px] lg:mt-[31.5px]" :class="label">Destination Address</p>
        <label class="mt-[17px] lg:mt-[17.5px]" :class="[input, { 'border-red!': addressProblem }]">
          <input v-model="address" type="text" autocomplete="off" spellcheck="false" placeholder="Enter wallet address" aria-label="Destination address" :aria-invalid="!!addressProblem" :class="field" @input="addressProblem = ''" />
        </label>
        <p v-if="addressProblem" role="alert" :class="problem">{{ addressProblem }}</p>

        <div class="card mt-[15px] space-y-[12px] rounded-[10px] px-[8.5px] pb-[16px] pt-[14px] lg:-ml-px lg:mt-[30px] lg:space-y-[22px] lg:px-[18.5px] lg:py-[25px]">
          <p class="font-semibold lg:font-medium" :class="line">
            Network fee
            <span class="lg:text-[18px] lg:font-[450]">{{ account ? `${fee} ${account.symbol}` : BLANK }}</span>
          </p>
          <p class="font-semibold lg:font-medium" :class="line">
            You will receive
            <span class="text-accent lg:text-[18px] lg:font-[450]">{{ account ? `${receive} ${account.symbol}` : BLANK }}</span>
          </p>
        </div>

        <div class="mt-[15px] flex rounded-[10px] border-[0.5px] border-yellow bg-warn pb-[15px] pl-[11px] pt-[16.5px] text-warn-ink [--icon-scale:0.78] lg:-ml-px lg:border lg:pb-[20.5px] lg:pl-[21px] lg:pt-[22.5px] lg:[--icon-scale:1]">
          <AppIcon name="info" class="-mt-[0.5px] lg:-mt-[1.5px]" />
          <div class="ml-[9px] text-[12px] lg:ml-[9.5px] lg:text-[14px]">
            <p class="leading-none font-semibold">important:</p>
            <p class="mt-[13.5px] max-w-[200px] leading-[14px] lg:mt-[14.5px] lg:max-w-none lg:leading-[16px]">
              Please ensure the address is correct.<br />Transactions cannot be reversed once confirmed.
            </p>
          </div>
        </div>

        <KycNotice v-if="mustVerify" :what="`Withdrawals in ${account.symbol}`" :status="kyc!" />
        <button v-else type="submit" :disabled="!account || starting" class="bg-cta mt-[15px] h-[45px] w-full rounded-[5px] border-[0.5px] border-card-line text-[12px] font-semibold text-white light:border-0 lg:mt-[20px] lg:h-[50px] lg:text-[16px] lg:font-medium">Withdraw now</button>
      </form>
    </section>

    <div class="flex flex-col gap-[30px]">
      <section :class="card">
        <h2 :class="title">Your Wallets</h2>
        <!-- Not in Figma: a row per account, under its made-up name, and the three states. -->
        <ListState v-if="state === 'loading'" kind="loading" title="Loading your wallets…" />
        <ListState v-else-if="state === 'failed'" kind="error" title="Your wallets could not be loaded" text="Try again in a moment.">
          <button type="button" :class="tryAgain" @click="read">Try again</button>
        </ListState>
        <ListState v-else-if="!choices.length" title="No wallets yet" text="An account you open shows here with its balance." />
        <ul v-else class="space-y-[10px] px-[14px] pb-[19px] pt-[20px] lg:space-y-[20px] lg:px-[29px] lg:pb-[29px] lg:pt-[30px]">
          <CoinRow v-for="choice in choices" :key="choice.value" :coin="choice.coin.image" :symbol="choice.symbol" :name="choice.name" :detail="`${coinAmount(choice.balance)} ${choice.symbol}`" />
        </ul>
      </section>

      <section :class="card">
        <h2 :class="title">Withdraw Limits</h2>
        <div class="px-[14px] pb-[21px] pt-[19.5px] lg:px-[29px] lg:pb-[31.5px] lg:pt-[34.5px]">
          <p class="flex items-start justify-between leading-none">
            <span class="text-[12px] font-semibold text-muted light:text-ink lg:mt-px lg:text-[16px] lg:font-medium">Daily Limit</span>
            <span class="text-[14px] font-semibold lg:text-[22px]">{{ inCoinUnits(limits.daily) }}</span>
          </p>
          <div class="mt-[15.5px] h-[10px] rounded-full bg-card light:bg-track lg:mt-[12.5px]">
            <div v-if="account" class="bg-teal-rise h-full rounded-full" :style="{ width: `${limits.usedShare}%` }" />
          </div>
          <p class="mt-[10.5px] text-[12px] leading-none font-semibold text-muted light:text-ink lg:mt-[17px] lg:text-[16px] lg:font-medium">{{ account ? `${limits.used} ${account.symbol} used today` : BLANK }}</p>

          <div class="mt-[30.5px] space-y-[22px] border-t border-rule pt-[20px] font-semibold text-muted lg:mt-[31px] lg:space-y-[24px] lg:pt-[31.5px] lg:font-medium">
            <p :class="line">Minimum withdrawal <span class="font-medium text-ink lg:-mr-px">{{ inCoinUnits(limits.minimum) }}</span></p>
            <p :class="line">Processing time <span class="font-medium text-ink lg:-mr-px">{{ limits.processing }}</span></p>
          </div>
        </div>
      </section>
    </div>
  </div>

  <!-- Not in Figma. It cannot be closed while the withdrawal is processed. -->
  <AppDialog v-if="status !== 'idle'" :title="outcome.title" :locked="status === 'processing'" @close="closeDialog">
    <p class="text-[12px] leading-[18px] font-medium text-muted lg:text-[14px] lg:leading-[22px]" :role="status === 'failed' ? 'alert' : 'status'">{{ outcome.text }}</p>

    <template v-if="status === 'success' && txId">
      <p class="mt-[20px] text-[12px] leading-none font-semibold text-muted lg:mt-[24px] lg:text-[14px]">Transaction ID</p>
      <div class="mt-[11.5px] flex gap-[10px] lg:mt-[13.5px]">
        <p class="value-box flex h-[35px] min-w-0 flex-1 items-center rounded-[5px] pl-[10px] pr-[8px] text-[12px] font-semibold lg:h-[40px] lg:pl-[15px] lg:text-[14px]">
          <span class="truncate">{{ txId }}</span>
        </p>
        <button type="button" :aria-label="copied ? 'Transaction ID copied' : 'Copy transaction ID'" class="bg-copy grid size-[35px] place-items-center rounded-[5px] lg:size-[40px]" :class="copied ? 'text-accent light:text-ink' : 'text-white'" @click="copyTxId">
          <AppIcon name="copy-light" mobile="copy-light-sm" />
        </button>
      </div>
    </template>

    <div v-if="status !== 'processing'" class="mt-[20px] grid gap-[15px] lg:mt-[28.5px]" :class="{ 'grid-cols-2': outcome.history }">
      <RouterLink v-if="outcome.history" :to="{ name: 'withdraw-history' }" class="button-outline" :class="dialogButton">View History</RouterLink>
      <button type="button" class="bg-cta border-[0.5px] border-card-line text-white light:border-0" :class="dialogButton" @click="closeDialog">{{ status === 'success' ? 'Done' : 'Close' }}</button>
    </div>
  </AppDialog>
</template>
