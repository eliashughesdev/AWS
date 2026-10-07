<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from '../icons'

// A closed dropdown. `mobileIcon` is the icon's cut from the mobile design.
defineProps<{ icon: IconName; mobileIcon: IconName; label: string }>()
</script>

<template>
  <button type="button" class="flex h-[40px] shrink-0 items-center rounded-[10px] border border-card-line bg-card pl-[6.5px] pr-[8px] text-[12px] font-semibold text-muted lg:h-[50px] lg:w-[198px] lg:pl-[11px] lg:pr-[13px] lg:text-[16px] lg:font-medium">
    <span class="grid w-[18px] place-items-center max-lg:mt-[2px] lg:w-[24px]"><AppIcon :name="icon" :mobile="mobileIcon" /></span>
    <!-- The label follows the icon on mobile, where the button is as wide as its content, and sits by the caret on desktop. -->
    <span class="ml-[19.5px] text-white lg:ml-auto">{{ label }}</span>
    <AppIcon name="caret" mobile="caret-sm" class="ml-[5.5px] mt-px lg:ml-[14.5px] lg:mt-[2.5px]" />
  </button>
</template>
