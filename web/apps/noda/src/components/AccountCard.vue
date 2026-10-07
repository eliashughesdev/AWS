<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'

// `status` is the backend's own word for the account's state.
const props = defineProps<{ name: string; status: string; balance: string; address: string; holdings: string[] }>()

// Only "Active" is drawn. The other two looks are not from the design.
const state = computed(() => {
  if (props.status === 'active') return { label: 'Active', dot: 'bg-accent' }
  if (props.status === 'importing') return { label: 'Syncing', dot: 'bg-yellow' }
  return { label: props.status.charAt(0).toUpperCase() + props.status.slice(1), dot: 'bg-muted' }
})

// Not in Figma: the copy icon turns teal for two seconds once the address is on the clipboard.
const copied = ref(false)

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(props.address)
  } catch {
    return
  }
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

const label = 'text-[12px] leading-none font-semibold text-muted lg:ml-[2.5px] lg:text-[14px]'
</script>

<template>
  <div class="bg-account rounded-[10px] border border-card-line pb-[29px] pl-[11px] pr-[14px] pt-[24.5px] lg:px-[19px] lg:pb-[23px] lg:pt-[24px]">
    <div class="flex items-start">
      <h2 class="text-[18px] leading-none font-[450] max-lg:ml-[2.5px] lg:text-[22px] lg:font-semibold">{{ name }}</h2>
      <p class="ml-auto mr-px flex items-center gap-[4px] text-[12px] leading-none font-semibold text-muted max-lg:mt-[4.5px]">
        <span class="size-[7px] rounded-full" :class="state.dot" />
        {{ state.label }}
      </p>
    </div>

    <!-- Where the design's first card has its "Main account" tag. Empty, so every card keeps the drawn height. -->
    <div class="mt-[11.5px] h-[25px] lg:mt-[13px] lg:h-[30px]" />

    <p class="mt-[25.5px] lg:mt-[17.5px]" :class="label">Balance</p>
    <p class="mt-[12px] text-[32px] leading-none font-medium lg:mt-[21.5px] lg:text-[30px]">{{ balance }}</p>

    <p class="mt-[28px] lg:mt-[28.5px]" :class="label">Wallet Address</p>
    <div class="mt-[11.5px] flex gap-[8px] lg:mt-[15.5px] lg:gap-[10px]">
      <p class="bg-address flex h-[35px] min-w-0 flex-1 items-center rounded-[7.5px] border-[0.5px] border-accent pl-[11px] pr-[17px] text-[12px] font-semibold text-accent lg:h-[38px] lg:rounded-[10px] lg:pl-[10px] lg:text-[14px]">
        <span class="truncate">{{ address }}</span>
      </p>
      <button
        type="button"
        :aria-label="copied ? 'Address copied' : 'Copy address'"
        class="bg-copy grid size-[35px] place-items-center rounded-[5px] border border-card-line [--icon-scale:0.94] lg:size-[38px] lg:[--icon-scale:1]"
        :class="copied ? 'text-accent' : 'text-muted'"
        @click="copyAddress"
      >
        <AppIcon name="copy" />
      </button>
    </div>

    <p class="mt-[30.5px] lg:mt-[19px]" :class="label">Holdings</p>
    <ul class="mt-[11.5px] flex gap-[10px] lg:ml-[0.5px] lg:mt-[16px] lg:gap-[11px]">
      <li
        v-for="coin in holdings"
        :key="coin"
        class="grid h-[35px] w-[60px] place-items-center rounded-[10px] border border-card-line bg-chip pb-px text-[14px] leading-none font-semibold text-muted lg:w-[59px]"
      >{{ coin }}</li>
    </ul>
  </div>
</template>
