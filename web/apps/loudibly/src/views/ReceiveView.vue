<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { signOut } from '@loudibly/core/auth/cognito'
import { useCurrentUser } from '@loudibly/core/composables/useCurrentUser'
import { useRouter } from 'vue-router'
import QRCode from 'qrcode'
import MainLayout from '../layouts/MainLayout.vue'
import { USDT_TRON_CURRENCY } from '@loudibly/core/config'
import { listAccounts, createAccount as postAccount } from '@loudibly/core/api/accounts'

const router = useRouter()

const { userEmail, displayName, userId, load: loadUser } = useCurrentUser()

interface Account {
  accountNo: string
  chain: string
  currency: string
  depositAddress: string
  status: string
  balance: number
}

const accounts       = ref<Account[]>([])
const loading        = ref(true)
const creatingChain  = ref<string | null>(null)
const createError    = ref('')
const copiedAddress  = ref('')

const qrModalAccount = ref<Account | null>(null)
const qrDataUrl      = ref('')

const chainMeta: Record<string, { label: string; ticker: string; icon: string; iconBg: string; iconColor: string }> = {
  TRON:           { label: 'TRON',        ticker: 'TRX',  icon: 'toll',  iconBg: 'bg-red-400/10',     iconColor: 'text-red-400'    },
  SOL:            { label: 'Solana',      ticker: 'SOL',  icon: 'api',   iconBg: 'bg-purple-500/10',  iconColor: 'text-purple-400' },
  USDT_TRON:      { label: 'USDT (TRON)', ticker: 'USDT', icon: 'toll',  iconBg: 'bg-emerald-400/10', iconColor: 'text-emerald-400' },
  TUSDT_TRON: { label: 'USDT (TRON)', ticker: 'USDT', icon: 'toll',  iconBg: 'bg-emerald-400/10', iconColor: 'text-emerald-400' },
}

const FALLBACK_META = { label: 'Unknown', ticker: '', icon: 'token', iconBg: 'bg-white/10', iconColor: 'text-white' }
function meta(chain: string) {
  return chainMeta[chain] ?? { ...FALLBACK_META, label: chain, ticker: chain }
}

// Chains the user does not yet have an account on — offered as create buttons.
const missingChains = computed(() =>
  ['TRON', 'SOL', USDT_TRON_CURRENCY].filter(c => !accounts.value.some(a => a.chain === c))
)

async function loadAccounts() {
  const { data } = await listAccounts()
  accounts.value = (data.accounts ?? []).filter((a: Account) => !!a.chain)
}

async function generateQr(address: string) {
  try {
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim()
    qrDataUrl.value = await QRCode.toDataURL(address, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: brand },
    })
  } catch {
    qrDataUrl.value = ''
  }
}

async function showQr(account: Account) {
  qrModalAccount.value = account
  qrDataUrl.value      = ''
  await generateQr(account.depositAddress)
}

function closeQr() {
  qrModalAccount.value = null
  qrDataUrl.value      = ''
}

async function copyAddress(address: string) {
  await navigator.clipboard.writeText(address)
  copiedAddress.value = address
  setTimeout(() => { if (copiedAddress.value === address) copiedAddress.value = '' }, 2000)
}

async function createAccount(chain: string) {
  creatingChain.value = chain
  createError.value   = ''
  try {
    const { ok } = await postAccount({
      account_name:        `${meta(chain).label} Account`,
      chain,
      provider:            'PCF0001',
      accounting_currency: 'USD',
      userId:              userId.value,
      email:               userEmail.value,
    })
    if (!ok) throw new Error('Failed to create account')
    await loadAccounts()
  } catch (e: any) {
    createError.value = e.message ?? 'Something went wrong. Please try again.'
  } finally {
    creatingChain.value = null
  }
}

onMounted(async () => {
  if (!(await loadUser())) {
    router.push('/auth')
    return
  }

  try {
    await loadAccounts()
  } catch (e) {
    console.error('Failed to load accounts', e)
  } finally {
    loading.value = false
  }
})

