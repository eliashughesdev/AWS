<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { dots } from '../tones'
import type { Summary } from '../placeholders/transactions'

defineProps<{ item: Summary }>()
</script>

<template>
  <div class="relative rounded-[10px] border border-card-line bg-card pb-[20.5px] pl-[14px] pt-[19.5px] lg:pb-[30.5px] lg:pl-[29.5px] lg:pt-[30.5px]">
    <span class="dot-glow absolute right-[11px] top-[11px] size-[10px] rounded-full lg:right-[19px] lg:top-[19px] lg:size-[12px]" :class="dots[item.dot]" />
    <p class="text-[12px] leading-none font-semibold text-muted lg:text-[18px]">{{ item.label }}</p>
    <p class="mt-[15px] text-[22px] leading-none font-semibold lg:mt-[22.5px] lg:text-[25px]">{{ item.value }}</p>
    <p class="mt-[13px] flex items-center gap-[2px] text-[12px] leading-none font-medium lg:mt-[20.5px]" :class="item.up ? 'text-accent' : 'text-red'">
      <AppIcon name="arrow-up" class="[--icon-scale:0.58]" :class="{ 'rotate-180': !item.up }" />
      {{ item.change }}
    </p>
  </div>
</template>
