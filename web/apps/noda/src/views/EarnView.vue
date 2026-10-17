<script setup lang="ts">
import AppIcon from '../components/AppIcon.vue'
import SummaryCard from '../components/SummaryCard.vue'
import CoinRow from '../components/CoinRow.vue'
import ScrollX from '../components/ScrollX.vue'
import DataTable from '../components/DataTable.vue'
import { summary, plans, stakes, rewards, type Stake } from '../placeholders/earn'

// A value's weight, and the lighter one both APY figures are drawn in.
const regular = 'font-semibold lg:font-medium'
const light = 'font-[550] lg:font-[450]'

const fields: { label: string; key: keyof Stake; look: string }[] = [
  { label: 'APY',         key: 'apy',      look: `text-green ${light}` },
  { label: 'Earned',      key: 'earned',   look: `text-accent ${regular}` },
  { label: 'Duration',    key: 'duration', look: regular },
  { label: 'Unlock Date', key: 'unlock',   look: regular },
]

const columns = ['Currency', 'Amount', 'USD Value', 'Type', 'Date']
// Only the first two columns are drawn on mobile; the widths of the others are not from the design.
const grid = 'grid-cols-[87px_173px_87px_120px_80px] lg:min-w-[900px] lg:grid-cols-[285fr_277.5fr_293fr_258.5fr_235fr]'

const heading = 'text-[18px] leading-none font-medium lg:font-semibold'
const box = 'h-[40px] rounded-[5px] border-[0.5px] border-slot-line bg-slot pt-[7px] lg:h-[65px] lg:bg-card lg:light:border-card-line lg:light:shadow-(--shadow-card) lg:pt-[12px]'
// One text line high, so the padlock (taller than the text) does not push the value down.
const label = 'flex h-[10px] items-center text-[10px] leading-none font-semibold text-muted [--icon-scale:0.84] lg:h-[12px] lg:text-[12px] lg:tracking-normal lg:[--icon-scale:1]'
const value = 'mt-[4.5px] text-[12px] leading-none lg:mt-[9.5px] lg:text-[18px] lg:tracking-[0.005em]'
const cell = 'text-[12px] font-semibold lg:text-[16px] lg:font-medium'
const small = 'text-[12px] font-semibold lg:text-[14px] lg:font-medium'
</script>