async function handleSignOut() {
  await signOut()
  router.push('/auth')
}
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">
    <section class="p-8 max-w-7xl mx-auto w-full">

      <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-8">Receive Crypto</h1>

      <!-- Loading skeleton -->
      <div v-if="loading" class="max-w-2xl mx-auto space-y-4">
        <div class="h-28 bg-surface-1 border border-border-subtle rounded-xl animate-pulse" />
        <div class="h-28 bg-surface-1 border border-border-subtle rounded-xl animate-pulse" />
      </div>

      <template v-else>
        <div class="max-w-2xl mx-auto flex flex-col gap-4">

          <!-- Empty state: no accounts at all -->
          <div v-if="accounts.length === 0"
            class="bg-surface-1 border border-border-subtle rounded-xl p-8 flex flex-col items-center gap-4 text-center">
            <span class="material-symbols-outlined text-5xl text-text-muted">account_balance_wallet</span>
            <div>
              <p class="text-sm text-text-secondary mb-1">No accounts yet.</p>
              <p class="text-xs text-text-muted">Create one to get a deposit address.</p>
            </div>
          </div>

          <!-- One card per account -->
          <div
            v-for="acc in accounts"
            :key="acc.accountNo"
            class="bg-surface-1 border border-border-subtle rounded-xl p-5 flex flex-col gap-4">

            <!-- Header: chain -->
            <div class="flex items-center gap-3">
              <span
                class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                :class="meta(acc.chain).iconBg">
                <span class="material-symbols-outlined text-lg" :class="meta(acc.chain).iconColor">
                  {{ meta(acc.chain).icon }}
                </span>
              </span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-white">{{ meta(acc.chain).label }}</p>
                <p class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted truncate">
                  {{ acc.accountNo }}
                </p>
              </div>
            </div>

            <!-- Address + copy -->
            <div class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 flex items-center gap-3">
              <span class="flex-1 font-['JetBrains_Mono'] text-xs text-white break-all">
                {{ acc.depositAddress }}
              </span>
              <button
                @click="copyAddress(acc.depositAddress)"
                class="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest transition-colors"
                :class="copiedAddress === acc.depositAddress ? 'text-brand' : 'text-text-muted hover:text-white'">
                <span class="material-symbols-outlined text-sm">
                  {{ copiedAddress === acc.depositAddress ? 'check' : 'content_copy' }}
                </span>
                {{ copiedAddress === acc.depositAddress ? 'Copied' : 'Copy' }}
              </button>
            </div>

            <!-- Actions + warning -->
            <div class="flex items-center justify-between gap-3">
              <p class="text-[11px] text-amber-400/90 flex items-center gap-1.5">
                <span class="material-symbols-outlined text-sm">warning</span>
                Only send <strong>{{ meta(acc.chain).ticker }}</strong> to this address.
              </p>
              <button
                @click="showQr(acc)"
                class="shrink-0 flex items-center gap-1.5 font-['JetBrains_Mono'] text-[10px] font-bold uppercase tracking-widest px-3 py-2 bg-page border border-border-subtle text-white rounded-full hover:border-brand/50 transition-colors">
                <span class="material-symbols-outlined text-sm">qr_code_2</span>
                Show QR
              </button>
            </div>
          </div>

          <!-- Create missing-chain accounts -->
          <div v-if="missingChains.length" class="flex flex-col gap-3 pt-2">
            <p v-if="createError" class="text-red-400 text-xs">{{ createError }}</p>
            <div class="flex flex-wrap gap-3">
              <button
                v-for="chain in missingChains"
                :key="chain"
                @click="createAccount(chain)"
                :disabled="creatingChain !== null"
                class="font-['JetBrains_Mono'] text-xs font-bold px-4 py-2.5 border border-brand/40 text-brand rounded-full hover:bg-brand/10 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {{ creatingChain === chain ? 'Creating…' : `Create ${meta(chain).ticker} Account` }}
              </button>
            </div>
          </div>

        </div>
      </template>

    </section>

    <!-- QR modal — only one QR rendered at a time -->
    <Transition name="overlay">
      <div
        v-if="qrModalAccount"
        @click.self="closeQr"
        class="fixed inset-0 z-50 bg-page/90 backdrop-blur-sm flex items-center justify-center p-6">
        <div class="bg-surface-1 border border-border-subtle rounded-2xl p-6 max-w-sm w-full flex flex-col items-center gap-5 relative">

          <button
            @click="closeQr"
            class="absolute right-4 top-4 text-text-muted hover:text-white transition-colors">
            <span class="material-symbols-outlined">close</span>
          </button>

          <div class="text-center">
            <p class="text-sm font-bold text-white">{{ meta(qrModalAccount.chain).label }}</p>
            <p class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted">
              Deposit address
            </p>
          </div>

          <!-- QR code -->
          <div class="p-3 bg-brand rounded-xl">
            <img
              v-if="qrDataUrl"
              :src="qrDataUrl"
              alt="Deposit address QR code"
              class="w-48 h-48 block"
            />
            <div v-else class="w-48 h-48 flex items-center justify-center">
              <span class="material-symbols-outlined text-4xl text-on-brand animate-spin">autorenew</span>
            </div>
          </div>

          <!-- Address + copy -->
          <div class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 flex items-center gap-3">
            <span class="flex-1 font-['JetBrains_Mono'] text-xs text-white break-all">
              {{ qrModalAccount.depositAddress }}
            </span>
            <button
              @click="copyAddress(qrModalAccount.depositAddress)"
              class="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest transition-colors"
              :class="copiedAddress === qrModalAccount.depositAddress ? 'text-brand' : 'text-text-muted hover:text-white'">
              <span class="material-symbols-outlined text-sm">
                {{ copiedAddress === qrModalAccount.depositAddress ? 'check' : 'content_copy' }}
              </span>
              {{ copiedAddress === qrModalAccount.depositAddress ? 'Copied' : 'Copy' }}
            </button>
          </div>

          <div class="w-full flex items-start gap-2 bg-amber-400/5 border border-amber-400/20 rounded-lg px-4 py-3">
            <span class="material-symbols-outlined text-sm text-amber-400 shrink-0 mt-0.5">warning</span>
            <p class="text-xs text-amber-400">
              Only send <strong>{{ meta(qrModalAccount.chain).ticker }}</strong> to this address.
              Sending other assets will result in permanent loss.
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </MainLayout>
</template>

<style scoped>
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.2s ease;
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
</style>
