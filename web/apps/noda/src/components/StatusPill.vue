<script setup lang="ts">
import type { Status } from '../placeholders/transactions'

defineProps<{ status: Status }>()

const looks = {
  Completed: 'border-accent bg-accent-dim text-accent',
  Pending:   'border-yellow bg-yellow-dim text-yellow',
}
</script>

<template>
  <span class="grid h-[30px] w-[100px] place-items-center rounded-full border-[0.5px] text-[12px] leading-none font-bold" :class="looks[status]">{{ status }}</span>
</template>
