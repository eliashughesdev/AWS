<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import { useWalletSession } from '@loudibly/core/wallet/session'
import { useWalletSend, SOL_FEE_BUFFER } from '@loudibly/core/composables/useWalletSend'
import { chainLabels } from '@loudibly/core/wallet/types'

const router  = useRouter()
const session = useWalletSession()

const fromAddress = ref('')
const destination = ref('')
const amount      = ref('')
const sending     = ref(false)
const errorMsg    = ref('')
const txId        = ref('')
const copied      = ref('')

const wallet = computed(() => session.wallets.value.find(w => w.address === fromAddress.value) ?? null)
const { balance, maxSendable, loadBalance, send } = useWalletSend(wallet)

const displayName = computed(() => session.shortAddress.value || 'Wallet')

onMounted(() => {
  if (session.wallets.value.length === 0) {
    router.push({ name: 'auth' })
    return
  }
  fromAddress.value = session.active.value?.address ?? session.wallets.value[0].address
  loadBalance()
})

function setMax() {
  amount.value = String(maxSendable.value)
}

async function handleSend() {
  errorMsg.value = ''
  txId.value = ''

  const w = wallet.value
  if (!w) return

  const value = parseFloat(amount.value)
  if (!Number.isFinite(value) || value <= 0) {
    errorMsg.value = 'Enter a valid amount.'
    return
  }
  if (value > maxSendable.value) {
    errorMsg.value = w.chain === 'SOL'
      ? `Not enough balance — leave at least ${SOL_FEE_BUFFER} SOL for fees.`
      : 'Not enough balance.'
    return
  }

  sending.value = true
  try {
    txId.value = await send(destination.value.trim(), amount.value)
    destination.value = ''
    amount.value = ''
    await loadBalance()
  } catch (e: unknown) {
    errorMsg.value = (e as Error).message ?? 'Transaction failed.'
  } finally {
    sending.value = false
  }
}

function handleSignOut() {
  session.clear()
  router.push({ name: 'auth' })
}

async function copyTxId() {
  await navigator.clipboard.writeText(txId.value)
  copied.value = txId.value
  setTimeout(() => { copied.value = '' }, 2000)
}
</script>

<template>
  <MainLayout :displayName="displayName" userEmail="" :nonCustodial="true" @signOut="handleSignOut">
    <section class="p-8 max-w-2xl mx-auto w-full">
      <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-8">Send</h1>

      <div class="bg-surface-1 border border-border-subtle rounded-xl p-8 flex flex-col gap-6">

        <!-- Success -->
        <div v-if="txId" class="flex items-start gap-4 p-4 bg-brand/10 border border-brand/30 rounded-lg">
          <span class="material-symbols-outlined text-brand shrink-0">check_circle</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-brand mb-1">Broadcast to the network.</p>
            <button
              type="button"
              @click="copyTxId"
              class="flex items-center gap-1.5 text-left text-[11px] text-text-secondary hover:text-white transition-colors font-['JetBrains_Mono']">
              <span class="break-all">{{ txId }}</span>
              <span class="material-symbols-outlined text-[14px] shrink-0">
                {{ copied === txId ? 'check' : 'content_copy' }}
              </span>
            </button>
          </div>
        </div>

        <!-- From -->
        <div>
          <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-2">
            From
          </label>
          <select
            v-model="fromAddress"
            @change="loadBalance"
            class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white font-['JetBrains_Mono'] focus:outline-none focus:border-brand/50 transition-colors">
            <option v-for="w in session.wallets.value" :key="w.address" :value="w.address">
              {{ chainLabels[w.chain] }} — {{ w.address }}
            </option>
          </select>
          <p class="mt-2 font-['JetBrains_Mono'] text-[11px] text-text-muted">
            Balance:
            <span v-if="balance === null">reading…</span>
            <span v-else>{{ balance.toFixed(6) }} {{ wallet?.chain === 'SOL' ? 'SOL' : 'TRX' }}</span>
          </p>
        </div>

        <!-- Destination -->
        <div>
          <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Destination address
          </label>
          <input
            v-model="destination"
            type="text"
            spellcheck="false"
            placeholder="Paste the recipient's address"
            class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white placeholder-text-muted font-['JetBrains_Mono'] focus:outline-none focus:border-brand/50 transition-colors"
          />
        </div>

        <!-- Amount -->
        <div>
          <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Amount
          </label>
          <div class="relative">
            <input
              v-model="amount"
              type="text"
              inputmode="decimal"
              placeholder="0.00"
              class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 pr-16 text-sm text-white placeholder-text-muted font-['JetBrains_Mono'] focus:outline-none focus:border-brand/50 transition-colors"
            />
            <button
              type="button"
              @click="setMax"
              :disabled="balance === null"
              class="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-white/5 border border-border-subtle text-text-secondary font-['JetBrains_Mono'] text-[10px] font-bold rounded hover:text-white disabled:opacity-40">
              MAX
            </button>
          </div>
          <p v-if="wallet?.chain === 'SOL'" class="mt-2 font-['JetBrains_Mono'] text-[11px] text-text-muted">
            ~{{ SOL_FEE_BUFFER }} SOL is held back for network fees.
          </p>
        </div>

        <p v-if="errorMsg" class="text-red-400 text-xs">{{ errorMsg }}</p>

        <button
          @click="handleSend"
          :disabled="sending || !destination || !amount"
          class="w-full bg-brand text-on-brand font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-full hover:bg-brand-hover active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ sending ? 'Signing & broadcasting…' : 'Sign & Send' }}
        </button>

        <p class="font-['JetBrains_Mono'] text-[11px] text-text-muted text-center">
          Signed locally with your key. It never leaves this browser.
        </p>

      </div>
    </section>
  </MainLayout>
</template>
