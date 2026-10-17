<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getRole } from '@loudibly/core/auth/role'
import BrandLogo from '../components/BrandLogo.vue'
import { brand } from '../brands'

const props = withDefaults(defineProps<{
  displayName: string
  userEmail: string
  nonCustodial?: boolean
}>(), { nonCustodial: false })

const emit = defineEmits<{ signOut: [] }>()

const route  = useRoute()
const router = useRouter()

// Only decides whether the link is shown: the route's guard and the API check the role themselves.
const isStaff = ref(false)
onMounted(async () => {
  if (props.nonCustodial) return
  isStaff.value = await getRole().catch(() => undefined) === 'staff'
})

// Payment Methods and the deposit shortcut are card/fiat features — they need a
// Cognito token, so they are hidden from anonymous non-custodial sessions.
const navItems = computed(() => {
  if (props.nonCustodial) {
    return [
      { name: 'wallet',         icon: 'account_balance_wallet', label: 'Wallet'  },
      { name: 'wallet-send',    icon: 'send',                   label: 'Send'    },
      { name: 'wallet-receive', icon: 'qr_code_2',              label: 'Receive' },
      { name: 'wallet-ledger',  icon: 'receipt_long',           label: 'Ledger'  },
    ]
  }
  return [
    { name: 'dashboard',  icon: 'dashboard',       label: 'Dashboard'        },
    { name: 'cards',      icon: 'credit_card',      label: 'Payment Methods'  },
    { name: 'transfer',   icon: 'compare_arrows',   label: 'Transfer'         },
    { name: 'ledger',     icon: 'receipt_long',     label: 'Ledger'           },
    ...(isStaff.value ? [{ name: 'merchants', icon: 'storefront', label: 'Merchants' }] : []),
  ]
})
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-page text-white">

    <!-- ── Sidebar ───────────────────────────────────────────────────────────── -->
    <aside class="hidden md:flex flex-col h-screen p-4 gap-2 bg-surface-1 border-r border-border-subtle w-64 shrink-0">
      <div class="px-2 py-4">
        <BrandLogo variant="wordmark" size="md" />
        <p class="text-[10px] uppercase tracking-widest text-text-muted mt-2 font-bold">{{ brand.tagline }}</p>
      </div>

      <nav class="flex-1 flex flex-col gap-1 mt-6">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex items-center gap-3 px-3 py-2 transition-all"
          :class="route.name === item.name
            ? 'bg-brand/10 text-brand font-bold border-r-2 border-brand'
            : 'text-text-secondary hover:text-white hover:bg-surface-2'"
        >
          <span class="material-symbols-outlined">{{ item.icon }}</span>
          <span class="font-['JetBrains_Mono'] text-[13px]">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <button v-if="!nonCustodial" @click="router.push({ name: 'deposit' })" class="mt-4 bg-brand text-on-brand font-bold py-2 px-4 rounded-full flex items-center justify-center gap-2 hover:bg-brand-hover active:scale-95 transition-all">
        <span class="material-symbols-outlined text-sm">add</span>
        <span class="font-['JetBrains_Mono'] text-[13px]">New Transaction</span>
      </button>

      <div class="mt-auto border-t border-border-subtle pt-4 flex flex-col gap-1">
        <a class="flex items-center gap-3 px-3 py-2 text-text-secondary hover:text-white transition-all" href="#">
          <span class="material-symbols-outlined">help</span>
          <span class="font-['JetBrains_Mono'] text-[13px]">Help</span>
        </a>
        <div class="flex items-center gap-3 px-3 py-4 mt-2">
          <div class="w-8 h-8 rounded-full bg-surface-2 border border-border-subtle flex items-center justify-center">
            <span class="material-symbols-outlined text-sm">{{ nonCustodial ? 'key' : 'person' }}</span>
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-bold truncate">{{ displayName }}</span>
            <span class="text-[10px] text-text-muted truncate">
              {{ nonCustodial ? 'Anonymous · keys in this session only' : userEmail }}
            </span>
          </div>
        </div>
      </div>
    </aside>

    <!-- ── Main ─────────────────────────────────────────────────────────────── -->
    <main class="flex-1 flex flex-col overflow-y-auto">

      <!-- TopAppBar -->
      <header class="flex justify-between items-center px-8 h-16 w-full border-b border-border-subtle sticky top-0 bg-page/80 backdrop-blur-md z-10">
        <BrandLogo class="md:hidden" variant="wordmark" size="sm" />
        <div></div>
        <button @click="emit('signOut')" class="text-text-secondary hover:text-white text-[14px] transition-colors">
          Logout
        </button>
      </header>

      <slot />

    </main>
  </div>

  <!-- Mobile FAB -->
  <button class="md:hidden fixed bottom-8 right-8 w-14 h-14 bg-brand text-on-brand rounded-full shadow-2xl flex items-center justify-center active:scale-95 transition-transform z-50">
    <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">add</span>
  </button>
</template>
