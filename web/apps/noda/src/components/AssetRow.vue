<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { Asset } from '../placeholders/dashboard'

defineProps<{ asset: Asset }>()
</script>

<template>
  <div class="flex h-[65px] items-center rounded-[10px] border border-card-line bg-card pl-[11px] pr-[14px] lg:h-[100px] lg:pl-[23px] lg:pr-[24px]">
    <img :src="asset.coin" alt="" class="size-[36px] lg:size-[60px]" />

    <div class="ml-[10px] w-[92px] lg:ml-[16px] lg:w-auto lg:flex-1">
      <p class="flex items-baseline gap-[6px] leading-none">
        <span class="text-[12px] font-semibold lg:text-[18px]">{{ asset.symbol }}</span>
        <span class="text-[12px] font-semibold text-muted lg:text-[14px]">{{ asset.name }}</span>
      </p>
      <p class="mt-[7px] text-[12px] leading-none font-semibold [word-spacing:0.1em] text-muted lg:mt-[10px] lg:text-[14px]">{{ asset.amount }}</p>
    </div>

    <div class="flex-1 lg:flex-none lg:pt-[6px] lg:text-right">
      <p class="text-[12.5px] leading-none font-medium lg:text-[19px]">{{ asset.value }}</p>
      <p
        class="mt-[9px] flex items-center text-[10px] leading-none font-semibold lg:mt-[13px] lg:justify-end lg:text-[18px]"
        :class="asset.up ? 'text-green' : 'text-red'"
      >
        <AppIcon name="arrow-up" class="mr-[6px] [--icon-scale:0.92] max-lg:hidden" :class="{ 'rotate-180': !asset.up }" />
        {{ asset.change }}
      </p>
    </div>

    <div class="lg:ml-[96px] lg:w-[94px]">
      <p class="text-right text-[10px] leading-none font-medium text-muted lg:text-[17px] lg:font-semibold">{{ asset.share }}%</p>
      <div class="mt-[9px] h-[5px] rounded-full bg-[#204E54] max-lg:hidden">
        <div class="h-full rounded-full bg-accent" :style="{ width: `${asset.share}%` }" />
      </div>
    </div>
  </div>
</template>
