<script setup lang="ts">
// Not in Figma: Create key, in three states. The form; then the new key's secret, the one time it can
// be seen (the API keeps a hash), which closes only through "I've stored it"; or, when no answer said
// whether the key was made, a note to check the list, never a retry. Mount it with v-if: the secret is
// in this component's state alone and goes when it closes.
import { computed, ref } from 'vue'
import type { ApiResult } from '@loudibly/core/api/client'
import type { ApiKey, ApiKeyPermission, NewApiKey } from '@loudibly/core/api/types'
import type { KycStatus } from '@loudibly/core/composables/useKyc'
import { PUBLIC_API_BASE } from '@loudibly/core/config'
import AppDialog from './AppDialog.vue'
import AppIcon from './AppIcon.vue'
import ApiKeyFields from './ApiKeyFields.vue'
import { expiresAt, expiries, ipLines, refusals, viewPermissions } from '../apiKeys'
import { label, mainButton, outlineButton } from '../authForm'

const props = defineProps<{
  catalogue: ApiKeyPermission[]
  kyc: KycStatus | null
  create: (key: NewApiKey) => Promise<ApiResult<{ key?: ApiKey; secret?: string }>>
}>()
// `changed`: the list may have a new key, so the view reads it again.
const emit = defineEmits<{ close: [changed: boolean] }>()

const step = ref<'form' | 'secret' | 'unknown'>('form')
const name = ref('')
const permissions = ref(viewPermissions(props.catalogue))
const ips = ref('')
const expiry = ref('never')
const creating = ref(false)
const problem = ref('')
const created = ref<{ keyId: string; secret: string } | null>(null)

async function submit() {
  problem.value = ''
  if (!permissions.value.length) {
    problem.value = 'Choose at least one permission.'
    return
  }
  creating.value = true
  let result: Awaited<ReturnType<typeof props.create>> | null = null
  try {
    result = await props.create({
      name: name.value.trim(),
      permissions: permissions.value,
      expiresAt: expiresAt(expiry.value),
      ipAllowlist: ipLines(ips.value),
    })
  } catch {
    // The request may have reached the API.
  }
  creating.value = false

  if (result?.ok && result.data.key && result.data.secret) {
    created.value = { keyId: result.data.key.keyId, secret: result.data.secret }
    step.value = 'secret'
  } else if (!result || result.status >= 500) {
    step.value = 'unknown'
  } else {
    problem.value = refusals[result.data.error_code ?? 0] ?? 'The key could not be created. Check the fields and try again.'
  }
}

const curl = computed(() => created.value && PUBLIC_API_BASE
  ? `curl -u ${created.value.keyId}:${created.value.secret} ${PUBLIC_API_BASE}/accounts/list`
  : '')

// Not in Figma, like Deposit's address: the copy icon turns teal (in light, the text colour) for two seconds.
const copied = ref('')

async function copy(what: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return
  }
  copied.value = what
  setTimeout(() => { if (copied.value === what) copied.value = '' }, 2000)
}

const choice = 'h-[35px] rounded-[5px] text-[12px] font-semibold lg:h-[40px] lg:text-[14px]'
const valueRow = 'mt-[11.5px] flex items-stretch gap-[8px] lg:mt-[14px]'
const valueBox = 'value-box flex min-h-[35px] min-w-0 flex-1 items-center rounded-[5px] px-[10px] py-[8px] font-mono text-[12px] leading-[16px] font-semibold break-all lg:min-h-[40px] lg:px-[15px] lg:text-[13px]'
const copyButton = 'bg-copy grid w-[35px] shrink-0 place-items-center rounded-[5px] text-white lg:w-[40px]'
const warning = 'flex rounded-[10px] border-[0.5px] border-yellow bg-warn px-[11px] py-[13px] text-warn-ink [--icon-scale:0.78] lg:border lg:px-[17px] lg:py-[16px] lg:[--icon-scale:1]'
const warningText = 'ml-[9px] text-[12px] leading-[14px] lg:ml-[9.5px] lg:text-[14px] lg:leading-[18px]'
</script>

