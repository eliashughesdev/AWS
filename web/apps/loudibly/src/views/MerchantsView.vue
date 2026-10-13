<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { signOut } from '@loudibly/core/auth/cognito'
import { useCurrentUser } from '@loudibly/core/composables/useCurrentUser'
import { useMerchants } from '@loudibly/core/composables/useMerchants'
import { LEDGER_CURRENCIES } from '@loudibly/core/config'
import type { Merchant } from '@loudibly/core/api/types'
import { useRouter } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'
import RegisterMerchantDialog from '../components/RegisterMerchantDialog.vue'
import { currencyLabel, statusPill } from '../merchants'

const router = useRouter()

const { userEmail, displayName, load: loadUser } = useCurrentUser()
const { merchants, failed, load, refresh, addCurrency } = useMerchants()

const state       = ref<'loading' | 'failed' | 'ready'>('loading')
const registering = ref(false)

async function read() {
  state.value = 'loading'
  try {
    await load()
  } catch {
    state.value = 'failed'
    return
  }
  state.value = failed.value ? 'failed' : 'ready'
}

// After a change. A list on screen stays there if this read fails.
function reread() {
  return state.value === 'ready' ? refresh().catch(() => {}) : read()
}

onMounted(async () => {
  if (!(await loadUser())) {
    router.push('/auth')
    return
  }
  await read()
})

async function handleSignOut() {
  await signOut()
  router.push('/auth')
}

// ── Adding a currency ──────────────────────────────────────────────────────────
// The same request adds a currency and finishes one left `provisioning`.
const missing = (merchant: Merchant) =>
  LEDGER_CURRENCIES.filter(currency => !merchant.currencies.some(held => held.currency === currency))

// The currency chosen in each merchant's dropdown, by merchant id.
const picked = reactive<Record<string, string>>({})
const choice = (merchant: Merchant) => {
  const options = missing(merchant)
  return options.includes(picked[merchant.merchantId]) ? picked[merchant.merchantId] : options[0]
}

// `<merchant id>:<currency>` while its request runs. One at a time.
const busy  = ref('')
const notes = reactive<Record<string, { tone: string; text: string }>>({})

async function provision(merchant: Merchant, currency: string) {
  const id    = merchant.merchantId
  const label = currencyLabel(currency)
  busy.value = `${id}:${currency}`
  delete notes[id]

  const unknown = {
    tone: 'text-amber-400',
    text: `No answer came back for ${label}. It may still be running, or have stopped part of the way. Refresh in a moment: use “Finish” if its row is not ready, or add it again if it has no row.`,
  }
  try {
    const { ok, status, data } = await addCurrency(id, currency)
    if (ok && data.status === 'ready') {
      notes[id] = { tone: 'text-green-400', text: `${label} is ready.` }
    } else if (status === 403) {
      notes[id] = { tone: 'text-red-400', text: 'Your session is not allowed to change merchants.' }
    } else if (data.error_code === 100040) {
      notes[id] = { tone: 'text-red-400', text: 'This merchant does not exist or is not active.' }
    } else if (data.error_code === 100041) {
      notes[id] = { tone: 'text-red-400', text: `${label} was not finished. Try it again: it goes on from where it stopped.` }
    } else if (status >= 400 && status < 500) {
      notes[id] = { tone: 'text-red-400', text: `The server refused ${label}. Nothing was changed.` }
    } else {
      notes[id] = unknown
    }
  } catch {
    notes[id] = unknown
  }
  await reread()
  busy.value = ''
}

const copied = ref('')

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  copied.value = text
  setTimeout(() => { copied.value = '' }, 2000)
}
</script>

