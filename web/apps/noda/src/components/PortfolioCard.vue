<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from '../icons'
import { tones, type Tone } from '../tones'
import { portfolio } from '../placeholders/dashboard'

const actions: { label: string; to: string; icon: IconName; mobileIcon?: IconName; tone: Tone }[] = [
  { label: 'Deposit',  to: 'deposit',  icon: 'deposit-lg', tone: 'green' },
  { label: 'Withdraw', to: 'withdraw', icon: 'withdraw',   mobileIcon: 'withdraw-sm', tone: 'blue' },
  { label: 'Convert',  to: 'convert',  icon: 'convert',    mobileIcon: 'convert-sm',  tone: 'teal' },
  { label: 'Earn',     to: 'earn',     icon: 'earn',       tone: 'yellow' },
]
</script>

<template>
  <section class="card-glow rounded-[10px] px-[14px] pb-[20px] pt-[19px] lg:p-[29px]">
    <div class="flex h-[14px] items-center lg:h-[20px]">
      <AppIcon name="wallet" class="text-accent [--icon-scale:0.68] lg:[--icon-scale:1]" />
      <span class="ml-[7px] text-[12px] font-medium lg:ml-[10px] lg:text-[18px]">Total Portfolio Balance</span>
      <AppIcon name="refresh" mobile="refresh-sm" class="ml-auto text-muted" />
    </div>

    <div class="mt-[13px] flex items-center lg:mt-[19px]">
      <span class="text-[40px] leading-none font-medium max-lg:-ml-[2px] lg:text-[55px]">{{ portfolio.balance }}</span>
      <AppIcon name="eye" mobile="eye-sm" class="ml-[8px] text-muted lg:-mt-[3px] lg:ml-[22px]" />
    </div>

    <div class="mt-[9px] flex items-center text-[12px] leading-none font-medium text-muted lg:mt-[17px] lg:text-[18px]">
      <AppIcon name="arrow-up" class="text-accent [--icon-scale:0.61] lg:-ml-px lg:[--icon-scale:0.92]" />
      <span class="ml-[3px] text-[11.5px] font-semibold text-accent lg:ml-[6px] lg:text-[17px]">{{ portfolio.change }}</span>
      <span class="ml-[12px]">{{ portfolio.changeAmount }}</span>
      <span class="ml-[12px] lg:ml-[14px]">{{ portfolio.period }}</span>
    </div>

    <div class="mt-[29px] grid grid-cols-2 gap-[16px] lg:mt-[35px] lg:grid-cols-4 lg:gap-[15px]">
      <RouterLink
        v-for="action in actions"
        :key="action.to"
        :to="{ name: action.to }"
        class="flex h-[119px] flex-col items-center rounded-[10px] border border-tile-line bg-tile pt-[28px] lg:h-[202px] lg:pt-[47px]"
      >
        <span
          class="grid size-[39px] place-items-center rounded-full lg:size-[66px]"
          :class="tones[action.tone]"
        >
          <AppIcon :name="action.icon" :mobile="action.mobileIcon" :class="{ '[--icon-scale:0.6] lg:[--icon-scale:1]': !action.mobileIcon }" />
        </span>
        <span class="mt-[12px] text-[12px] leading-none font-semibold lg:mt-[21px] lg:text-[18px]">{{ action.label }}</span>
      </RouterLink>
    </div>
  </section>
</template>