<template>
  <AppDialog v-if="step === 'form'" title="Create key" :locked="creating" @close="emit('close', false)">
    <form @submit.prevent="submit">
      <ApiKeyFields v-model:name="name" v-model:permissions="permissions" v-model:ips="ips" :catalogue="catalogue" :kyc="kyc" :disabled="creating" />

      <p class="mt-[20px] lg:mt-[25px]" :class="label">Expires</p>
      <div role="radiogroup" aria-label="Expires" class="mt-[11.5px] grid grid-cols-4 gap-[8px] lg:mt-[14px]">
        <button
          v-for="option in expiries"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="option.value === expiry"
          :disabled="creating"
          :class="[choice, option.value === expiry ? 'tile-selected text-ink light:border-accent!' : 'card text-muted']"
          @click="expiry = option.value"
        >{{ option.label }}</button>
      </div>

      <div v-if="problem" role="alert" class="mt-[15px] lg:mt-[20px]" :class="warning">
        <AppIcon name="info" class="shrink-0" />
        <p :class="warningText">{{ problem }}</p>
      </div>

      <div class="mt-[20px] grid grid-cols-2 gap-[15px] lg:mt-[28.5px]">
        <button type="button" class="button-outline h-[45px] rounded-[5px] text-[12px] font-semibold disabled:opacity-60 lg:h-[50px] lg:text-[16px] lg:font-medium" :disabled="creating" @click="emit('close', false)">Cancel</button>
        <button type="submit" :class="mainButton" :disabled="creating">{{ creating ? 'Creating…' : 'Create key' }}</button>
      </div>
    </form>
  </AppDialog>

  <AppDialog v-else-if="step === 'secret' && created" title="Your new key" locked>
    <div :class="warning">
      <AppIcon name="info" class="shrink-0" />
      <p :class="warningText">The secret is shown this once. Nobody, including NODA, can show it again: store it now.</p>
    </div>

    <p class="mt-[20px] lg:mt-[25px]" :class="label">Key ID</p>
    <div :class="valueRow">
      <p :class="valueBox">{{ created.keyId }}</p>
      <button type="button" :class="copyButton" :aria-label="copied === 'id' ? 'Key ID copied' : 'Copy key ID'" @click="copy('id', created.keyId)">
        <AppIcon name="copy-light" mobile="copy-light-sm" :class="{ 'text-accent': copied === 'id' }" />
      </button>
    </div>

    <p class="mt-[15px] lg:mt-[20px]" :class="label">Secret</p>
    <div :class="valueRow">
      <p :class="valueBox">{{ created.secret }}</p>
      <button type="button" :class="copyButton" :aria-label="copied === 'secret' ? 'Secret copied' : 'Copy secret'" @click="copy('secret', created.secret)">
        <AppIcon name="copy-light" mobile="copy-light-sm" :class="{ 'text-accent': copied === 'secret' }" />
      </button>
    </div>

    <template v-if="curl">
      <p class="mt-[15px] lg:mt-[20px]" :class="label">Try it</p>
      <div :class="valueRow">
        <p :class="valueBox" class="font-medium! text-muted">{{ curl }}</p>
        <button type="button" :class="copyButton" :aria-label="copied === 'curl' ? 'Example copied' : 'Copy example'" @click="copy('curl', curl)">
          <AppIcon name="copy-light" mobile="copy-light-sm" :class="{ 'text-accent': copied === 'curl' }" />
        </button>
      </div>
    </template>

    <button type="button" class="mt-[20px] lg:mt-[28.5px]" :class="mainButton" @click="emit('close', true)">I've stored it</button>
  </AppDialog>

  <AppDialog v-else title="Create key" locked>
    <div role="alert" :class="warning">
      <AppIcon name="info" class="shrink-0" />
      <p :class="warningText">We could not confirm the key was created. Check the list before trying again.</p>
    </div>
    <button type="button" class="mt-[20px] w-full lg:mt-[28.5px]" :class="outlineButton" @click="emit('close', true)">Check the list</button>
  </AppDialog>
</template>
