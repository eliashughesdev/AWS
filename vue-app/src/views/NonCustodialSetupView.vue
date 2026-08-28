<script setup lang="ts">
import { ref } from 'vue'
import { fetchUserAttributes, fetchAuthSession } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import { generateTronWallet, type TronWallet } from '../wallet/tron'
import { generateSolanaWallet, type SolanaWallet } from '../wallet/solana'
import { API_BASE } from '../config'

const router = useRouter()

const displayName = ref('...')
const userEmail   = ref('')

type Chain = 'TRON' | 'SOL'
const chainLabels: Record<Chain, string> = { TRON: 'TRON', SOL: 'Solana' }
const selectedChain = ref<Chain>('TRON')

type Mode = 'generate' | 'import'
const mode = ref<Mode>('generate')

// Light sanity check — catches pasting an address for the wrong chain, or a
// stray typo, without being a full base58/checksum validator.
const addressPattern: Record<Chain, RegExp> = {
  TRON: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
}

const step = ref<'intro' | 'key' | 'activating' | 'syncing' | 'done'>('intro')
const wallet    = ref<TronWallet | SolanaWallet | null>(null)
const importAddress = ref('')
const generating = ref(false)
const confirmed  = ref(false)
const copied     = ref(false)
const activating = ref(false)
const importedAccountNo = ref('')
const errorMsg   = ref('')

async function getAuthHeaders() {
  const session = await fetchAuthSession()
  const token = session.tokens?.accessToken?.toString()
  return { Authorization: `Bearer ${token}`, 'X-Project': 'web' }
}

async function loadProfile() {
  try {
    const attrs = await fetchUserAttributes()
    userEmail.value = attrs.email ?? ''
    displayName.value = attrs.email?.split('@')[0] ?? 'User'
  } catch {
    router.push('/auth')
  }
}

loadProfile()

async function generate() {
  generating.value = true
  errorMsg.value = ''
  try {
    wallet.value = selectedChain.value === 'SOL'
      ? generateSolanaWallet()
      : await generateTronWallet()
    step.value = 'key'
  } catch (e) {
    errorMsg.value = 'Failed to generate wallet. Please try again.'
    console.error(e)
  } finally {
    generating.value = false
  }
}

