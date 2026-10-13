<script setup lang="ts">
import AppIcon from '../components/AppIcon.vue'
import PageAction from '../components/PageAction.vue'
import SummaryCard from '../components/SummaryCard.vue'
import DataTable from '../components/DataTable.vue'
import StatusPill from '../components/StatusPill.vue'
import { summary, methods, payments } from '../placeholders/payments'

const columns = ['ID', 'Recipient', 'Method', 'Category', 'Amount', 'Status', 'Date', 'Actions']
// Only the first two columns are drawn on mobile; the widths of the others are not from the design.
// On desktop the columns share the width in the design's proportions, down to a width where they still fit.
const grid = 'grid-cols-[87px_173px_90px_105px_75px_91px_122px_45px] lg:min-w-[1140px] lg:grid-cols-[144fr_201fr_186fr_194fr_189fr_177fr_166fr_92fr]'

const cell = 'text-[12px] font-semibold lg:text-[14px] lg:font-medium'
</script>

<template>
  <PageAction>
    <button type="button" class="bg-cta mt-[21px] h-[32px] w-[100px] rounded-[7.5px] text-[10px] font-semibold text-white lg:mt-0 lg:h-[40px] lg:w-[128px] lg:rounded-[10px] lg:text-[14px] lg:font-medium">+ New Payment</button>
  </PageAction>

  <div class="mt-[20px] grid grid-cols-1 gap-[15px] sm:grid-cols-2 lg:-mr-px lg:mt-[44px] lg:grid-cols-4">
    <SummaryCard v-for="item in summary" :key="item.label" :item="item" plain />
  </div>

  <section class="card lg:panel relative mt-[30px] rounded-[10px] px-[9px] pb-[19px] pt-[20px] lg:-ml-px lg:px-[29px] lg:pb-[29px] lg:pt-[39px]">
    <h2 class="text-[18px] leading-none font-medium lg:font-semibold">Payment Methods</h2>
    <button type="button" class="bg-account mt-[16px] h-[32px] w-[100px] rounded-[10px] border border-card-line text-[10px] font-semibold light:border-accent light:text-accent lg:absolute lg:right-[29px] lg:top-[29px] lg:mt-0 lg:h-[45px] lg:w-[137px] lg:text-[14px]">+ Add Method</button>

    <!-- Two columns until the four cards fit side by side. -->
    <ul class="mt-[14px] grid grid-cols-1 gap-[15px] sm:grid-cols-2 lg:mt-[40px] xl:grid-cols-4">
      <li
        v-for="method in methods"
        :key="method.name"
        class="relative rounded-[10px] pb-[16px] pl-[16px] pt-[14px] lg:pb-[31px] lg:pl-[29px] lg:pt-[29px]"
        :class="method.primary ? 'bg-method border border-accent' : 'card'"
      >
        <span v-if="method.primary" class="bg-cta absolute right-[14px] top-[14px] grid h-[25px] w-[60px] place-items-center rounded-[10px] text-[10px] leading-none font-semibold text-white lg:right-[19px] lg:top-[19px] lg:h-[30px] lg:w-[82px] lg:text-[12px]">Primary</span>
        <span
          class="grid size-[47px] place-items-center rounded-full border [--icon-scale:0.9] lg:size-[53px] lg:[--icon-scale:1]"
          :class="method.primary ? 'border-accent bg-accent-dim text-accent' : 'border-muted bg-select text-faint light:border-outline'"
        >
          <AppIcon :name="method.icon" />
        </span>
        <p class="mt-[12px] text-[16px] leading-none font-medium max-lg:ml-[2px] lg:mt-[32px] lg:text-[18px] lg:font-semibold">{{ method.name }}</p>
        <p class="mt-[7px] text-[12px] leading-none font-semibold max-lg:ml-[2px] lg:mt-[10px] lg:text-[14px]" :class="method.primary ? 'text-muted' : 'text-faint'">{{ method.kind }}</p>
      </li>
    </ul>
  </section>

  <DataTable
    title="Payment History"
    :columns="columns"
    :rows="payments"
    :grid="grid"
    class="mt-[30px] lg:-mb-[10px] lg:-ml-px lg:mr-px"
  >
    <!-- The mobile design has no search or filter. -->
    <template #tools>
      <div class="mt-[0.5px] flex gap-[15px] max-lg:hidden">
        <label class="card flex h-[45px] w-[333px] items-center rounded-[10px] pl-[14px] pr-[10px] text-muted [--icon-scale:0.78] focus-within:border-accent">
          <AppIcon name="search" />
          <input type="search" placeholder="Search payments..." class="ml-[10.5px] min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-ink outline-none placeholder:text-muted" />
        </label>
        <button type="button" class="card flex h-[45px] w-[122px] items-center rounded-[10px] pl-[12px] pr-[13px] text-[12px] font-semibold light:text-muted">
          <AppIcon name="funnel" />
          <span class="ml-auto">All</span>
          <AppIcon name="caret-sm" class="ml-[10px] text-muted" />
        </button>
      </div>
    </template>

    <template #default="{ row }">
      <span role="cell" :class="cell">{{ row.id }}</span>
      <span role="cell" :class="cell">{{ row.recipient }}</span>
      <!-- One line high, so the method lines up with the row's other cells and the number hangs under it. -->
      <div role="cell" class="h-[14px] leading-[14px]" :class="cell">
        <p>{{ row.method }}</p>
        <p v-if="row.number">{{ row.number }}</p>
      </div>
      <span role="cell" :class="cell">{{ row.category }}</span>
      <span role="cell" :class="cell">{{ row.amount }}</span>
      <span role="cell" class="lg:ml-[4px]"><StatusPill :status="row.status" /></span>
      <span role="cell" :class="cell">{{ row.date }}</span>
      <span role="cell" class="lg:ml-[10px]">
        <!-- Not drawn on mobile, where it is scaled down like the status pill. -->
        <button type="button" aria-label="Payment actions" class="grid size-[20px] place-items-center rounded-[3.5px] bg-action lg:size-[30px] lg:rounded-[5px]">
          <span class="flex flex-col gap-[1.5px] lg:ml-px lg:mt-px lg:gap-[2px]">
            <span v-for="n in 3" :key="n" class="size-[2px] rounded-full bg-faint lg:size-[3px]" />
          </span>
        </button>
      </span>
    </template>
  </DataTable>
</template>