<template>
  <MainLayout :displayName="displayName" :userEmail="userEmail" @signOut="handleSignOut">
    <section class="p-8 max-w-7xl mx-auto w-full">

      <div class="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-1">Merchants</h1>
          <p class="text-[14px] text-text-secondary">Every merchant and the currencies it holds. Staff only.</p>
        </div>
        <div class="flex items-center gap-3">
          <button
            type="button"
            @click="read"
            :disabled="state === 'loading'"
            class="flex items-center gap-2 bg-surface-1 text-text-secondary border border-border-subtle font-['JetBrains_Mono'] text-[13px] py-2 px-4 rounded-full hover:text-white hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            <span class="material-symbols-outlined text-sm">refresh</span>
            Refresh
          </button>
          <button
            type="button"
            @click="registering = true"
            class="flex items-center gap-2 bg-brand text-on-brand font-['JetBrains_Mono'] text-[13px] font-bold py-2 px-4 rounded-full hover:bg-brand-hover active:scale-95 transition-all">
            <span class="material-symbols-outlined text-sm">add</span>
            Register merchant
          </button>
        </div>
      </div>

      <!-- Loading skeleton -->
      <div v-if="state === 'loading'" class="space-y-4">
        <div v-for="n in 3" :key="n" class="h-40 bg-surface-1 border border-border-subtle rounded-xl animate-pulse" />
      </div>

      <!-- The read failed: an empty list here would not be the real one -->
      <div v-else-if="state === 'failed'"
        class="flex flex-col items-center justify-center py-20 bg-surface-1 border border-border-subtle rounded-xl text-center">
        <span class="material-symbols-outlined text-5xl text-red-400 mb-4">error</span>
        <p class="text-text-secondary text-sm">The merchants could not be read.</p>
        <p class="text-text-muted text-xs mt-1">Nothing is known about the list until it is read again.</p>
        <button
          type="button"
          @click="read"
          class="mt-6 bg-surface-2 text-white border border-border-subtle font-['JetBrains_Mono'] text-[13px] py-2 px-6 rounded-full hover:border-white/20 transition-all">
          Try again
        </button>
      </div>

      <!-- Empty state -->
      <div v-else-if="merchants.length === 0"
        class="flex flex-col items-center justify-center py-20 bg-surface-1 border border-border-subtle rounded-xl text-center">
        <span class="material-symbols-outlined text-5xl text-text-muted mb-4">storefront</span>
        <p class="text-text-secondary text-sm">No merchants yet.</p>
        <p class="text-text-muted text-xs mt-1">Register the first one with the button above.</p>
      </div>

      <!-- Merchants -->
      <div v-else class="space-y-4">
        <div v-for="merchant in merchants" :key="merchant.merchantId"
          class="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden">

          <div class="flex flex-wrap items-center gap-4 px-6 py-4">
            <div class="w-10 h-10 rounded bg-surface-2 border border-border-subtle flex items-center justify-center shrink-0 text-text-secondary">
              <span class="material-symbols-outlined">storefront</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-bold break-words">{{ merchant.name }}</p>
              <div class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
                <button
                  type="button"
                  @click="copy(merchant.merchantId)"
                  class="flex items-center gap-1 font-['JetBrains_Mono'] hover:text-white transition-colors">
                  <span class="break-all text-left">{{ merchant.merchantId }}</span>
                  <span class="material-symbols-outlined text-[13px] shrink-0">
                    {{ copied === merchant.merchantId ? 'check' : 'content_copy' }}
                  </span>
                </button>
                <span>Accounting currency {{ merchant.accountingCurrency }}</span>
                <span v-if="merchant.createdAt">Registered {{ new Date(merchant.createdAt).toLocaleDateString() }}</span>
              </div>
            </div>
            <span class="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border" :class="statusPill(merchant.status).tone">
              {{ statusPill(merchant.status).label }}
            </span>
          </div>

          <div v-if="merchant.currencies.length" class="overflow-x-auto border-t border-border-subtle">
            <table class="w-full text-left">
              <thead class="bg-surface-2 border-b border-border-subtle">
                <tr>
                  <th class="w-56 px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Currency</th>
                  <th class="w-48 px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Status</th>
                  <th class="px-6 py-3 font-['JetBrains_Mono'] text-[10px] text-text-muted uppercase">Deposit address</th>
                  <th class="w-36 px-6 py-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border-subtle">
                <tr v-for="held in merchant.currencies" :key="held.currency">
                  <td class="px-6 py-3 text-[14px] whitespace-nowrap">{{ currencyLabel(held.currency) }}</td>
                  <td class="px-6 py-3">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap" :class="statusPill(held.status).tone">
                      {{ statusPill(held.status).label }}
                    </span>
                  </td>
                  <td class="px-6 py-3">
                    <button
                      v-if="held.depositAddress"
                      type="button"
                      @click="copy(held.depositAddress)"
                      class="flex items-center gap-1 text-[11px] text-text-secondary hover:text-white transition-colors font-['JetBrains_Mono']">
                      <span class="break-all text-left">{{ held.depositAddress }}</span>
                      <span class="material-symbols-outlined text-[13px] shrink-0">
                        {{ copied === held.depositAddress ? 'check' : 'content_copy' }}
                      </span>
                    </button>
                    <span v-else class="text-text-muted">—</span>
                  </td>
                  <td class="px-6 py-3 text-right">
                    <button
                      v-if="held.status !== 'ready'"
                      type="button"
                      @click="provision(merchant, held.currency)"
                      :disabled="busy !== ''"
                      class="bg-surface-2 text-white border border-border-subtle font-['JetBrains_Mono'] text-xs py-1.5 px-4 rounded-full hover:border-white/20 transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
                      {{ busy === `${merchant.merchantId}:${held.currency}` ? 'Finishing…' : 'Finish' }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="px-6 py-4 border-t border-border-subtle text-xs text-text-secondary">No currencies yet.</p>

          <div v-if="missing(merchant).length || notes[merchant.merchantId]"
            class="flex flex-wrap items-center gap-3 px-6 py-4 border-t border-border-subtle">
            <template v-if="missing(merchant).length">
              <select
                :value="choice(merchant)"
                @change="picked[merchant.merchantId] = ($event.target as HTMLSelectElement).value"
                :disabled="busy !== ''"
                :aria-label="`Currency to add to ${merchant.name}`"
                class="bg-page border border-border-subtle rounded-lg pl-4 pr-9 py-2 text-sm text-white focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                <option v-for="currency in missing(merchant)" :key="currency" :value="currency">
                  {{ currencyLabel(currency) }}
                </option>
              </select>
              <button
                type="button"
                @click="provision(merchant, choice(merchant))"
                :disabled="busy !== ''"
                class="bg-surface-2 text-white border border-border-subtle font-['JetBrains_Mono'] text-xs py-2 px-4 rounded-full hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {{ busy === `${merchant.merchantId}:${choice(merchant)}` ? 'Adding…' : 'Add currency' }}
              </button>
            </template>
            <p v-if="notes[merchant.merchantId]" class="text-xs basis-full sm:basis-auto sm:flex-1" :class="notes[merchant.merchantId].tone">
              {{ notes[merchant.merchantId].text }}
            </p>
          </div>

        </div>
      </div>

    </section>

    <RegisterMerchantDialog v-if="registering" @reread="reread" @close="registering = false" />
  </MainLayout>
</template>
