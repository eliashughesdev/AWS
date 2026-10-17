<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { tones } from '../tones'
import { achievements } from '../placeholders/dashboard'

// 'unknown' while the status is being read and when it could not be.
export type KycRow = 'approved' | 'not-started' | 'starting' | 'pending' | 'failed' | 'start-failed' | 'unknown'

const props = defineProps<{ kyc: KycRow }>()
defineEmits<{ verify: [] }>()

const done = 'bg-star text-accent'
const notDone = 'bg-star-off text-star-off-ink'

// Not in Figma: the words at the right of the row, the yellow star, and the row being a button.
// The design draws the done and not-done stars only.
const rows: Record<KycRow, { star: string; note?: string; noteClass?: string; action?: string }> = {
  approved:       { star: done },
  'not-started':  { star: notDone, action: 'Verify now' },
  starting:       { star: notDone, note: 'Starting…' },
  pending:        { star: `${tones.yellow} light:text-warn-ink`, note: 'In progress', noteClass: 'text-warn-ink' },
  failed:         { star: notDone, note: 'Not approved', action: 'Try again' },
  'start-failed': { star: notDone, note: 'Could not start', action: 'Try again' },
  unknown:        { star: notDone },
}

const row = computed(() => rows[props.kyc])

const item = 'flex w-full items-center gap-[10px] lg:gap-[18px]'
const star = 'grid size-[23px] shrink-0 place-items-center rounded-full [--icon-scale:0.72] lg:size-[32px] lg:[--icon-scale:1]'
const label = 'text-[14px] leading-none font-medium'
</script>

<template>
  <section class="card rounded-[10px] px-[11px] pb-[19px] pt-[21px] lg:px-[19px] lg:py-[28px]">
    <div class="flex items-center gap-[10px] lg:gap-[18px]">
      <span class="flex w-[23px] justify-center lg:w-[32px]">
        <AppIcon name="trophy" class="text-accent [--icon-scale:0.65] lg:[--icon-scale:1]" />
      </span>
      <h2 class="text-[16px] leading-none font-medium lg:text-[18px] lg:font-semibold">Achievements</h2>
    </div>
    <ul class="mt-[15px] space-y-[10px] lg:mt-[25px]">
      <li v-for="name in achievements" :key="name" :class="item">
        <span :class="[star, done]">
          <AppIcon name="star" />
        </span>
        <span :class="label">{{ name }}</span>
      </li>
      <li>
        <component
          :is="row.action ? 'button' : 'div'"
          :type="row.action ? 'button' : undefined"
          :class="item"
          @click="row.action && $emit('verify')"
        >
          <span :class="[star, row.star]">
            <AppIcon name="star" />
          </span>
          <span :class="label">KYC Verified</span>
          <span v-if="row.note || row.action" class="ml-auto flex gap-[4px] text-[10px] leading-none font-semibold whitespace-nowrap lg:text-[12px]">
            <span v-if="row.note" :class="row.noteClass ?? 'text-muted'">{{ row.note }}</span>
            <span v-if="row.note && row.action" class="text-muted">·</span>
            <span v-if="row.action" class="text-accent">{{ row.action }}</span>
          </span>
        </component>
      </li>
    </ul>
  </section>
</template>
