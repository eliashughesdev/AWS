<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import DropdownList from './DropdownList.vue'
import type { IconName } from '../icons'

// A dropdown. The button shows the chosen option; `mobileIcon` is the icon's cut from the mobile design.
const props = defineProps<{ icon: IconName; mobileIcon: IconName; options: { value: string; label: string }[] }>()
const chosen = defineModel<string>({ required: true })

const open = ref(false)
const label = computed(() => props.options.find(option => option.value === chosen.value)?.label)
</script>

<template>
  <div class="shrink-0 lg:relative" @keydown.esc="open = false">
    <button type="button" aria-haspopup="listbox" :aria-expanded="open" class="flex h-[40px] shrink-0 items-center card rounded-[10px] pl-[6.5px] pr-[8px] text-[12px] font-semibold text-muted light:text-ink lg:h-[50px] lg:w-[198px] lg:pl-[11px] lg:pr-[13px] lg:text-[16px] lg:font-medium" @click="open = !open">
      <span class="grid w-[18px] place-items-center max-lg:mt-[2px] lg:w-[24px]"><AppIcon :name="icon" :mobile="mobileIcon" /></span>
      <!-- The label follows the icon on mobile, where the button is as wide as its content, and sits by the caret on desktop. -->
      <span class="ml-[19.5px] text-ink lg:ml-auto">{{ label }}</span>
      <AppIcon name="caret" mobile="caret-sm" class="ml-[5.5px] mt-px lg:ml-[14.5px] lg:mt-[2.5px]" />
    </button>
    <!-- On desktop the list hangs under its button. On mobile the buttons scroll sideways, which would
         cut it off, so it is placed by a positioned ancestor outside them, across that one's width. -->
    <DropdownList v-if="open" v-model="chosen" :options="options" @close="open = false" />
  </div>
</template>
