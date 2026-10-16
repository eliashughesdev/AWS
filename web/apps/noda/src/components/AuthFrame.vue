<script setup lang="ts">
import AppFooter from './AppFooter.vue'
import logoMark from '../assets/logo-mark.png'
import logoWordmark from '../assets/logo-wordmark.png'

// Not in Figma: the page of the screens a visitor sees without a session (sign-in, the two
// emailed links). The header's logo, the layout's page heading, a panel and the layout's footer.
// The default slot fills the panel; `after` goes under it.
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <div class="flex flex-1 flex-col">
    <main class="mx-auto flex w-full max-w-[470px] flex-1 flex-col justify-center px-[10px] py-[40px] lg:py-[60px]">
      <div class="flex items-center justify-center gap-[7.5px]">
        <img :src="logoMark" alt="" class="h-[25px]" />
        <img :src="logoWordmark" alt="NODA" class="h-[21px] w-[90px] light:invert" />
      </div>

      <header class="mt-[30px] text-center lg:mt-[40px]">
        <h1 class="text-[20px] leading-[30px] font-semibold lg:text-[30px] lg:leading-[36px]">{{ title }}</h1>
        <p v-if="subtitle" class="mt-[3px] text-[12px] leading-[14px] font-semibold text-muted lg:mt-[7.5px] lg:leading-none">{{ subtitle }}</p>
      </header>

      <section class="panel mt-[20px] rounded-[10px] px-[14px] pb-[29px] pt-[20px] lg:mt-[30px] lg:p-[29px]">
        <slot />
      </section>

      <slot name="after" />
    </main>

    <AppFooter />
  </div>
</template>
