<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import CoinImage from './CoinImage.vue'
import type { CoinArt } from '../coins'
import type { Change } from '../placeholders/dashboard'

defineProps<{
  symbol: string
  name: string
  image?: CoinArt
  amount: string
  value: string
  change?: Change
  share: string  // "45%"
  fill: number   // how much of the bar is filled, 0 to 100
}>()
</script>

<template>
  <div class="card flex h-[65px] items-center rounded-[10px] pl-[11px] pr-[14px] lg:h-[100px] lg:pl-[23px] lg:pr-[24px]">
    <CoinImage v-if="image" :coin="image" class="size-[36px] lg:size-[60px]" />
    <span v-else class="size-[36px] shrink-0 rounded-full bg-chip lg:size-[60px]" />

    <!-- 92px wide in the mobile design. It grows with a longer amount, which stays clear of the value. -->
    <div class="ml-[10px] max-lg:min-w-[92px] max-lg:shrink-0 max-lg:pr-[6px] lg:ml-[16px] lg:flex-1">
      <p class="flex items-baseline gap-[6px] leading-none">
        <span class="text-[12px] font-semibold lg:text-[18px]">{{ symbol }}</span>
        <span class="text-[12px] font-semibold text-muted lg:text-[14px]">{{ name }}</span>
      </p>
      <p class="mt-[7px] text-[12px] leading-none font-semibold [word-spacing:0.1em] text-muted lg:mt-[10px] lg:text-[14px]">{{ amount }}</p>
    </div>

    <div class="flex-1 lg:flex-none lg:pt-[6px] lg:text-right">
      <p class="text-[12.5px] leading-none font-medium lg:text-[19px]">{{ value }}</p>
      <p
        class="mt-[9px] flex items-center text-[10px] leading-none font-semibold lg:mt-[13px] lg:justify-end lg:text-[18px]"
        :class="change?.up ? 'text-green' : 'text-red'"
      >
        <template v-if="change">
          <AppIcon name="arrow-up" class="mr-[6px] [--icon-scale:0.92] max-lg:hidden" :class="{ 'rotate-180': !change.up }" />
          {{ change.text }}
        </template>
        <!-- Keeps the line's height. -->
        <template v-else>&nbsp;</template>
      </p>
    </div>

    <div class="lg:ml-[96px] lg:w-[94px]">
      <p class="text-right text-[10px] leading-none font-medium text-muted lg:text-[17px] lg:font-semibold">{{ share }}</p>
      <div class="mt-[9px] h-[5px] rounded-full bg-track max-lg:hidden">
        <div class="h-full rounded-full bg-accent" :style="{ width: `${fill}%` }" />
      </div>
    </div>
  </div>
</template>
