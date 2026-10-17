<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { ActivityStatus } from '../activity'
import type { IconName } from '../icons'
import { pills, tones, type Tone } from '../tones'

defineProps<{
  kind: string
  asset: string
  amount: string
  usd: string
  time: string
  status: ActivityStatus
  icon: IconName
  mobileIcon?: IconName
  tone: Tone
}>()
</script>

<template>
  <div class="card flex h-[65px] items-center rounded-[10px] pl-[11px] pr-[9px] lg:h-[100px] lg:pl-[22px] lg:pr-[29px]">
    <span
      class="grid size-[36px] shrink-0 place-items-center rounded-full lg:size-[60px]"
      :class="tones[tone]"
    >
      <AppIcon :name="icon" :mobile="mobileIcon" :class="mobileIcon ? 'lg:[--icon-scale:1.05]' : '[--icon-scale:0.63] lg:[--icon-scale:1.05]'" />
    </span>

    <div class="ml-[10px] lg:ml-[14px] lg:pb-[2px]">
      <p class="flex items-baseline gap-[5px] leading-none lg:gap-[6px]">
        <span class="text-[12px] font-semibold lg:text-[18px]">{{ kind }}</span>
        <span class="text-[12px] font-semibold text-muted lg:text-[14px]">{{ asset }}</span>
      </p>
      <p class="mt-[7px] flex gap-[9px] text-[12px] leading-none font-semibold [word-spacing:0.05em] text-muted lg:mt-[10px] lg:gap-[15px] lg:text-[14px]">
        <span>{{ amount }}</span>
        <span>{{ usd }}</span>
      </p>
    </div>

    <div class="ml-auto flex flex-col-reverse items-end gap-[5px] lg:flex-row lg:items-center lg:gap-[20px]">
      <span class="text-[10px] leading-none font-semibold text-muted lg:text-[14px]">{{ time }}</span>
      <span class="grid h-[24px] w-[80px] place-items-center rounded-full border-[0.5px] text-[10px] font-semibold lg:h-[30px] lg:w-[100px] lg:text-[12px]" :class="pills[status]">
        {{ status }}
      </span>
    </div>
  </div>
</template>