<template>
  <div class="mt-[19px] grid grid-cols-1 gap-[15px] sm:grid-cols-2 lg:-mr-px lg:mt-[24px] lg:grid-cols-4">
    <SummaryCard v-for="item in summary" :key="item.label" :item="item" plain />
  </div>

  <h2 class="mt-[35.5px] text-[18px] leading-none font-medium lg:mt-[51px] lg:text-[25px] lg:font-semibold lg:tracking-normal">Staking Plans</h2>
  <ul class="mt-[22.5px] grid gap-[22px] lg:mt-[26px] lg:grid-cols-2 lg:gap-[30px]">
    <li
      v-for="plan in plans"
      :key="plan.name"
      class="card rounded-[10px] px-[9px] pb-[28px] pt-[20px] lg:panel lg:px-[29px] lg:pb-[29px] lg:pt-[29.5px]"
    >
      <!-- Floated, so a name or description that reaches it wraps instead of running under it. -->
      <span v-if="plan.recommended" class="bg-tag float-right -mt-[7px] ml-[10px] mr-[5px] grid h-[24.5px] w-[97px] place-items-center rounded-[10px] border-[0.5px] border-accent text-[10px] leading-none font-semibold text-accent lg:-mt-[0.5px] lg:mr-0 lg:h-[36px] lg:w-[140px] lg:text-[14px] lg:font-medium">Recommended</span>
      <h3 class="text-[16px] leading-none font-medium lg:text-[18px] lg:font-semibold lg:tracking-[0.005em]">{{ plan.name }}</h3>
      <p class="mt-[12.5px] text-[12px] leading-none font-semibold tracking-[0.002em] text-muted lg:mt-[13px] lg:text-[16px] lg:font-medium lg:tracking-[0.006em]">{{ plan.description }}</p>

      <!-- The mobile design draws the first box wider than the second. -->
      <div class="mt-[29.5px] grid grid-cols-[135fr_130fr] gap-x-[15px] gap-y-[10px] lg:mt-[28.5px] lg:grid-cols-2 lg:gap-y-[15px]">
        <div class="pl-[10px] lg:pl-[15.5px]" :class="box">
          <p class="gap-[8.5px] lg:gap-[6.5px]" :class="label"><AppIcon name="percent" />APY</p>
          <p class="text-accent" :class="[value, light]">{{ plan.apy }}</p>
        </div>
        <div class="pl-[7.5px] lg:pl-[19.5px]" :class="box">
          <p class="gap-[2.5px] lg:gap-[3.5px]" :class="label"><AppIcon name="lock" class="max-lg:-mt-[2px]" />Lock Period</p>
          <p :class="[value, regular]">{{ plan.lock }}</p>
        </div>
        <div class="col-span-2 pl-[7.5px] lg:pl-[14.5px]" :class="box">
          <p :class="label">Minimum Amount</p>
          <p :class="[value, regular]">{{ plan.minimum }} {{ plan.currency }}</p>
        </div>
      </div>

      <ul class="mt-[15px] space-y-[10px] lg:mt-[20px] lg:space-y-[20px]">
        <li v-for="feature in plan.features" :key="feature" class="flex items-center text-[12px] leading-none font-semibold text-muted [--icon-scale:0.818] lg:text-[16px] lg:font-medium lg:[--icon-scale:1]">
          <AppIcon name="check" class="text-accent" />
          <span class="ml-[7.5px] lg:ml-[12px]">{{ feature }}</span>
        </li>
      </ul>

      <button type="button" class="button-outline mt-[20px] h-[40px] w-full rounded-[5px] text-[12px] font-semibold lg:h-[50px] lg:text-[16px] lg:font-medium">Stake {{ plan.currency }}</button>
    </li>
  </ul>

  <!-- A card on desktop; on mobile its content stands on the page and the rows scroll sideways. -->
  <section class="mt-[32px] lg:mt-[30px] lg:panel lg:rounded-[10px] lg:px-[29px] lg:pb-[29px] lg:pt-[28.5px]">
    <h2 :class="heading">Recent Deposits</h2>
    <ScrollX class="mt-[21.5px] lg:mt-[30.5px] lg:light:-mx-[8px] lg:light:-mb-[8px]">
      <!-- Light only: padded and pulled back out, so the rows' shadows are not clipped by the scroller. -->
      <ul class="w-max min-w-full space-y-[10px] pb-[7px] lg:space-y-[20px] lg:pb-0 lg:light:px-[8px] lg:light:pb-[8px]">
        <CoinRow
          v-for="stake in stakes"
          :key="stake.amount"
          :coin="stake.coin"
          :symbol="stake.amount"
          name=""
          :detail="stake.usd"
          class="relative min-w-[593px] lg:min-w-0"
        >
          <!-- Placed from the row's edges, so the columns line up whatever the amount's width. -->
          <!-- Only APY and Earned are drawn on mobile; the widths of the rest are not from the design. -->
          <div class="absolute inset-y-0 left-[156px] right-[13px] grid grid-cols-[84fr_84fr_84fr_94fr_76px] items-center lg:left-[264px] lg:right-[19px] lg:grid-cols-[220fr_235fr_243fr_231fr_106px]">
            <div v-for="field in fields" :key="field.key" class="self-start pt-[12.5px] lg:pt-[18.5px]">
              <p class="text-[12px] leading-none font-semibold text-muted">{{ field.label }}</p>
              <p class="mt-[11.5px] text-[12px] leading-none lg:mt-[18.5px] lg:text-[16px]" :class="field.look">{{ stake[field.key] }}</p>
            </div>
            <button type="button" class="bg-manage h-[32px] rounded-[10px] border border-card-line text-[10px] font-semibold light:border-transparent light:text-white lg:h-[45px] lg:text-[14px]">Manage</button>
          </div>
        </CoinRow>
      </ul>
    </ScrollX>
  </section>

  <DataTable
    v-slot="{ row }"
    title="Recent Rewards"
    :columns="columns"
    :rows="rewards"
    :grid="grid"
    class="table-tall -mb-px mt-[45.5px] lg:-mb-[10px] lg:mt-[30px] lg:[--table-foot:7.5px]!"
  >
    <span role="cell" :class="cell">{{ row.currency }}</span>
    <span role="cell" :class="cell">{{ row.amount }}</span>
    <span role="cell" class="lg:-mt-[4px]" :class="cell">{{ row.usd }}</span>
    <span role="cell" class="lg:-mt-[2px]" :class="small">{{ row.type }}</span>
    <span role="cell" class="lg:-mt-[2px]" :class="small">{{ row.date }}</span>
  </DataTable>
</template>
