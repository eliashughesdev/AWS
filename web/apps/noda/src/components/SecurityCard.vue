<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { security } from '../placeholders/dashboard'
</script>

<template>
  <section class="rounded-[10px] border border-card-line bg-card px-[14px] pb-[21px] pt-[19px] lg:px-[19px] lg:pb-[20px]">
    <div class="flex items-center gap-[12px] lg:gap-[10px]">
      <span class="bg-shield grid size-[45px] place-items-center rounded-full [--icon-scale:0.78] lg:size-[58px] lg:[--icon-scale:1]">
        <AppIcon name="shield" />
      </span>
      <div class="mt-[2px] lg:-mt-[2px]">
        <h2 class="text-[16px] leading-none font-medium lg:text-[18px]">Security Score</h2>
        <p class="mt-[9px] text-[12px] leading-none font-semibold text-accent lg:mt-[10px] lg:text-[14px]">{{ security.level }}</p>
      </div>
    </div>
    <p class="mt-[15px] pl-[2px] text-[12px] leading-none font-medium text-muted lg:mt-[31px] lg:text-[14px] lg:font-normal">{{ security.note }}</p>
  </section>
</template>
