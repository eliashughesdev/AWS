<script setup lang="ts">
import { useRoute } from 'vue-router'

defineProps<{
  displayName: string
  userEmail: string
}>()

const emit = defineEmits<{ signOut: [] }>()

const route = useRoute()

const navItems = [
  { name: 'dashboard',  icon: 'dashboard',       label: 'Dashboard'        },
  { name: 'cards',      icon: 'credit_card',      label: 'Payment Methods'  },
  { name: 'operations', icon: 'account_balance',  label: 'Operations'       },
  { name: 'ledger',     icon: 'receipt_long',     label: 'Ledger'           },
  { name: 'settings',   icon: 'settings',         label: 'Settings'         },
]
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-[#0A0B0D] text-white">

    <!-- ── Sidebar ───────────────────────────────────────────────────────────── -->
    <aside class="hidden md:flex flex-col h-screen p-4 gap-2 bg-[#1a1d10] border-r border-white/[0.08] w-64 shrink-0">
      <div class="px-2 py-4">
        <span class="text-[18px] font-semibold leading-snug text-[#CCFF00]">Loudibly</span>
        <p class="text-[10px] uppercase tracking-widest text-[#52525B] mt-1 font-bold">Institutional Access</p>
      </div>

      <nav class="flex-1 flex flex-col gap-1 mt-6">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex items-center gap-3 px-3 py-2 transition-all"
          :class="route.name === item.name
            ? 'bg-[#464749] text-[#CCFF00] font-bold border-r-2 border-[#CCFF00]'
            : 'text-[#A1A1AA] hover:text-white hover:bg-[#282b1d]'"
        >
          <span class="material-symbols-outlined">{{ item.icon }}</span>
          <span class="font-['JetBrains_Mono'] text-[13px]">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <button class="mt-4 bg-[#CCFF00] text-[#0A0B0D] font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 active:scale-95 transition-transform">
        <span class="material-symbols-outlined text-sm">add</span>
        <span class="font-['JetBrains_Mono'] text-[13px]">New Transaction</span>
      </button>

      <div class="mt-auto border-t border-white/[0.08] pt-4 flex flex-col gap-1">
        <a class="flex items-center gap-3 px-3 py-2 text-[#A1A1AA] hover:text-white transition-all" href="#">
          <span class="material-symbols-outlined">help</span>
          <span class="font-['JetBrains_Mono'] text-[13px]">Help</span>
        </a>
        <div class="flex items-center gap-3 px-3 py-4 mt-2">
          <div class="w-8 h-8 rounded-full bg-[#282b1d] border border-white/[0.08] flex items-center justify-center">
            <span class="material-symbols-outlined text-sm">person</span>
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-bold truncate">{{ displayName }}</span>
            <span class="text-[10px] text-[#52525B] truncate">{{ userEmail }}</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- ── Main ─────────────────────────────────────────────────────────────── -->
    <main class="flex-1 flex flex-col overflow-y-auto">

      <!-- TopAppBar -->
      <header class="flex justify-between items-center px-8 h-16 w-full border-b border-white/[0.08] sticky top-0 bg-[#0A0B0D]/80 backdrop-blur-md z-10">
        <div class="md:hidden text-[24px] font-semibold text-white">Loudibly</div>
        <div></div>
        <button @click="emit('signOut')" class="text-[#A1A1AA] hover:text-white text-[14px] transition-colors">
          Logout
        </button>
      </header>

      <slot />

    </main>
  </div>

  <!-- Mobile FAB -->
  <button class="md:hidden fixed bottom-8 right-8 w-14 h-14 bg-[#CCFF00] text-[#0A0B0D] rounded-full shadow-2xl flex items-center justify-center active:scale-95 transition-transform z-50">
    <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">add</span>
  </button>
</template>