async function copyKey() {
  if (!wallet.value) return
  await navigator.clipboard.writeText(wallet.value.privateKey)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

async function activate() {
  if (!wallet.value || !confirmed.value) return
  activating.value = true
  errorMsg.value = ''
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${API_BASE}/accounts/account`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_name: displayName.value,
        email: userEmail.value,
        chain: selectedChain.value,
        walletType: 'non-custodial',
        publicAddress: wallet.value.address,
        provider: 'PCF0001',
        accounting_currency: 'USD',
      }),
    })
    const data = await res.json()
    if (data.success) {
      step.value = 'done'
    } else {
      errorMsg.value = data.message ?? 'Account activation failed. Please try again.'
    }
  } catch {
    errorMsg.value = 'An unexpected error occurred.'
  } finally {
    activating.value = false
  }
}

const importAddressInvalid = () => !addressPattern[selectedChain.value].test(importAddress.value.trim())

// Import flow never touches a private key — the backend only needs the public
// address to seed the balance and history from the chain (accountBackfillHandler.ts).
async function importWallet() {
  errorMsg.value = ''
  if (!importAddress.value.trim()) {
    errorMsg.value = 'Enter your wallet address.'
    return
  }
  if (importAddressInvalid()) {
    errorMsg.value = `That doesn't look like a valid ${chainLabels[selectedChain.value]} address.`
    return
  }

  activating.value = true
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${API_BASE}/accounts/account`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_name: displayName.value,
        email: userEmail.value,
        chain: selectedChain.value,
        walletType: 'non-custodial',
        publicAddress: importAddress.value.trim(),
        external: true,
        provider: 'PCF0001',
        accounting_currency: 'USD',
      }),
    })
    const data = await res.json()
    if (data.success) {
      importedAccountNo.value = data.res?.data?.accountNo ?? ''
      step.value = 'syncing'
      pollImportStatus()
    } else {
      errorMsg.value = data.message ?? 'Account import failed. Please try again.'
    }
  } catch {
    errorMsg.value = 'An unexpected error occurred.'
  } finally {
    activating.value = false
  }
}

// Backfill runs async over SQS (accountBackfillHandler.ts) — poll until the
// account flips out of 'importing'. Give up after ~2 minutes; the account
// keeps syncing in the background and shows as such on the dashboard.
const MAX_POLL_ATTEMPTS = 40
const POLL_INTERVAL_MS = 3000

async function pollImportStatus(attempt = 0) {
  if (!importedAccountNo.value || attempt >= MAX_POLL_ATTEMPTS) {
    step.value = 'done'
    return
  }
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${API_BASE}/accounts/list`, { headers })
    const data = await res.json()
    const account = (data.accounts ?? []).find((a: any) => a.accountNo === importedAccountNo.value)
    if (account && account.status !== 'importing') {
      step.value = 'done'
      return
    }
  } catch (e) {
    console.error('Failed to poll import status', e)
  }
  setTimeout(() => pollImportStatus(attempt + 1), POLL_INTERVAL_MS)
}
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail">

    <section class="p-8 max-w-2xl mx-auto w-full">
      <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-[#52525B] mb-8">
        Non-Custodial Wallet Setup
      </h1>

      <!-- Step: intro -->
      <div v-if="step === 'intro'"
        class="bg-[#1a1d10] border border-white/[0.08] rounded-xl p-8 flex flex-col gap-6">

        <!-- Mode selector -->
        <div class="flex bg-[#0A0B0D] border border-white/[0.08] rounded-lg p-1 gap-1">
          <button
            type="button"
            @click="mode = 'generate'; errorMsg = ''"
            :class="[
              'flex-1 py-2 rounded text-xs font-[\'JetBrains_Mono\'] font-bold transition-all',
              mode === 'generate' ? 'bg-[#CCFF00] text-[#0A0B0D]' : 'text-[#A1A1AA] hover:text-white'
            ]">
            Generate New
          </button>
          <button
            type="button"
            @click="mode = 'import'; errorMsg = ''"
            :class="[
              'flex-1 py-2 rounded text-xs font-[\'JetBrains_Mono\'] font-bold transition-all',
              mode === 'import' ? 'bg-[#CCFF00] text-[#0A0B0D]' : 'text-[#A1A1AA] hover:text-white'
            ]">
            Import Existing
          </button>
        </div>

        <template v-if="mode === 'generate'">
          <div class="flex items-start gap-4">
            <span class="material-symbols-outlined text-[#CCFF00] text-3xl shrink-0">key</span>
            <div>
              <h2 class="text-lg font-semibold mb-2">You control your keys</h2>
              <p class="text-[#A1A1AA] text-sm leading-relaxed">
                With a non-custodial wallet, your private key is generated in your browser and
                never sent to our servers. You are the sole owner of your funds.
              </p>
            </div>
          </div>

          <div class="flex items-start gap-4 p-4 bg-amber-400/10 border border-amber-400/30 rounded-lg">
            <span class="material-symbols-outlined text-amber-400 shrink-0">warning</span>
            <p class="text-sm text-amber-300 leading-relaxed">
              <strong>If you lose your private key, you lose access to your funds permanently.</strong>
              There is no recovery option. Store it in a password manager or write it down and keep it safe.
            </p>
          </div>
        </template>

        <template v-else>
          <div class="flex items-start gap-4">
            <span class="material-symbols-outlined text-[#CCFF00] text-3xl shrink-0">sync</span>
            <div>
              <h2 class="text-lg font-semibold mb-2">Track a wallet you already own</h2>
              <p class="text-[#A1A1AA] text-sm leading-relaxed">
                Paste the public address of an existing wallet and we'll sync its balance and
                transaction history from the blockchain. We only ever need the address —
                <strong>never paste your private key or seed phrase here.</strong> You'll still sign
                withdrawals yourself, locally, whenever you send funds.
              </p>
            </div>
          </div>
        </template>

        <!-- Chain selector -->
        <div>
          <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#52525B] mb-2">
            Select Blockchain
          </label>
          <div class="flex bg-[#0A0B0D] border border-white/[0.08] rounded-lg p-1 gap-1">
            <button
              v-for="c in (['TRON', 'SOL'] as const)"
              :key="c"
              type="button"
              @click="selectedChain = c"
              :class="[
                'flex-1 py-2 rounded text-xs font-[\'JetBrains_Mono\'] font-bold transition-all',
                selectedChain === c ? 'bg-[#CCFF00] text-[#0A0B0D]' : 'text-[#A1A1AA] hover:text-white'
              ]">
              {{ chainLabels[c] }}
            </button>
          </div>
        </div>

        <!-- Import: address input -->
        <div v-if="mode === 'import'">
          <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#52525B] mb-2">
            Wallet Address ({{ chainLabels[selectedChain] }})
          </label>
          <input
            v-model="importAddress"
            type="text"
            placeholder="Paste your public address"
            class="w-full bg-[#0A0B0D] border border-white/[0.08] rounded-lg px-4 py-3 text-sm text-white placeholder-[#52525B] font-['JetBrains_Mono'] focus:outline-none focus:border-[#CCFF00]/50 focus:ring-1 focus:ring-[#CCFF00]/30 transition-colors"
          />
        </div>

        <p v-if="errorMsg" class="text-red-400 text-xs">{{ errorMsg }}</p>

        <button
          v-if="mode === 'generate'"
          @click="generate"
          :disabled="generating"
          class="w-full bg-[#CCFF00] text-[#0A0B0D] font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-lg hover:bg-lime-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ generating ? 'Generating…' : 'Generate My Wallet' }}
        </button>
        <button
          v-else
          @click="importWallet"
          :disabled="activating"
          class="w-full bg-[#CCFF00] text-[#0A0B0D] font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-lg hover:bg-lime-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ activating ? 'Importing…' : 'Import Wallet' }}
        </button>

      </div>

      <!-- Step: show private key -->
      <div v-else-if="step === 'key'"
        class="bg-[#1a1d10] border border-white/[0.08] rounded-xl p-8 flex flex-col gap-6">

        <div class="flex items-start gap-4 p-4 bg-red-400/10 border border-red-400/30 rounded-lg">
          <span class="material-symbols-outlined text-red-400 shrink-0">lock</span>
          <p class="text-sm text-red-300 leading-relaxed">
            <strong>This is the only time your private key will be shown.</strong>
            Copy it and store it somewhere safe before continuing.
          </p>
        </div>

        <!-- Private key display -->
        <div>
          <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#52525B] mb-2">
            Your Private Key
          </label>
          <div class="relative">
            <div class="w-full bg-[#0A0B0D] border border-white/[0.08] rounded-lg px-4 py-3 font-['JetBrains_Mono'] text-xs text-white break-all pr-20">
              {{ wallet?.privateKey }}
            </div>
            <button
              @click="copyKey"
              class="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-[#CCFF00] text-black font-['JetBrains_Mono'] text-[10px] font-bold rounded transition-all hover:bg-lime-300">
              {{ copied ? 'Copied!' : 'Copy' }}
            </button>
          </div>
        </div>

        <!-- Wallet address (public — safe to show) -->
        <div>
          <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#52525B] mb-2">
            Your Wallet Address ({{ chainLabels[selectedChain] }})
          </label>
          <div class="w-full bg-[#0A0B0D] border border-white/[0.08] rounded-lg px-4 py-3 font-['JetBrains_Mono'] text-xs text-[#A1A1AA] break-all">
            {{ wallet?.address }}
          </div>
        </div>

        <!-- Confirmation checkbox -->
        <label class="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            v-model="confirmed"
            class="mt-0.5 shrink-0 accent-[#CCFF00]"
          />
          <span class="text-sm text-[#A1A1AA] leading-relaxed">
            I have saved my private key in a secure location and understand that losing it means permanent loss of access to my funds.
          </span>
        </label>

        <p v-if="errorMsg" class="text-red-400 text-xs">{{ errorMsg }}</p>

        <button
          @click="activate"
          :disabled="!confirmed || activating"
          class="w-full bg-[#CCFF00] text-[#0A0B0D] font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-lg hover:bg-lime-300 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ activating ? 'Activating…' : 'Activate Account' }}
        </button>

      </div>

      <!-- Step: syncing (import only) -->
      <div v-else-if="step === 'syncing'"
        class="bg-[#1a1d10] border border-white/[0.08] rounded-xl p-8 flex flex-col items-center gap-6 text-center">

        <span class="material-symbols-outlined text-6xl text-[#CCFF00] animate-spin" style="animation-duration: 1.5s">
          autorenew
        </span>
        <div>
          <h2 class="text-lg font-semibold mb-2">Syncing your wallet</h2>
          <p class="text-[#A1A1AA] text-sm">
            Fetching your balance and transaction history from the blockchain. This can take a
            moment for addresses with a long history — feel free to head to the dashboard, we'll
            keep syncing in the background.
          </p>
        </div>

        <RouterLink
          :to="{ name: 'dashboard' }"
          class="font-['JetBrains_Mono'] text-xs font-bold px-6 py-3 border border-white/20 text-white/70 rounded-lg hover:bg-white/5 active:scale-95 transition-all">
          Go to Dashboard →
        </RouterLink>

      </div>

      <!-- Step: done -->
      <div v-else-if="step === 'done'"
        class="bg-[#1a1d10] border border-white/[0.08] rounded-xl p-8 flex flex-col items-center gap-6 text-center">

        <span class="material-symbols-outlined text-6xl text-[#CCFF00]" style="font-variation-settings: 'FILL' 1">
          check_circle
        </span>
        <div>
          <h2 class="text-lg font-semibold mb-2">Wallet {{ mode === 'import' ? 'Imported' : 'Activated' }}</h2>
          <p class="text-[#A1A1AA] text-sm">Your non-custodial {{ chainLabels[selectedChain] }} wallet is ready. Share your address to receive funds.</p>
        </div>

        <div class="w-full bg-[#0A0B0D] border border-white/[0.08] rounded-lg px-4 py-3 font-['JetBrains_Mono'] text-xs text-[#A1A1AA] break-all text-left">
          {{ wallet?.address ?? importAddress }}
        </div>

        <RouterLink
          :to="{ name: 'dashboard' }"
          class="font-['JetBrains_Mono'] text-sm font-bold px-6 py-3 bg-[#CCFF00] text-black rounded-lg hover:bg-lime-300 active:scale-95 transition-all">
          Go to Dashboard →
        </RouterLink>

      </div>

    </section>
  </MainLayout>
</template>
