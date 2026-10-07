<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

// How much of the content is in view and how far it is scrolled, both as a share of its width.
const view = ref<HTMLElement>()
const shown = ref(1)
const offset = ref(0)

function measure() {
  const el = view.value!
  shown.value = el.clientWidth / el.scrollWidth
  offset.value = el.scrollLeft / el.scrollWidth
}

// Pressing or dragging on the bar brings that part of the content into view.
function drag(event: PointerEvent) {
  if (!event.buttons) return
  const bar = event.currentTarget as HTMLElement
  const at = (event.clientX - bar.getBoundingClientRect().left) / bar.clientWidth
  view.value!.scrollLeft = (at - shown.value / 2) * view.value!.scrollWidth
}

let observer: ResizeObserver
onMounted(() => {
  // The content too: it changes width without the view changing, e.g. when the font arrives.
  observer = new ResizeObserver(measure)
  observer.observe(view.value!)
  for (const child of view.value!.children) observer.observe(child)
})
onBeforeUnmount(() => observer.disconnect())
</script>

<template>
  <div class="relative">
    <div ref="view" class="no-scrollbar overflow-x-auto" @scroll="measure">
      <slot />
    </div>
    <!-- The design draws its own scrollbar. It shows only while the content does not fit. -->
    <div v-if="shown < 1" class="absolute inset-x-0 top-full mt-[2.5px] h-[12px] touch-none rounded-full bg-muted p-[2px]" @pointerdown="drag" @pointermove="drag">
      <div class="h-full rounded-full bg-[#E0E0E0]" :style="{ width: `${shown * 100}%`, marginLeft: `${offset * 100}%` }" />
    </div>
  </div>
</template>
