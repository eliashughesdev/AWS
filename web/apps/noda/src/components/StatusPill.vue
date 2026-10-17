<script setup lang="ts">
import { pills, type PillStatus } from '../tones'

defineProps<{ status: PillStatus }>()
</script>

<template>
  <span class="grid h-[20px] w-[67px] place-items-center rounded-full border-[0.5px] text-[10px] leading-none font-bold max-lg:-mt-[2px] lg:h-[30px] lg:w-[100px] lg:text-[12px]" :class="pills[status]">{{ status }}</span>
</template>
