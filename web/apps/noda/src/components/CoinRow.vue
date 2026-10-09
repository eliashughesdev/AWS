<script setup lang="ts">
// A coin with its symbol, name and one line under them. The slot sits at the row's right end.
// Not in Figma: a coin with no image keeps its place as a plain disc.
import CoinImage from './CoinImage.vue'
import type { CoinArt } from '../coins'

defineProps<{ coin?: CoinArt; symbol: string; name: string; detail: string }>()
</script>

<template>
  <li class="card flex h-[65px] items-center rounded-[10px] pl-[11px] pr-[20px] lg:h-[91px] lg:pl-[19px]">
    <CoinImage v-if="coin" :coin="coin" class="size-[36px] lg:size-[51px]" />
    <span v-else class="size-[36px] shrink-0 rounded-full bg-disc light:border light:border-outline lg:size-[51px]" />
    <div class="ml-[9.5px] lg:ml-[11.5px]">
      <p class="flex items-center gap-[6px] leading-none">
        <span class="text-[12px] font-semibold lg:text-[18px]">{{ symbol }}</span>
        <span class="text-[12px] font-semibold text-muted lg:-mt-[2px] lg:text-[14px]">{{ name }}</span>
      </p>
      <p class="mt-[7px] text-[12px] leading-none font-semibold [word-spacing:0.1em] text-muted lg:mt-[10px] lg:text-[14px]">{{ detail }}</p>
    </div>
    <div class="ml-auto"><slot /></div>
  </li>
</template>
