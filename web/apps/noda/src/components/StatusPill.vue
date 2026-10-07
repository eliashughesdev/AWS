<script setup lang="ts">
import type { Status } from '../placeholders/transactions'

defineProps<{ status: Status }>()

const looks = {
  Completed: 'border-accent bg-accent-dim text-accent',
  Pending:   'border-yellow bg-yellow-dim text-yellow',
}
</script>

<template>
  <span class="grid h-[20px] w-[67px] place-items-center rounded-full border-[0.5px] text-[10px] leading-none font-bold max-lg:-mt-[2px] lg:h-[30px] lg:w-[100px] lg:text-[12px]" :class="looks[status]">{{ status }}</span>
</template>
