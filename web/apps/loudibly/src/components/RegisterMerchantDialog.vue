<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMerchants } from '@loudibly/core/composables/useMerchants'
import { LEDGER_CURRENCIES } from '@loudibly/core/config'
import { currencyLabel, statusPill } from '../merchants'

// reread: the list may have changed. close: take the dialog away.
const emit = defineEmits<{ reread: []; close: [] }>()

const { register } = useMerchants()

const name    = ref('')
const chosen  = ref<string[]>([])
const sending = ref(false)
const refusal = ref('')
// No answer came back, or one that says nothing: the merchant may exist.
const unknown = ref(false)

// The answer to the registration. The API key is here and nowhere else, and goes with
// this component when the dialog closes.
const registered = ref<{
  merchantId: string
  apiKey: string
  currencies: [string, { status: string; depositAddress?: string }][]
  seeds: [string, string][]
} | null>(null)

const fields = computed(() => registered.value
  ? [
      { id: 'id',  label: 'Merchant ID (sent as X-Project)', value: registered.value.merchantId },
      { id: 'key', label: 'API key',                         value: registered.value.apiKey },
    ]
  : [])

const currencyUnfinished = computed(() => registered.value?.currencies.some(([, outcome]) => outcome.status !== 'ready'))
const seedUnfinished     = computed(() => registered.value?.seeds.some(([, status]) => status !== 'ready'))

const refusals: Record<number, string> = {
  100003: 'The merchant could not be saved. Nothing was registered.',
  100029: 'The name is missing.',
  100031: 'The name or one of the currencies was not accepted.',
}

async function submit() {
  refusal.value = ''
  if (!name.value.trim()) {
    refusal.value = 'Give the merchant a name.'
    return
  }

  sending.value = true
  try {
    const { ok, status, data } = await register({
      name: name.value.trim(),
      currencies: LEDGER_CURRENCIES.filter(currency => chosen.value.includes(currency)),
    })
    if (ok && data.merchantId && data.apiKey) {
      registered.value = {
        merchantId: data.merchantId,
        apiKey:     data.apiKey,
        currencies: Object.entries(data.currencies ?? {}),
        seeds:      Object.entries(data.seeds ?? {}),
      }
      emit('reread')
    } else if (status >= 400 && status < 500) {
      // The API answers a 4xx before it writes anything, so the form can be sent again.
      refusal.value = status === 403
        ? 'Your session is not allowed to register merchants.'
        : refusals[data.error_code ?? 0] ?? 'The server refused the request. Nothing was registered.'
    } else {
      unknown.value = true
    }
  } catch {
    unknown.value = true
  } finally {
    sending.value = false
  }
}

// Only the form can be dismissed, and not while it is being sent: a stray click must not
// lose the key, or hide that the result is unknown.
function dismiss() {
  if (!sending.value && !unknown.value && !registered.value) emit('close')
}

function checkList() {
  emit('reread')
  emit('close')
}

const copied = ref('')

async function copy(id: string, value: string) {
  await navigator.clipboard.writeText(value)
  copied.value = id
  setTimeout(() => { copied.value = '' }, 2000)
}
</script>

