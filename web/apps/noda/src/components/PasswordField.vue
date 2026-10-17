<script setup lang="ts">
import { computed, ref } from 'vue'
import { passwordStrength } from '@loudibly/core/composables/useSignUp'
import AppIcon from './AppIcon.vue'
import { field, input, label } from '../authForm'

// A new password and its confirmation in AuthFrame's forms. The eye shows the password (teal
// while shown); `strength` adds the Withdraw Limits bar, in four steps, under a typed one.
defineProps<{ id: string; text: string; strength?: boolean }>()
const value = defineModel<string>({ required: true })

const shown = ref(false)
const bars = computed(() => passwordStrength(value.value))
const strengthLabel = computed(() => (['', 'Weak', 'Fair', 'Good', 'Strong'] as const)[bars.value] ?? '')
</script>

<template>
  <div>
    <label :for="id" :class="label">{{ text }}</label>
    <div :class="input">
      <input
        :id="id"
        v-model="value"
        :type="shown ? 'text' : 'password'"
        autocomplete="new-password"
        placeholder="••••••••"
        required
        :class="field"
      />
      <button
        type="button"
        :aria-label="shown ? 'Hide password' : 'Show password'"
        :aria-pressed="shown"
        class="-my-[8px] -mr-[4px] flex p-[8px] lg:-mr-[6px]"
        :class="shown ? 'text-accent' : 'text-muted'"
        @click="shown = !shown"
      >
        <AppIcon name="eye-sm" />
      </button>
    </div>
    <template v-if="strength && value">
      <div class="mt-[10px] flex h-[6px] gap-[4px] lg:mt-[12px]">
        <div v-for="i in 4" :key="i" class="flex-1 rounded-full" :class="i <= bars ? 'bg-teal-rise' : 'bg-card light:bg-track'" />
      </div>
      <p class="mt-[8px] text-right text-[10px] leading-none font-semibold text-muted lg:text-[12px]">{{ strengthLabel }}</p>
    </template>
  </div>
</template>
