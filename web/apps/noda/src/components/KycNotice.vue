<script setup lang="ts">
// Not in Figma. Takes the place of a form's submit button when the chosen account's merchant needs
// the user's identity verified for the operation (the backend's KYC policy), and the user's is not
// yet. Verification starts here under the Dashboard's rule: only when none is under way.
import { computed, ref } from 'vue'
import { canStartKyc, useKyc, type KycStatus } from '@loudibly/core/composables/useKyc'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  // What needs it, as a sentence starts: "Withdrawals in USDT"
  what: string
  status: KycStatus
}>()

const { start } = useKyc()
const starting = ref(false)
const startFailed = ref(false)

const text = computed(() => {
  if (props.status === 'pending') return `${props.what} need a verified identity. Yours is being reviewed: you can go on once it is approved.`
  return `${props.what} need a verified identity. It takes a few minutes with an ID document.`
})

async function verify() {
  starting.value = true
  startFailed.value = false
  // When it starts, the browser leaves for Didit's page
  if (!(await start())) startFailed.value = true
  starting.value = false
}
</script>

<template>
  <div role="status" class="mt-[15px] rounded-[10px] border-[0.5px] border-yellow bg-warn px-[11px] pb-[15px] pt-[16.5px] text-warn-ink [--icon-scale:0.78] lg:-ml-px lg:mt-[20px] lg:border lg:px-[21px] lg:pb-[20.5px] lg:pt-[22.5px] lg:[--icon-scale:1]">
    <div class="flex">
      <AppIcon name="info" class="-mt-[0.5px] shrink-0 lg:-mt-[1.5px]" />
      <div class="ml-[9px] min-w-0 text-[12px] lg:ml-[9.5px] lg:text-[14px]">
        <p class="leading-none font-semibold">Verify your identity</p>
        <p class="mt-[13.5px] leading-[14px] lg:mt-[14.5px] lg:leading-[16px]">{{ text }}</p>
        <p v-if="startFailed" role="alert" class="mt-[10px] leading-[14px] font-medium text-red lg:leading-[16px]">Verification could not be started. Try again in a moment.</p>
      </div>
    </div>
    <button
      v-if="canStartKyc(status)"
      type="button"
      :disabled="starting"
      class="bg-cta mt-[15px] h-[45px] w-full rounded-[5px] border-[0.5px] border-card-line text-[12px] font-semibold text-white light:border-0 lg:mt-[20px] lg:h-[50px] lg:text-[16px] lg:font-medium"
      @click="verify"
    >{{ starting ? 'Opening verification…' : 'Verify identity' }}</button>
  </div>
</template>