<template>
  <div
    @click.self="dismiss"
    role="dialog"
    aria-modal="true"
    aria-labelledby="register-merchant-title"
    class="fixed inset-0 z-50 bg-page/90 backdrop-blur-sm flex items-center justify-center p-6">
    <div class="bg-surface-1 border border-border-subtle rounded-2xl p-6 max-w-lg w-full max-h-full overflow-y-auto flex flex-col gap-5 relative">

      <!-- ── Registered: the key, once ─────────────────────────────────────── -->
      <template v-if="registered">
        <div>
          <h2 id="register-merchant-title" class="text-sm font-bold text-white">Merchant registered</h2>
          <p class="text-xs text-text-secondary mt-1 break-words">{{ name.trim() }}</p>
        </div>

        <div v-for="field in fields" :key="field.id">
          <p class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">{{ field.label }}</p>
          <div class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 flex items-center gap-3">
            <span class="flex-1 font-['JetBrains_Mono'] text-xs text-white break-all select-all">{{ field.value }}</span>
            <button
              type="button"
              @click="copy(field.id, field.value)"
              class="shrink-0 flex items-center gap-1 font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest transition-colors"
              :class="copied === field.id ? 'text-brand' : 'text-text-muted hover:text-white'">
              <span class="material-symbols-outlined text-sm">{{ copied === field.id ? 'check' : 'content_copy' }}</span>
              {{ copied === field.id ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>

        <div class="w-full flex items-start gap-2 bg-amber-400/5 border border-amber-400/20 rounded-lg px-4 py-3">
          <span class="material-symbols-outlined text-sm text-amber-400 shrink-0 mt-0.5">warning</span>
          <p class="text-xs text-amber-400">
            This is the only time the API key is shown. Copy it and pass it on to the merchant now:
            it cannot be shown again.
          </p>
        </div>

        <div v-if="registered.currencies.length">
          <p class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Currencies</p>
          <div class="border border-border-subtle rounded-lg divide-y divide-border-subtle">
            <div v-for="[currency, outcome] in registered.currencies" :key="currency" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span class="text-sm w-28 shrink-0">{{ currencyLabel(currency) }}</span>
              <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border" :class="statusPill(outcome.status).tone">
                {{ statusPill(outcome.status).label }}
              </span>
              <span v-if="outcome.depositAddress" class="basis-full font-['JetBrains_Mono'] text-[11px] text-text-secondary break-all">
                {{ outcome.depositAddress }}
              </span>
            </div>
          </div>
          <p v-if="currencyUnfinished" class="text-xs text-text-secondary mt-2">
            A currency that is not ready can be finished from the list: “Finish” on its row, or
            “Add currency” when it has no row.
          </p>
        </div>

        <div v-if="registered.seeds.length">
          <p class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Address seeds, one per network</p>
          <div class="border border-border-subtle rounded-lg divide-y divide-border-subtle">
            <div v-for="[network, status] in registered.seeds" :key="network" class="flex items-center gap-3 px-4 py-3">
              <span class="text-sm w-28 shrink-0">{{ network }}</span>
              <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border" :class="statusPill(status).tone">
                {{ statusPill(status).label }}
              </span>
            </div>
          </div>
          <p v-if="seedUnfinished" class="text-xs text-text-secondary mt-2">
            A seed that is not ready is created the first time one of the merchant's accounts or
            currencies needs it.
          </p>
        </div>

        <button
          type="button"
          @click="emit('close')"
          class="w-full bg-brand text-on-brand font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-full hover:bg-brand-hover active:scale-95 transition-all">
          I have saved the key
        </button>
      </template>

      <!-- ── No answer: the merchant may exist ─────────────────────────────── -->
      <template v-else-if="unknown">
        <h2 id="register-merchant-title" class="text-sm font-bold text-white">No answer came back</h2>
        <div class="w-full flex items-start gap-2 bg-amber-400/5 border border-amber-400/20 rounded-lg px-4 py-3">
          <span class="material-symbols-outlined text-sm text-amber-400 shrink-0 mt-0.5">warning</span>
          <p class="text-xs text-amber-400 break-words">
            “{{ name.trim() }}” may have been registered anyway. Check the list before registering
            it again: a second attempt would make a second merchant.
          </p>
        </div>
        <p class="text-xs text-text-secondary">
          If it is in the list, its API key was lost with this answer and cannot be shown again.
        </p>
        <button
          type="button"
          @click="checkList"
          class="w-full bg-brand text-on-brand font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-full hover:bg-brand-hover active:scale-95 transition-all">
          Check the list
        </button>
      </template>

      <!-- ── The form ──────────────────────────────────────────────────────── -->
      <form v-else @submit.prevent="submit" class="flex flex-col gap-5">
        <button
          type="button"
          @click="dismiss"
          :disabled="sending"
          aria-label="Close"
          class="absolute right-4 top-4 text-text-muted hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          <span class="material-symbols-outlined">close</span>
        </button>

        <div>
          <h2 id="register-merchant-title" class="text-sm font-bold text-white">Register a merchant</h2>
          <p class="text-xs text-text-secondary mt-1">Creates the merchant and its API key. The key is shown once, when this is done.</p>
        </div>

        <div>
          <label for="merchant-name" class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Name</label>
          <input
            id="merchant-name"
            v-model="name"
            type="text"
            maxlength="100"
            autocomplete="off"
            :disabled="sending"
            class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white placeholder-text-muted focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/30 transition-colors disabled:opacity-50"
          />
        </div>

        <fieldset :disabled="sending">
          <legend class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-1.5">Currencies (optional)</legend>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="currency in LEDGER_CURRENCIES"
              :key="currency"
              class="flex items-center gap-2 px-4 py-2 rounded-full border font-['JetBrains_Mono'] text-xs cursor-pointer transition-all"
              :class="chosen.includes(currency)
                ? 'bg-brand/10 text-brand border-brand/40'
                : 'bg-page text-text-secondary border-border-subtle hover:text-white'">
              <input v-model="chosen" type="checkbox" :value="currency" class="accent-brand" />
              {{ currencyLabel(currency) }}
            </label>
          </div>
          <p class="text-xs text-text-secondary mt-2">Each one gets a master account with its deposit address. More can be added later from the list.</p>
        </fieldset>

        <p v-if="refusal" class="text-red-400 text-xs">{{ refusal }}</p>

        <button
          type="submit"
          :disabled="sending"
          class="w-full bg-brand text-on-brand font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-full hover:bg-brand-hover active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {{ sending ? 'Registering…' : 'Register merchant' }}
        </button>
        <p v-if="sending" class="text-xs text-text-secondary text-center -mt-2">
          This can take up to 30 seconds. Keep this window open.
        </p>
      </form>

    </div>
  </div>
</template>
