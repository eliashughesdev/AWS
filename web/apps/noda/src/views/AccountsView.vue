<script setup lang="ts">
import PageAction from '../components/PageAction.vue'
import AccountCard from '../components/AccountCard.vue'
import { accounts } from '../placeholders/accounts'
</script>

<template>
  <PageAction>
    <button type="button" class="bg-cta mt-[13px] h-[32px] w-[100px] rounded-[7.5px] text-[10px] font-semibold lg:mt-0 lg:h-[40px] lg:w-[128px] lg:rounded-[10px] lg:text-[14px] lg:font-medium">+ New Account</button>
  </PageAction>

  <div class="mt-[20px] grid grid-cols-1 gap-[15px] sm:grid-cols-2 lg:-ml-px lg:-mr-[2px] lg:mb-[67px] lg:mt-[24px] lg:grid-cols-3">
    <AccountCard v-for="account in accounts" :key="account.name" :account="account" />
  </div>
</template>
