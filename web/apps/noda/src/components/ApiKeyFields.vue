<script setup lang="ts">
// Not in Figma: the fields a key is made and edited with, put together from New Account's field and
// labels and the Terms box of Set Password. The permissions are three chip boxes (View, Manage, Move
// money); a key that moves money is checked against its merchant's KYC policy each time it is used,
// so a user who is not verified is told so under Move money.
import { computed } from 'vue'
import type { ApiKeyPermission } from '@loudibly/core/api/types'
import type { KycStatus } from '@loudibly/core/composables/useKyc'
import { permissionGroups } from '../apiKeys'
import { field, input, label } from '../authForm'

const props = defineProps<{ catalogue: ApiKeyPermission[]; disabled?: boolean; kyc: KycStatus | null }>()
const name = defineModel<string>('name', { required: true })
const permissions = defineModel<string[]>('permissions', { required: true })
const ips = defineModel<string>('ips', { required: true })

const groups = computed(() => permissionGroups
  .map(group => ({ ...group, permissions: props.catalogue.filter(permission => permission.group === group.group) }))
  .filter(group => group.permissions.length))

// Not while the status is unknown: the API answers when a key is used.
const unverified = computed(() => props.kyc !== null && props.kyc !== 'approved')
</script>

<template>
  <p :class="label">Name</p>
  <label :class="input">
    <input v-model="name" type="text" required maxlength="64" autocomplete="off" placeholder="What uses this key, e.g. Accounting bot" aria-label="Key name" :disabled="disabled" :class="field" />
  </label>

  <fieldset class="mt-[20px] lg:mt-[25px]">
    <legend :class="label">Permissions</legend>
    <div class="mt-[11.5px] space-y-[10px] lg:mt-[14px]">
      <div v-for="group in groups" :key="group.group" class="chip rounded-[10px] px-[11px] py-[12px] lg:px-[15px] lg:py-[14px]">
        <p class="text-[12px] leading-none font-semibold lg:text-[14px]">{{ group.label }}</p>
        <label v-for="permission in group.permissions" :key="permission.name" class="mt-[10px] flex items-start gap-[8px] text-[12px] leading-[16px] font-medium text-muted lg:text-[14px] lg:leading-[18px]">
          <input v-model="permissions" type="checkbox" :value="permission.name" :disabled="disabled" class="mt-[1px] size-[16px] flex-none accent-accent" />
          <span>{{ permission.description }}</span>
        </label>
        <p v-if="group.group === 'move-money' && unverified" class="mt-[12px] text-[12px] leading-[16px] font-medium text-warn-ink lg:text-[14px] lg:leading-[18px]">
          <template v-if="kyc === 'pending'">Some currencies need a verified identity before a key can move money. Yours is being reviewed.</template>
          <template v-else>
            Some currencies need a verified identity before a key can move money.
            <RouterLink :to="{ name: 'dashboard' }" class="font-semibold underline underline-offset-[2.5px]">Verify on the Dashboard</RouterLink>
          </template>
        </p>
      </div>
    </div>
  </fieldset>

  <p class="mt-[20px] lg:mt-[25px]" :class="label">Allowed IPs</p>
  <label :class="input" class="h-auto! py-[8px] lg:py-[12px]">
    <textarea v-model="ips" rows="3" autocomplete="off" spellcheck="false" placeholder="203.0.113.7&#10;2001:db8::1" aria-label="Allowed IPs, one per line" :disabled="disabled" class="resize-none" :class="field" />
  </label>
  <p class="mt-[10.5px] text-[10px] leading-[14px] font-medium text-muted lg:mt-[12px] lg:text-[14px] lg:leading-[18px]">One address per line, at most 20. Leave empty to allow any IP.</p>
</template>
