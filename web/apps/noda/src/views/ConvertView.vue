<script setup lang="ts">
import AppIcon from '../components/AppIcon.vue'
import CoinRow from '../components/CoinRow.vue'
import DataTable from '../components/DataTable.vue'
import { conversions, quote, rates, sides } from '../placeholders/convert'

const columns = ['From', 'To', 'Amount', 'Received', 'Rate', 'Time']
// The Received, Rate and Time columns are not fully drawn on mobile; their widths there are not from the design.
const grid = 'grid-cols-[87px_80px_93px_85px_80px_90px] lg:min-w-[900px] lg:grid-cols-[224fr_206fr_243fr_233fr_230fr_214fr]'

const heading = 'text-[18px] leading-none font-medium lg:font-semibold'
const slot = 'rounded-[5px] border-[0.5px] border-[#32343C] bg-[#1B1D26]'
const line = 'flex items-center justify-between leading-none'
const cell = 'text-[12px] font-semibold lg:text-[16px] lg:font-medium'
const small = 'text-[12px] font-semibold lg:text-[14px] lg:font-medium'
</script>

<template>
  <div class="lg:-mr-px lg:mt-[19px] lg:grid lg:grid-cols-[minmax(0,1fr)_450px] lg:gap-[15px]">
    <!-- A card on desktop; on mobile its content stands on the page. -->
    <section class="lg:rounded-[10px] lg:border lg:border-line lg:bg-[#02040E] lg:p-[29px]">
      <h2 class="mt-[25px] lg:mt-0" :class="heading">Convert Crypto</h2>

      <div class="mt-[11px] lg:mt-[30px]">
        <template v-for="(side, index) in sides" :key="side.label">
          <!-- The swap button sits in the gap between the two boxes. -->
          <div v-if="index" class="relative z-10 h-[30px] lg:h-[40px]">
            <button type="button" aria-label="Swap currencies" class="bg-tab-active absolute left-1/2 top-1/2 grid size-[49px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-accent [--icon-scale:0.775] max-lg:-mt-[2.5px] lg:size-[63px] lg:[--icon-scale:1]">
              <AppIcon name="swap" />
            </button>
          </div>
          <div class="rounded-[10px] border border-card-line bg-card px-[9px] pb-[20px] pt-[19.5px] lg:pb-[30px] lg:pl-[30px] lg:pr-[29px] lg:pt-[31.5px]">
            <p class="text-[12px] leading-none font-semibold lg:-ml-px lg:text-[16px] lg:font-medium">{{ side.label }}</p>
            <div class="mt-[9.5px] flex items-start gap-[5px] lg:mt-[17px] lg:gap-[15px]">
              <input type="text" inputmode="decimal" :value="side.amount" :aria-label="side.label" class="h-[40px] min-w-0 flex-1 pl-[10px] text-[13px] font-[450] lg:h-[65px] lg:pl-[18.5px] lg:text-[17px]" :class="slot" />
              <button type="button" class="-mt-px flex h-[41px] w-[103px] items-center justify-between pl-[6px] pr-[4.5px] text-[12px] font-semibold text-muted [--icon-scale:0.89] lg:mt-0 lg:h-[40px] lg:w-[165px] lg:pl-[9px] lg:pr-[9px] lg:text-[16px] lg:font-medium lg:[--icon-scale:1]" :class="slot">
                <span class="text-white">{{ side.currency }}</span>
                <AppIcon name="caret" mobile="caret-sm" />
              </button>
            </div>
            <p class="mt-[9px] text-[10px] font-semibold text-muted lg:mt-[18.5px] lg:text-[14px]" :class="line">
              <span>Balance: {{ side.balance }}</span>
              <span>{{ side.usd }}</span>
            </p>
          </div>
        </template>
      </div>

      <div class="mt-[21px] space-y-[11.5px] rounded-[10px] border border-card-line bg-card py-[14.5px] pl-[10.5px] pr-[9.5px] text-[12px] font-medium lg:info-box lg:mt-[30px] lg:space-y-[18px] lg:rounded-[5px] lg:pb-[25px] lg:pl-[21.5px] lg:pr-[20px] lg:pt-[27px] lg:text-[16px]">
        <p class="max-lg:font-semibold" :class="line">
          <span class="flex items-center gap-[6.5px] [--icon-scale:0.72] lg:gap-[9.5px] lg:[--icon-scale:1]"><AppIcon name="info" class="text-accent" />Exchange Rate</span>
          <span class="lg:text-[18px]">{{ quote.rate }}</span>
        </p>
        <p :class="line">{{ quote.feeLabel }} <span class="lg:text-[18px]">{{ quote.fee }}</span></p>
        <p :class="line">You will receive <span class="text-accent lg:text-[18px]">{{ quote.receive }}</span></p>
      </div>

      <button type="button" class="bg-cta mt-[16px] h-[40px] w-full rounded-[5px] border-[0.5px] border-card-line text-[12px] font-semibold lg:mt-[20px] lg:h-[50px] lg:text-[16px] lg:font-medium">Convert now</button>
    </section>

    <!-- Not drawn on mobile. -->
    <section class="rounded-[10px] border border-line bg-[#02040E] px-[29px] pt-[29px] max-lg:hidden">
      <div class="flex items-start justify-between">
        <h2 :class="heading">Exchange Rates</h2>
        <button type="button" aria-label="Refresh rates" class="-mt-px grid text-muted"><AppIcon name="refresh-light" /></button>
      </div>
      <ul class="mt-[25px] space-y-[15px]">
        <CoinRow v-for="rate in rates" :key="rate.symbol" :coin="rate.coin" :symbol="rate.symbol" :name="rate.name" :detail="rate.price">
          <p class="flex items-center gap-[2.5px] text-[12px] leading-none font-semibold" :class="rate.up ? 'text-accent' : 'text-red'">
            <AppIcon name="arrow-up" class="[--icon-scale:0.58]" :class="{ 'rotate-180': !rate.up }" />
            {{ rate.change }}
          </p>
        </CoinRow>
      </ul>
    </section>
  </div>

  <DataTable
    v-slot="{ row }"
    title="Recent Conversions"
    :columns="columns"
    :rows="conversions"
    :grid="grid"
    class="table-tall mt-[40px] lg:-mb-[12px] lg:-mr-px lg:mt-[30px]"
  >
    <span role="cell" :class="cell">{{ row.from }}</span>
    <span role="cell" :class="cell">{{ row.to }}</span>
    <span role="cell" class="lg:-mt-[4px]" :class="cell">{{ row.amount }}</span>
    <span role="cell" class="lg:-mt-[4px]" :class="cell">{{ row.received }}</span>
    <span role="cell" class="lg:-mt-[2px]" :class="small">{{ row.rate }}</span>
    <span role="cell" class="lg:-mt-[2px]" :class="small">{{ row.time }}</span>
  </DataTable>
</template>
