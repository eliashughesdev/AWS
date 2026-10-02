<script setup lang="ts">
import { brand } from '../brands'

// wordmark: header/sidebar lockup. mark: standalone badge on the auth screen.
// A brand with a logoSrc uses the image for both; one without falls back to
// its name as text, or to its material symbol in a bordered box.
withDefaults(
  defineProps<{ variant?: 'wordmark' | 'mark'; size?: 'sm' | 'md' | 'lg' }>(),
  { variant: 'wordmark', size: 'md' },
)

const imageSize = { sm: 'h-6', md: 'h-7', lg: 'h-9' }
const textSize = { sm: 'text-[18px]', md: 'text-[20px]', lg: 'text-[24px]' }
</script>

<template>
  <img
    v-if="brand.logoSrc"
    :src="brand.logoSrc"
    :alt="brand.name"
    :class="[imageSize[size], 'w-auto']"
  />

  <div
    v-else-if="variant === 'mark'"
    class="h-12 w-12 rounded-xl bg-surface-2 border border-border-subtle
           flex items-center justify-center text-brand"
    aria-hidden="true"
  >
    <span class="material-symbols-outlined" style="font-size: 24px;">{{ brand.icon }}</span>
  </div>

  <span v-else :class="[textSize[size], 'font-semibold leading-snug text-brand']">
    {{ brand.name }}
  </span>
</template>
