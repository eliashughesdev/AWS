<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { IconName } from '../icons'

// A dropdown. The button shows the chosen option; `mobileIcon` is the icon's cut from the mobile design.
const props = defineProps<{ icon: IconName; mobileIcon: IconName; options: { value: string; label: string }[] }>()
const chosen = defineModel<string>({ required: true })

const open = ref(false)
const label = computed(() => props.options.find(option => option.value === chosen.value)?.label)

function choose(value: string) {
  chosen.value = value
  open.value = false
}
</script>

<template>
  <div class="shrink-0 lg:relative" @keydown.esc="open = false">
    <button type="button" aria-haspopup="listbox" :aria-expanded="open" class="flex h-[40px] shrink-0 items-center rounded-[10px] border border-card-line bg-card pl-[6.5px] pr-[8px] text-[12px] font-semibold text-muted lg:h-[50px] lg:w-[198px] lg:pl-[11px] lg:pr-[13px] lg:text-[16px] lg:font-medium" @click="open = !open">
      <span class="grid w-[18px] place-items-center max-lg:mt-[2px] lg:w-[24px]"><AppIcon :name="icon" :mobile="mobileIcon" /></span>
      <!-- The label follows the icon on mobile, where the button is as wide as its content, and sits by the caret on desktop. -->
      <span class="ml-[19.5px] text-white lg:ml-auto">{{ label }}</span>
      <AppIcon name="caret" mobile="caret-sm" class="ml-[5.5px] mt-px lg:ml-[14.5px] lg:mt-[2.5px]" />
    </button>
    <!-- Not in Figma: the open list, drawn like the avatar's menu. A click anywhere else closes it.
         On desktop it hangs under its button. On mobile the buttons scroll sideways, which would cut it
         off, so it is placed by a positioned ancestor outside them, across that one's width. -->
    <template v-if="open">
      <div class="fixed inset-0 z-10" @click="open = false" />
      <ul role="listbox" class="absolute inset-x-0 top-full z-20 mt-[8px] rounded-[10px] border border-card-line bg-card py-[5px]">
        <li v-for="option in options" :key="option.value">
          <button
            type="button"
            role="option"
            :aria-selected="option.value === chosen"
            class="flex h-[40px] w-full items-center px-[13px] text-[12px] font-semibold lg:text-[14px]"
            :class="option.value === chosen ? 'text-accent' : 'text-white'"
            @click="choose(option.value)"
          >{{ option.label }}</button>
        </li>
      </ul>
    </template>
  </div>
</template>
