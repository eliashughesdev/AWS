<script setup lang="ts">
// Not in Figma: what a list shows in place of its rows while it loads, when it is empty and
// when it could not be read. The frame around it is the host's. The slot takes an action.
defineProps<{ title: string; text?: string; kind?: 'loading' | 'error' }>()
</script>

<template>
  <div
    class="flex flex-col items-center px-[14px] py-[50px] text-center lg:py-[70px]"
    :class="{ 'list-state-loading': kind === 'loading' }"
    :role="kind === 'error' ? 'alert' : 'status'"
  >
    <p class="text-[16px] leading-none font-medium lg:text-[18px] lg:font-semibold" :class="{ 'text-muted': kind === 'loading' }">{{ title }}</p>
    <p v-if="text" class="mt-[12px] text-[12px] leading-[16px] font-semibold text-muted lg:text-[14px] lg:leading-[18px]">{{ text }}</p>
    <div v-if="$slots.default" class="mt-[22px]"><slot /></div>
  </div>
</template>

<style>
/* A read that answers at once never shows "loading". */
.list-state-loading {
  animation: list-state-appear 0.2s 0.3s both;
}

@keyframes list-state-appear {
  from { opacity: 0; }
}
</style>
