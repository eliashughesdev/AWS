<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { achievements } from '../placeholders/dashboard'
</script>

<template>
  <section class="rounded-[10px] border border-card-line bg-card px-[11px] pb-[19px] pt-[21px] lg:px-[19px] lg:py-[28px]">
    <div class="flex items-center gap-[10px] lg:gap-[18px]">
      <span class="flex w-[23px] justify-center lg:w-[32px]">
        <AppIcon name="trophy" class="text-accent [--icon-scale:0.65] lg:[--icon-scale:1]" />
      </span>
      <h2 class="text-[16px] leading-none font-medium lg:text-[18px] lg:font-semibold">Achievements</h2>
    </div>
    <ul class="mt-[15px] space-y-[10px] lg:mt-[25px]">
      <li v-for="item in achievements" :key="item.label" class="flex items-center gap-[10px] lg:gap-[18px]">
        <span
          class="grid size-[23px] place-items-center rounded-full [--icon-scale:0.72] lg:size-[32px] lg:[--icon-scale:1]"
          :class="item.done ? 'bg-[#12384B] text-accent' : 'bg-[#3C3C3C] text-[#272829]'"
        >
          <AppIcon name="star" />
        </span>
        <span class="text-[14px] leading-none font-medium">{{ item.label }}</span>
      </li>
    </ul>
  </section>
</template>
