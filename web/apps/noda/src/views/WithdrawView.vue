<script setup lang="ts">
import PageAction from '../components/PageAction.vue'

const tab = 'grid h-full place-items-center rounded-[10px] pb-[3px] lg:pb-[2px]'
</script>

<template>
  <PageAction>
    <nav class="bg-account mt-[4px] grid h-[40px] w-[162px] grid-cols-[82px_1fr] rounded-[10px] text-[12px] font-semibold text-muted shadow-[inset_0_0_0_1px_var(--color-card-line)] lg:mt-[9px] lg:h-[45px] lg:w-[180px] lg:grid-cols-2 lg:text-[14px]">
      <RouterLink :to="{ name: 'withdraw' }" :class="tab" exact-active-class="bg-toggle-active text-accent">Withdraw</RouterLink>
      <RouterLink :to="{ name: 'withdraw-history' }" class="lg:pr-[5px]" :class="tab" exact-active-class="bg-toggle-active text-accent">History</RouterLink>
    </nav>
  </PageAction>

  <RouterView />
</template>
