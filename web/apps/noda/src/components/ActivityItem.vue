<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { tones } from '../tones'
import type { Activity } from '../placeholders/dashboard'

defineProps<{ item: Activity }>()
</script>

<template>
  <div class="flex h-[65px] items-center rounded-[10px] border border-card-line bg-card pl-[11px] pr-[9px] lg:h-[100px] lg:pl-[22px] lg:pr-[29px]">
    <span
      class="grid size-[36px] shrink-0 place-items-center rounded-full lg:size-[60px]"
      :class="tones[item.tone]"
    >
      <AppIcon :name="item.icon" :mobile="item.mobileIcon" :class="item.mobileIcon ? 'lg:[--icon-scale:1.05]' : '[--icon-scale:0.63] lg:[--icon-scale:1.05]'" />
    </span>

    <div class="ml-[10px] lg:ml-[14px] lg:pb-[2px]">
      <p class="flex items-baseline gap-[5px] leading-none lg:gap-[6px]">
        <span class="text-[12px] font-semibold lg:text-[18px]">{{ item.kind }}</span>
        <span class="text-[12px] font-semibold text-muted lg:text-[14px]">{{ item.asset }}</span>
      </p>
      <p class="mt-[7px] flex gap-[9px] text-[12px] leading-none font-semibold [word-spacing:0.05em] text-muted lg:mt-[10px] lg:gap-[15px] lg:text-[14px]">
        <span>{{ item.amount }}</span>
        <span>{{ item.usd }}</span>
      </p>
    </div>

    <div class="ml-auto flex flex-col-reverse items-end gap-[5px] lg:flex-row lg:items-center lg:gap-[20px]">
      <span class="text-[10px] leading-none font-semibold text-muted lg:text-[14px]">{{ item.time }}</span>
      <span class="grid h-[24px] w-[80px] place-items-center rounded-full border-[0.5px] border-accent bg-accent-dim text-[10px] font-semibold text-accent lg:h-[30px] lg:w-[100px] lg:text-[12px]">
        {{ item.status }}
      </span>
    </div>
  </div>
</template>
