<script setup lang="ts">
import AppIcon from '../components/AppIcon.vue'
import QrCode from '../components/QrCode.vue'
import DataTable from '../components/DataTable.vue'
import StatusPill from '../components/StatusPill.vue'
import type { IconName } from '../icons'
import { currency, deposits } from '../placeholders/deposit'

// Only the Crypto method is drawn, so the other two cannot be chosen yet.
const methods: { title: string; note: string; icon: IconName; mobileIcon: IconName; selected?: boolean }[] = [
  { title: 'Crypto',            note: 'instant deposit',   icon: 'wallet', mobileIcon: 'wallet-sm', selected: true },
  { title: 'Credit/Debit card', note: '2-3% fee',          icon: 'card',   mobileIcon: 'card-sm' },
  { title: 'Bank Transfer',     note: '1-3 business days', icon: 'bank',   mobileIcon: 'bank-sm' },
]

const columns = ['Currency', 'Amount', 'USD Value', 'Status', 'Time']
// The Time column is not drawn on mobile; its width there is not from the design.
const grid = 'grid-cols-[87px_80px_93px_91px_90px] lg:min-w-[880px] lg:grid-cols-[306fr_298fr_314fr_288fr_143fr]'

const card = 'rounded-[10px] border border-line bg-[#02040E]'
const heading = 'text-[18px] leading-none font-medium lg:font-semibold'
const label = 'text-[12px] leading-none font-semibold text-muted lg:text-[14px]'
const cell = 'text-[12px] font-semibold lg:text-[16px] lg:font-medium'
</script>

<template>
  <div class="mt-[9px] lg:-mr-px lg:mt-[16px] lg:grid lg:grid-cols-[450px_1fr] lg:gap-[15px]">
    <!-- A card on desktop; on mobile the three tiles stand alone. -->
    <section class="lg:rounded-[10px] lg:border lg:border-line lg:bg-[#02040E] lg:px-[29px] lg:pt-[28.5px]">
      <h2 class="max-lg:hidden" :class="heading">Deposit Method</h2>
      <div class="space-y-[15px] lg:mt-[25.5px]">
        <button
          v-for="method in methods"
          :key="method.title"
          type="button"
          :aria-pressed="!!method.selected"
          class="flex h-[65px] w-full items-center rounded-[10px] border pl-[11px] text-left lg:h-[91px] lg:pl-[17px]"
          :class="method.selected ? 'tile-selected' : 'border-card-line bg-card'"
        >
          <span
            class="grid size-[40px] shrink-0 place-items-center rounded-full lg:size-[53px]"
            :class="method.selected ? 'bg-linear-90 from-[#42E0E6] to-[#0E2951] text-white' : 'bg-card-line text-muted'"
          >
            <AppIcon :name="method.icon" :mobile="method.mobileIcon" />
          </span>
          <span class="ml-[15px] mt-[1.5px] lg:-mt-[2px] lg:ml-[12px]">
            <span class="block text-[16px] leading-none font-medium lg:text-[18px] lg:font-semibold">{{ method.title }}</span>
            <span class="mt-[7px] block text-[12px] leading-none font-semibold text-muted lg:mt-[5px] lg:text-[14px]">{{ method.note }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="mt-[30px] px-[14px] pb-[30.5px] pt-[24.5px] lg:mt-0 lg:px-[29px] lg:pb-[45.5px] lg:pt-[28.5px]" :class="card">
      <h2 :class="heading">Crypto Deposit</h2>

      <p class="mt-[27px] lg:mt-[26px]" :class="label">Select Currency</p>
      <button type="button" class="mt-[11.5px] flex h-[35px] w-full items-center justify-between rounded-[5px] border-[0.5px] border-card-line bg-card pl-[9px] pr-[12.5px] text-[12px] font-semibold text-muted lg:mt-[13.5px] lg:pl-[14px] lg:pr-[11.5px] lg:text-[14px]">
        <span class="text-white">{{ currency.name }}</span>
        <AppIcon name="caret-sm" />
      </button>
      <p class="mt-[10px] tracking-normal lg:mt-[12px]" :class="label">Network: {{ currency.network }}</p>

      <div class="info-box mt-[22px] flex rounded-[5px] pb-[11px] pl-[11px] pt-[16.5px] [--icon-scale:0.78] lg:mt-[27px] lg:pb-[20px] lg:pl-[16.5px] lg:pt-[23px] lg:[--icon-scale:1]">
        <AppIcon name="info" class="-mt-[0.5px] text-accent lg:-mt-[1.5px]" />
        <div class="ml-[9px] text-[12px] lg:ml-[9.5px] lg:text-[14px]">
          <p class="leading-none font-semibold">important:</p>
          <ul class="mt-[9.5px] leading-[22px] lg:mt-[7.5px] lg:leading-[26px]">
            <li v-for="note in currency.notes" :key="note">– {{ note }}</li>
          </ul>
        </div>
      </div>

      <!-- A heading on desktop, a field label on mobile. -->
      <h2 class="mt-[20.5px] text-[12px] leading-none font-semibold text-muted lg:mt-[24.5px] lg:text-[18px] lg:text-white">Deposit Address</h2>
      <div class="mt-[11.5px] flex gap-[10px] lg:mt-[20.5px]">
        <p class="flex h-[35px] min-w-0 flex-1 items-center rounded-[5px] border-[0.5px] border-card-line bg-card pl-[10px] pr-[8px] text-[12px] font-semibold lg:h-[40px] lg:pl-[15px] lg:text-[14px]">
          <span class="truncate tracking-[0.004em]">{{ currency.address }}</span>
        </p>
        <button type="button" aria-label="Copy address" class="bg-copy grid size-[35px] place-items-center rounded-[5px] lg:size-[40px]">
          <AppIcon name="copy-light" mobile="copy-light-sm" />
        </button>
      </div>

      <div class="mx-auto mt-[22px] h-[137px] w-[136px] rounded-[5px] bg-white p-[7.5px] lg:mt-[38px] lg:h-[210px] lg:w-[209px] lg:rounded-[8px] lg:p-[12.5px]">
        <QrCode :value="currency.address" class="block w-full" />
      </div>
      <p class="mt-[12px] text-center text-[12px] leading-none font-semibold lg:mt-[16.5px] lg:text-[14px]">Scan QR code</p>
    </section>
  </div>

  <DataTable
    v-slot="{ row }"
    title="Recent Deposits"
    :columns="columns"
    :rows="deposits"
    :grid="grid"
    class="mt-[30px] lg:-mb-[2px] lg:mt-[20px] lg:[--table-foot:25px] lg:[--table-head-gap:49px]"
  >
    <span role="cell" :class="cell">{{ row.currency }}</span>
    <span role="cell" :class="cell">{{ row.amount }}</span>
    <span role="cell" :class="cell">{{ row.usd }}</span>
    <span role="cell"><StatusPill :status="row.status" /></span>
    <span role="cell" :class="cell">{{ row.time }}</span>
  </DataTable>
</template>
