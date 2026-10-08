<script setup lang="ts">
import type { ActivityStatus } from '../activity'
import { pills } from '../tones'

defineProps<{ status: ActivityStatus }>()
</script>

<template>
  <span class="grid h-[20px] w-[67px] place-items-center rounded-full border-[0.5px] text-[10px] leading-none font-bold max-lg:-mt-[2px] lg:h-[30px] lg:w-[100px] lg:text-[12px]" :class="pills[status]">{{ status }}</span>
</template>
