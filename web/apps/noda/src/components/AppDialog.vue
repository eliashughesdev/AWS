<script setup lang="ts">
import { onBeforeUnmount, onMounted, useId, useTemplateRef } from 'vue'

// Not in Figma: a card over the dimmed page, put together from the design's card and its title line.
// Render it with v-if. Escape or a click outside asks to close, unless `locked`. With nothing inside
// to focus, the focus is on the dialog itself, which draws no ring for it.
const props = defineProps<{ title: string; locked?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dialog = useTemplateRef('dialog')
const titleId = useId()

// A modal <dialog> keeps the focus inside and gives it back when it closes.
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())

function askToClose() {
  if (!props.locked) emit('close')
}
</script>

<template>
  <dialog
    ref="dialog"
    :aria-labelledby="titleId"
    class="m-auto w-[calc(100%-20px)] max-w-none panel rounded-[10px] text-ink outline-none backdrop:bg-black/70 lg:w-[450px]"
    @cancel.prevent="askToClose"
    @click.self="askToClose"
  >
    <h2 :id="titleId" class="border-b border-rule pb-[20.5px] pl-[14px] pt-[19.5px] text-[18px] leading-none font-medium lg:pb-[31px] lg:pl-[29px] lg:pt-[29px] lg:text-[22px] lg:font-semibold">{{ title }}</h2>
    <div class="px-[14px] pb-[20px] pt-[20.5px] lg:px-[29px] lg:pb-[29px] lg:pt-[28.5px]">
      <slot />
    </div>
  </dialog>
</template>
