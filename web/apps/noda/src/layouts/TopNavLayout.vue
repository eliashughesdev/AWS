<script setup lang="ts">
// Unstyled on purpose: the header and tab bar are built from the Figma design next.
const tabs = [
  { name: 'dashboard',    label: 'Dashboard' },
  { name: 'accounts',     label: 'Accounts' },
  { name: 'deposit',      label: 'Deposit' },
  { name: 'withdraw',     label: 'Withdraw' },
  { name: 'convert',      label: 'Convert' },
  { name: 'payments',     label: 'Payments' },
  { name: 'earn',         label: 'Earn' },
  { name: 'transactions', label: 'Transactions' },
]
</script>

<template>
  <nav class="flex flex-wrap gap-4 p-4">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.name"
      :to="{ name: tab.name }"
      active-class="underline"
    >
      {{ tab.label }}
    </RouterLink>
  </nav>
  <main class="p-4">
    <RouterView />
  </main>
</template>
