<script setup lang="ts">
import { computed } from 'vue'
import { icons, type IconName } from '../icons'

const props = defineProps<{ name: IconName }>()

// Drawn as a mask, so the icon takes the text colour. An ancestor can shrink it
// with --icon-scale (the mobile header uses smaller icons).
const style = computed(() => {
  const { src, w, h } = icons[props.name]
  return {
    width: `calc(${w}px * var(--icon-scale, 1))`,
    height: `calc(${h}px * var(--icon-scale, 1))`,
    mask: `url(${src}) center / 100% 100% no-repeat`,
  }
})
</script>

<template>
  <span class="inline-block shrink-0 bg-current" :style="style" />
</template>
