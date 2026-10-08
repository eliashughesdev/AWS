<script setup lang="ts">
// A coin: its mark and a 1px ring in the tone's ink, on the tone's disc. Light draws no ring.
import type { CoinArt } from '../coins'

defineProps<{ coin: CoinArt }>()
</script>

<template>
  <span class="inline-block shrink-0 rounded-full ring-1 ring-inset light:ring-0" :class="coin.tone">
    <span class="block size-full bg-current" :style="{ mask: `url(${coin.mark}) center / 100% 100% no-repeat` }" />
  </span>
</template>
