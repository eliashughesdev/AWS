<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { Stat } from '../placeholders/dashboard'

defineProps<{ stat: Stat }>()
</script>

<template>
  <div class="card-stat rounded-[10px] px-[11px] pb-[15px] pt-[16px] lg:px-[24px] lg:pb-[28px] lg:pt-[31px]">
    <p class="text-[10px] leading-none font-medium lg:text-[16px]">{{ stat.label }}</p>
    <p class="mt-[12px] text-[18px] leading-none lg:mt-[25px] lg:text-[35px] lg:font-medium">{{ stat.value }}</p>
    <p class="mt-[12px] flex items-center text-[10px] leading-none font-medium text-accent lg:mt-[18px] lg:text-[16px]">
      <AppIcon name="arrow-up" class="ml-[2px] mr-px [--icon-scale:0.54] lg:ml-0 lg:mr-[6px] lg:[--icon-scale:1]" />
      {{ stat.change }}
    </p>
  </div>
</template>
