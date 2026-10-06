<script setup lang="ts">
import { computed } from 'vue'
import { icons, type IconName } from '../icons'

// `mobile` names a second cut of the icon to draw below the desktop breakpoint.
const props = defineProps<{ name: IconName; mobile?: IconName }>()

const style = computed(() => {
  const lg = icons[props.name]
  const sm = icons[props.mobile ?? props.name]
  return {
    '--w': `${lg.w}px`, '--h': `${lg.h}px`, '--src': `url(${lg.src})`,
    '--w-sm': `${sm.w}px`, '--h-sm': `${sm.h}px`, '--src-sm': `url(${sm.src})`,
  }
})
</script>

<template>
  <span class="app-icon inline-block shrink-0 bg-current" :style="style" />
</template>

<style>
/* Drawn as a mask, so the icon takes the text colour. An ancestor can resize it with --icon-scale. */
.app-icon {
  width: calc(var(--w-sm) * var(--icon-scale, 1));
  height: calc(var(--h-sm) * var(--icon-scale, 1));
  mask: var(--src-sm) center / 100% 100% no-repeat;
}

/* Tailwind's lg breakpoint */
@media (min-width: 64rem) {
  .app-icon {
    width: calc(var(--w) * var(--icon-scale, 1));
    height: calc(var(--h) * var(--icon-scale, 1));
    mask-image: var(--src);
  }
}
</style>
