<script setup lang="ts" generic="Row">
import ScrollX from './ScrollX.vue'

// A titled card with a table that scrolls sideways when it does not fit.
// `grid` is the grid-cols classes (and any min-width) the header and every row share; the slot draws one row's cells.
// The `tools` slot holds controls for the right end of the title's line. The `after` slot holds what
// follows the rows or stands in for them (a list state, a button for more); it does not scroll sideways.
// On desktop the designs space each table a little differently. A view can set --table-title (font size),
// --table-head-gap (space above the header row), --table-rows-gap (space under its line), --table-row
// (row height) and --table-foot (space under the last row).
defineProps<{ title: string; columns: string[]; rows: Row[]; grid: string }>()
</script>

<template>
  <section class="rounded-[10px] border border-line bg-[#02040E] pb-[23.5px] pt-[29.5px] lg:pb-[var(--table-foot,20px)] lg:pt-[28.5px]">
    <div class="relative">
      <h2 class="pl-[14px] text-[18px] leading-none font-medium lg:pl-[29px] lg:text-[length:var(--table-title,18px)] lg:font-semibold">{{ title }}</h2>
      <!-- They take no room, so the table keeps its height. -->
      <div v-if="$slots.tools" class="absolute right-[14px] top-0 lg:right-[29px]"><slot name="tools" /></div>
    </div>

    <ScrollX class="mt-[26.5px] lg:mt-[var(--table-head-gap,56px)]">
      <div role="table" class="w-max min-w-full">
        <div role="row" class="grid border-line px-[14px] text-[12px] leading-none font-semibold text-muted lg:border-b lg:pb-[13.5px] lg:pl-[29px] lg:pr-0 lg:text-[14px]" :class="grid">
          <span v-for="column in columns" :key="column" role="columnheader">{{ column }}</span>
        </div>
        <div role="rowgroup" class="mt-[7px] lg:mt-[var(--table-rows-gap,7px)]">
          <div v-for="(row, index) in rows" :key="index" role="row" class="grid h-[53px] items-center px-[14px] lg:h-[var(--table-row,50px)] lg:pl-[29px] lg:pr-0" :class="grid">
            <slot :row="row" :index="index" />
          </div>
        </div>
      </div>
    </ScrollX>
    <slot name="after" />
  </section>
</template>
