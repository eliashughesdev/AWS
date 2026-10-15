<script setup lang="ts">
// Takes the place of a form's submit button when the chosen account's merchant needs the user's
// identity verified for the operation (the backend's KYC policy), and the user's is not yet.
// Verification starts here only when none is under way, as on the Dashboard.
import { computed, ref } from 'vue'
import { canStartKyc, useKyc, type KycStatus } from '@loudibly/core/composables/useKyc'

const props = defineProps<{
  // What needs it, as a sentence starts: "Withdrawals in USDT_TRON"
  what: string
  status: KycStatus
}>()

const { start } = useKyc()
const starting = ref(false)
const startFailed = ref(false)

const text = computed(() => props.status === 'pending'
  ? `${props.what} need a verified identity. Yours is being reviewed: you can go on once it is approved.`
  : `${props.what} need a verified identity. It takes a few minutes with an ID document.`)

async function verify() {
  starting.value = true
  startFailed.value = false
  // When it starts, the browser leaves for Didit's page
  if (!(await start())) startFailed.value = true
  starting.value = false
}
</script>

<template>
  <div role="status" class="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 flex flex-col gap-3">
    <div class="flex gap-3">
      <span class="material-symbols-outlined text-amber-400 shrink-0">verified_user</span>
      <div class="min-w-0">
        <p class="font-['JetBrains_Mono'] text-xs font-bold text-amber-400 uppercase tracking-widest">Verify your identity</p>
        <p class="mt-1 text-xs text-text-secondary">{{ text }}</p>
        <p v-if="startFailed" role="alert" class="mt-1 text-xs text-red-400">Verification could not be started. Try again in a moment.</p>
      </div>
    </div>
    <button
      v-if="canStartKyc(status)"
      type="button"
      @click="verify"
      :disabled="starting"
      class="w-full bg-brand text-on-brand font-['JetBrains_Mono'] text-sm font-bold py-3 rounded-full hover:bg-brand-hover active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
      {{ starting ? 'Opening verification…' : 'Verify identity' }}
    </button>
  </div>
</template>
