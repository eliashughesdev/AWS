<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { Account } from '../placeholders/accounts'

defineProps<{ account: Account }>()

const label = 'text-[12px] leading-none font-semibold text-muted lg:ml-[2.5px] lg:text-[14px]'
</script>

<template>
  <div class="bg-account rounded-[10px] border border-card-line pb-[29px] pl-[11px] pr-[14px] pt-[24.5px] lg:px-[19px] lg:pb-[23px] lg:pt-[24px]">
    <div class="flex items-start">
      <h2 class="text-[18px] leading-none font-[450] max-lg:ml-[2.5px] lg:text-[22px] lg:font-semibold">{{ account.name }}</h2>
      <AppIcon v-if="account.main" name="star-filled" class="ml-[8.5px] mt-[1.5px] text-accent [--icon-scale:0.94] lg:ml-[5.5px] lg:mt-[5px] lg:[--icon-scale:1]" />
      <p class="ml-auto mr-px flex items-center gap-[4px] text-[12.5px] leading-none font-medium text-muted max-lg:mt-[4.5px]">
        <span class="size-[7px] rounded-full bg-accent" />
        {{ account.status }}
      </p>
    </div>

    <!-- The row keeps its height on cards without the tag. -->
    <div class="mt-[11.5px] flex h-[25px] lg:mt-[13px] lg:h-[30px]">
      <span
        v-if="account.main"
        class="flex items-center rounded-[6px] border border-accent bg-accent-dim pl-[10px] pr-[10.5px] text-[10px] leading-none font-semibold text-accent lg:rounded-[10px] lg:px-[15px] lg:text-[12px]"
      >Main account</span>
    </div>

    <p class="mt-[25.5px] lg:mt-[17.5px]" :class="label">Balance</p>
    <p class="mt-[12px] text-[32px] leading-none font-medium lg:mt-[21.5px] lg:text-[30px]">{{ account.balance }}</p>

    <p class="mt-[28px] lg:mt-[28.5px]" :class="label">Wallet Address</p>
    <div class="mt-[11.5px] flex gap-[8px] lg:mt-[15.5px] lg:gap-[10px]">
      <p class="bg-address flex h-[35px] min-w-0 flex-1 items-center rounded-[7.5px] border-[0.5px] border-accent pl-[11px] pr-[17px] text-[12px] font-semibold text-accent lg:h-[38px] lg:rounded-[10px] lg:pl-[10px] lg:text-[14px]">
        <span class="truncate">{{ account.address }}</span>
      </p>
      <button type="button" aria-label="Copy address" class="bg-copy grid size-[35px] place-items-center rounded-[5px] border border-card-line text-muted [--icon-scale:0.94] lg:size-[38px] lg:[--icon-scale:1]">
        <AppIcon name="copy" />
      </button>
    </div>

    <p class="mt-[30.5px] lg:mt-[19px]" :class="label">Holdings</p>
    <ul class="mt-[11.5px] flex gap-[10px] lg:ml-[0.5px] lg:mt-[16px] lg:gap-[11px]">
      <li
        v-for="coin in account.holdings"
        :key="coin"
        class="grid h-[35px] w-[60px] place-items-center rounded-[10px] border border-card-line bg-chip pb-px text-[14px] leading-none font-semibold text-muted lg:w-[59px]"
      >{{ coin }}</li>
    </ul>
  </div>
</template>
