<script setup lang="ts">
import type { ActivityStatus } from '../activity'

defineProps<{ status: ActivityStatus }>()

// "Failed" is not from the design: ActivityItem's colours.
const looks = {
  Completed: 'border-accent bg-accent-dim text-accent',
  Pending:   'border-yellow bg-yellow-dim text-yellow',
  Failed:    'border-red bg-red-dim text-red',
}
</script>

<template>
  <span class="grid h-[20px] w-[67px] place-items-center rounded-full border-[0.5px] text-[10px] leading-none font-bold max-lg:-mt-[2px] lg:h-[30px] lg:w-[100px] lg:text-[12px]" :class="looks[status]">{{ status }}</span>
</template>
