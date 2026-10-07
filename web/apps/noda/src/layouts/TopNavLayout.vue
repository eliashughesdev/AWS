<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import type { IconName } from '../icons'
import logoMark from '../assets/logo-mark.png'
import logoWordmark from '../assets/logo-wordmark.png'
import flagUs from '../assets/flag-us.png'

const tabs: { name: string; label: string; icon: IconName }[] = [
  { name: 'dashboard',    label: 'Dashboard',    icon: 'dashboard' },
  { name: 'accounts',     label: 'Accounts',     icon: 'accounts' },
  { name: 'deposit',      label: 'Deposit',      icon: 'deposit' },
  { name: 'withdraw',     label: 'Withdraw',     icon: 'withdraw' },
  { name: 'convert',      label: 'Convert',      icon: 'convert' },
  { name: 'payments',     label: 'Payments',     icon: 'payments' },
  { name: 'earn',         label: 'Earn',         icon: 'earn' },
  { name: 'transactions', label: 'Transactions', icon: 'transactions' },
]

const route = useRoute()
const menuOpen = ref(false)
watch(() => route.fullPath, () => { menuOpen.value = false })
</script>

<template>
  <header class="flex h-[53px] items-start px-[10px] pt-[11px] lg:h-[85px] lg:border-b lg:border-line lg:px-[30px] lg:pt-[22px]">
    <RouterLink :to="{ name: 'dashboard' }" class="mt-[5px] flex items-center gap-[6px] lg:mt-[11px] lg:gap-[7.5px]">
      <img :src="logoMark" alt="" class="h-[20px] lg:h-[25px]" />
      <img :src="logoWordmark" alt="NODA" class="h-[17px] w-[72px] lg:h-[21px] lg:w-[90px]" />
    </RouterLink>

    <div class="ml-auto flex h-[31px] items-center text-muted lg:h-[36px]">
      <!-- Language, theme, notifications and settings are placeholders. -->
      <RouterLink
        :to="{ name: 'coming-soon' }"
        class="flex h-[36px] w-[126px] items-center rounded-[10px] border border-outline px-[9px] max-lg:hidden"
      >
        <AppIcon name="translate" />
        <img :src="flagUs" alt="" class="ml-[8px] h-[11px] w-[14px]" />
        <span class="ml-[4px] text-[12px] font-semibold text-white">English</span>
        <AppIcon name="chevron-down" class="ml-auto" />
      </RouterLink>

      <RouterLink
        :to="{ name: 'coming-soon' }"
        aria-label="Theme"
        class="flex h-[31px] items-center gap-[5px] rounded-[10px] border border-outline px-[13px] pb-[2px] [--icon-scale:0.86] lg:ml-[15px] lg:h-[36px] lg:gap-[8px] lg:px-[15px] lg:pb-px lg:[--icon-scale:1]"
      >
        <AppIcon name="sun" />
        <span class="flex h-[15px] w-[30px] items-center justify-end rounded-full bg-accent p-px lg:h-[17px] lg:w-[33px]">
          <span class="size-[13px] rounded-full bg-white lg:size-[15px]" />
        </span>
        <AppIcon name="moon" class="text-accent max-lg:ml-px" />
      </RouterLink>

      <RouterLink :to="{ name: 'coming-soon' }" aria-label="Notifications" class="-my-[10px] -mr-[10px] ml-[19px] flex p-[10px] max-lg:hidden">
        <AppIcon name="bell" />
      </RouterLink>
      <RouterLink :to="{ name: 'coming-soon' }" aria-label="Settings" class="-my-[10px] -mr-[10px] ml-[18px] flex p-[10px] max-lg:hidden">
        <AppIcon name="settings" />
      </RouterLink>

      <span class="bg-avatar mb-[2px] ml-[15px] grid size-[25px] place-items-center rounded-full text-[12px] font-medium text-white lg:mb-px lg:ml-[29px] lg:size-[33px] lg:text-[18px]">S</span>
    </div>
  </header>

  <nav class="bg-tabbar flex h-[60px] max-lg:hidden">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.name"
      :to="{ name: tab.name }"
      class="flex flex-1 items-center justify-center gap-[8px] border-b-2 border-transparent pt-px text-[16px] font-semibold text-muted"
      active-class="bg-tab-active border-accent! text-accent!"
    >
      <AppIcon :name="tab.icon" />
      {{ tab.label }}
    </RouterLink>
  </nav>

  <div class="relative">
    <div class="flex min-h-[61px] items-start px-[10px] pt-[8.5px] lg:min-h-[110px] lg:px-[30px] lg:pt-[47px]">
      <!-- The mobile design draws the heading higher on pages with a subtitle. -->
      <div :class="{ 'max-lg:-mt-[6.5px]': route.meta.subtitle }">
        <h1 class="text-[20px] leading-[30px] font-semibold lg:text-[30px] lg:leading-[36px]">{{ route.meta.title }}</h1>
        <p v-if="route.meta.subtitle" class="mt-[4px] text-[12px] leading-none font-semibold tracking-[0.004em] text-muted lg:mt-[7.5px]">{{ route.meta.subtitle }}</p>
      </div>
      <button
        type="button"
        aria-label="Menu"
        :aria-expanded="menuOpen"
        class="-mt-[6px] ml-auto flex h-[44px] w-[40px] flex-col justify-center gap-[5px] lg:hidden"
        @click="menuOpen = !menuOpen"
      >
        <span v-for="n in 3" :key="n" class="h-px bg-muted" />
      </button>
    </div>

    <!-- Where a view's PageAction lands: under the heading on mobile, beside it on desktop. -->
    <div id="page-action" class="px-[10px] lg:absolute lg:right-[30px] lg:top-[50px] lg:px-0" />

    <!-- Not in Figma: the desktop tabs, stacked. Opens below the subtitle when the page has one. -->
    <nav v-if="menuOpen" class="bg-tabbar absolute inset-x-0 z-10 lg:hidden" :class="route.meta.subtitle ? 'top-[61px]' : 'top-[49px]'">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.name"
        :to="{ name: tab.name }"
        class="flex h-[48px] items-center gap-[8px] border-b-2 border-transparent px-[10px] text-[16px] font-semibold text-muted"
        active-class="bg-tab-active border-accent! text-accent!"
      >
        <span class="flex w-[22px] justify-center"><AppIcon :name="tab.icon" /></span>
        {{ tab.label }}
      </RouterLink>
    </nav>
  </div>

  <!-- Grows, so the footer sits at the bottom of the window on a short page. -->
  <main class="flex-1 px-[10px] lg:px-[30px]">
    <RouterView />
  </main>

  <footer class="px-[10px] py-[21px] text-[10px] leading-none font-semibold text-muted lg:px-[30px] lg:pb-[23px] lg:pt-[31px]">
    NodabaseStaging©2025
  </footer>
</template>
