<script setup lang="ts">
import AppIcon from '../components/AppIcon.vue'
import DataTable from '../components/DataTable.vue'
import StatusPill from '../components/StatusPill.vue'
import { withdrawals } from '../placeholders/withdraw'

const columns = ['#', 'Wallet', 'Amount', 'Status', 'Date', 'TX HASH']
// The Date and TX HASH columns are not drawn on mobile; their widths there are not from the design.
const grid = 'grid-cols-[60px_107px_93px_91px_121px_100px] lg:min-w-[900px] lg:grid-cols-[201fr_230fr_242fr_232fr_221fr_223fr]'

const cell = 'text-[12px] font-semibold lg:text-[16px] lg:font-medium'
const chip = 'flex h-[28px] items-center rounded-[10px] border border-line text-[12px] font-semibold lg:h-[29px] lg:font-medium'
</script>

<template>
  <DataTable
    v-slot="{ row, index }"
    title="Recent Withdrawals"
    :columns="columns"
    :rows="withdrawals"
    :grid="grid"
    class="mt-[20px] lg:mt-[15px] lg:[--table-foot:15px] lg:[--table-head-gap:41px] lg:[--table-row:59.5px] lg:[--table-rows-gap:3px] lg:[--table-title:22px]"
  >
    <span role="cell" :class="cell">{{ index + 1 }}</span>
    <span role="cell">
      <span class="w-[72px] px-[3.5px] lg:w-[104px] lg:justify-center" :class="chip"><span class="truncate">{{ row.wallet }}</span></span>
    </span>
    <span role="cell" class="lg:-mt-[3px]" :class="cell">{{ row.amount }} <span class="text-accent">{{ row.currency }}</span></span>
    <span role="cell"><StatusPill :status="row.status" /></span>
    <span role="cell" class="text-[12px] font-semibold lg:pl-[2.5px] lg:text-[14px] lg:font-medium">{{ row.date }}</span>
    <span role="cell">
      <button type="button" aria-label="Copy transaction hash" class="w-[100px] justify-between pl-[9px] pr-[7px] text-muted [--icon-scale:0.667] lg:w-[120px] lg:pl-[13.5px] lg:pr-[8.5px]" :class="chip">
        <span class="text-white">{{ row.hash }}</span>
        <AppIcon name="copy-light" />
      </button>
    </span>
  </DataTable>
</template>
