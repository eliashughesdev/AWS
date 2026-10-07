<script setup lang="ts">
import AppIcon from '../components/AppIcon.vue'
import SummaryCard from '../components/SummaryCard.vue'
import FilterButton from '../components/FilterButton.vue'
import DataTable from '../components/DataTable.vue'
import StatusPill from '../components/StatusPill.vue'
import { summary, transactions, type TransactionType } from '../placeholders/transactions'

const columns = ['ID', 'Type', 'Currency', 'Amount', 'From/To', 'Fee', 'Status', 'Date/Time']
// Only the first three columns are drawn on mobile; the widths of the others are not from the design.
// On desktop the columns share the width in the design's proportions, down to a width where they still fit.
const grid = 'grid-cols-[148px_111px_70px_100px_120px_100px_91px_112px] lg:min-w-[1108px] lg:grid-cols-[144fr_163fr_190fr_182fr_184fr_154fr_172fr_160fr]'

const badges: Record<TransactionType, string> = {
  Deposit:  'bg-green',
  Withdraw: 'bg-blue',
  Convert:  'bg-accent',
  Earn:     'bg-yellow',
  Payment:  'bg-orange',
  Reward:   'bg-brown',
}
</script>

<template>
  <div class="mt-[19px] grid grid-cols-1 gap-[15px] sm:grid-cols-2 lg:-mr-px lg:mt-[24px] lg:grid-cols-4">
    <SummaryCard v-for="item in summary" :key="item.label" :item="item" />
  </div>

  <div class="mt-[20px] lg:-ml-px lg:mt-[30px] lg:flex lg:gap-[15px]">
    <label class="flex h-[40px] items-center rounded-[10px] border border-card-line bg-card pl-[9px] pr-[10px] text-muted [--icon-scale:0.78] lg:h-[50px] lg:max-w-[684px] lg:flex-1 lg:pl-[14px] lg:[--icon-scale:1]">
      <AppIcon name="search" />
      <input type="search" placeholder="Search payments..." class="ml-[8px] min-w-0 flex-1 bg-transparent text-[12px] font-medium text-white placeholder:text-muted lg:ml-[10px] lg:text-[16px]" />
    </label>
    <!-- On mobile the buttons run past the screen's edge and scroll sideways. -->
    <div class="no-scrollbar -mr-[10px] mt-[10px] flex gap-[10px] overflow-x-auto pr-[10px] lg:m-0 lg:gap-[15px] lg:overflow-visible lg:p-0">
      <FilterButton icon="filter" mobile-icon="filter-sm" label="All Types" />
      <FilterButton icon="pulse" mobile-icon="pulse-sm" label="All Status" />
      <FilterButton icon="calendar" mobile-icon="calendar-sm" label="Last 30 days" />
    </div>
  </div>

  <DataTable
    v-slot="{ row }"
    title="Payment History"
    :columns="columns"
    :rows="transactions"
    :grid="grid"
    class="mb-[6px] mt-[15px] lg:-mb-[10px] lg:-ml-px lg:mr-px lg:mt-[30px]"
  >
    <span role="cell" class="text-[12px] font-semibold">{{ row.id }}</span>
    <span role="cell">
      <span class="grid h-[23px] w-[72px] place-items-center rounded-[10px] pb-[2px] text-[10px] leading-none font-semibold" :class="badges[row.type]">{{ row.type }}</span>
    </span>
    <span role="cell" class="text-[14px] font-medium">{{ row.currency }}</span>
    <div role="cell">
      <p class="flex items-center gap-px text-[14px] leading-none font-medium" :class="row.up ? 'text-accent' : 'text-red'">
        <AppIcon name="arrow-up" class="[--icon-scale:0.8]" :class="{ 'rotate-180': !row.up }" />
        {{ row.amount }}
      </p>
      <p class="mt-[3.5px] text-[10px] leading-none font-medium text-muted">{{ row.usd }}</p>
    </div>
    <div role="cell" class="pb-[2px] pl-[2.5px] text-[12px] leading-[14px] font-semibold">
      <p>{{ row.from }}</p>
      <p class="flex items-center gap-[3px] pl-[2px]"><AppIcon name="arrow-right" />{{ row.to }}</p>
    </div>
    <span role="cell" class="text-[14px] font-medium">{{ row.fee }}</span>
    <span role="cell"><StatusPill :status="row.status" /></span>
    <span role="cell" class="text-[14px] font-medium">{{ row.date }}</span>
  </DataTable>
</template>
