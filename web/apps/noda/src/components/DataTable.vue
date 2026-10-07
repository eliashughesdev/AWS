<script setup lang="ts" generic="Row">
import ScrollX from './ScrollX.vue'

// A titled card with a table that scrolls sideways when it does not fit.
// `grid` is the grid-cols classes (and any min-width) the header and every row share; the slot draws one row's cells.
defineProps<{ title: string; columns: string[]; rows: Row[]; grid: string }>()
</script>

<template>
  <section class="rounded-[10px] border border-line bg-[#02040E] pb-[6px] pt-[29.5px] lg:pb-[20px] lg:pt-[28.5px]">
    <h2 class="pl-[14px] text-[18px] leading-none font-medium lg:pl-[29px] lg:font-semibold">{{ title }}</h2>

    <ScrollX class="mt-[26.5px] lg:mt-[56px]">
      <div role="table" class="w-max min-w-full">
        <div role="row" class="grid border-line px-[14px] text-[12px] leading-none font-semibold text-muted lg:border-b lg:pb-[13.5px] lg:pl-[29px] lg:pr-0 lg:text-[14px]" :class="grid">
          <span v-for="column in columns" :key="column" role="columnheader">{{ column }}</span>
        </div>
        <div role="rowgroup" class="mt-[7px]">
          <div v-for="(row, index) in rows" :key="index" role="row" class="grid h-[53px] items-center px-[14px] lg:h-[50px] lg:pl-[29px] lg:pr-0" :class="grid">
            <slot :row="row" />
          </div>
        </div>
      </div>
    </ScrollX>
  </section>
</template>
