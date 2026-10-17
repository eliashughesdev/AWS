<script setup lang="ts">
// Not in Figma: the whole page (docs/public-api-plan.md D7.2), put together from the app's own parts.
// Desktop lists the keys in a table, mobile one card per key. A revoked key stays listed, greyed,
// with nothing to do; an expired one can only be revoked.
import { computed, onMounted, ref } from 'vue'
import type { ApiKey } from '@loudibly/core/api/types'
import { useApiKeys } from '@loudibly/core/composables/useApiKeys'
import { useKyc } from '@loudibly/core/composables/useKyc'
import ApiKeyFields from '../components/ApiKeyFields.vue'
import AppDialog from '../components/AppDialog.vue'
import AppIcon from '../components/AppIcon.vue'
import CreateApiKeyDialog from '../components/CreateApiKeyDialog.vue'
import DataTable from '../components/DataTable.vue'
import ListState from '../components/ListState.vue'
import PageAction from '../components/PageAction.vue'
import StatusPill from '../components/StatusPill.vue'
import { allowedIps, ipLines, keyStatus, permissionSummary, refusals, shortKeyId } from '../apiKeys'
import { mainButton } from '../authForm'
import { timeAgo } from '../format'

const { keys, permissions: catalogue, failed, load, refresh, create, update, revoke } = useApiKeys()
const { status: kyc, load: loadKyc } = useKyc()

const state = ref<'loading' | 'failed' | 'ready'>('loading')

async function read() {
  state.value = 'loading'
  try {
    await load()
  } catch {
    state.value = 'failed'
    return
  }
  state.value = failed.value ? 'failed' : 'ready'
}

onMounted(() => {
  read()
  // Only for the line under Move money; the API decides when a key is used.
  loadKyc().catch(() => {})
})

const rows = computed(() => state.value === 'ready' ? keys.value.map(key => {
  const status = keyStatus(key)
  return {
    key,
    status,
    shortId:     shortKeyId(key.keyId),
    permissions: permissionSummary(key.permissions, catalogue.value),
    ips:         allowedIps(key),
    rate:        key.rateLimit ? `${key.rateLimit.perSecond}/s` : '—',
    lastUsed:    key.lastUsedAt ? timeAgo(key.lastUsedAt) : 'Never',
    canEdit:     status === 'Active',
    canRevoke:   status !== 'Revoked',
  }
}) : [])

const columns = ['Name', 'Key', 'Permissions', 'Allowed IPs', 'Rate limit', 'Last used', 'Status', '']
const grid = 'lg:min-w-[960px] lg:grid-cols-[190fr_125fr_150fr_140fr_80fr_105fr_115fr_155fr]'

// Create key
const creating = ref(false)

async function closeCreate(changed: boolean) {
  creating.value = false
  if (changed) await refresh().catch(() => {})
}

// Edit
const editing = ref<ApiKey | null>(null)
const editName = ref('')
const editPermissions = ref<string[]>([])
const editIps = ref('')
const saving = ref(false)
const editProblem = ref('')

function openEdit(key: ApiKey) {
  editName.value = key.name
  editPermissions.value = [...key.permissions]
  editIps.value = key.ipAllowlist.join('\n')
  editProblem.value = ''
  editing.value = key
}

async function save() {
  if (!editing.value) return
  editProblem.value = ''
  if (!editPermissions.value.length) {
    editProblem.value = 'Choose at least one permission.'
    return
  }
  saving.value = true
  // Sending it again does no harm, so an answer that never came is only "try again".
  const result = await update(editing.value.keyId, {
    name: editName.value.trim(),
    permissions: editPermissions.value,
    ipAllowlist: ipLines(editIps.value),
  }).catch(() => null)
  if (result?.ok) await refresh().catch(() => {})
  saving.value = false

  if (result?.ok) editing.value = null
  else editProblem.value = (result && refusals[result.data.error_code ?? 0]) || 'The changes could not be saved. Try again.'
}

// Revoke
const revoking = ref<ApiKey | null>(null)
const sending = ref(false)
const revokeProblem = ref('')

function openRevoke(key: ApiKey) {
  revokeProblem.value = ''
  revoking.value = key
}

async function confirmRevoke() {
  if (!revoking.value) return
  sending.value = true
  revokeProblem.value = ''
  // Revoking a revoked key answers success too, so a retry is always safe.
  const result = await revoke(revoking.value.keyId).catch(() => null)
  if (result?.ok) await refresh().catch(() => {})
  sending.value = false

  if (result?.ok) revoking.value = null
  else revokeProblem.value = 'The key could not be revoked. Try again.'
}

const createButton = 'bg-cta disabled:opacity-60 h-[32px] w-[100px] rounded-[7.5px] text-[10px] font-semibold text-white lg:h-[40px] lg:w-[128px] lg:rounded-[10px] lg:text-[14px] lg:font-medium'
const frame = 'card bg-account mt-[20px] rounded-[10px] lg:-ml-px lg:-mr-[2px] lg:mt-[24px]'
const cell = 'min-w-0 truncate pr-[12px] text-[14px] font-medium'
const action = 'h-[30px] rounded-[5px] px-[12px] text-[12px] font-semibold lg:text-[14px]'
const dialogButton = 'h-[45px] rounded-[5px] text-[12px] font-semibold disabled:opacity-60 lg:h-[50px] lg:text-[16px] lg:font-medium'
const warning = 'mt-[15px] flex rounded-[10px] border-[0.5px] border-yellow bg-warn px-[11px] py-[13px] text-warn-ink [--icon-scale:0.78] lg:mt-[20px] lg:border lg:px-[17px] lg:py-[16px] lg:[--icon-scale:1]'
const warningText = 'ml-[9px] text-[12px] leading-[14px] lg:ml-[9.5px] lg:text-[14px] lg:leading-[18px]'
const rowLabel = 'text-[12px] leading-none font-semibold text-muted'
const rowValue = 'min-w-0 truncate text-right text-[12px] leading-none font-semibold'
</script>

<template>
  <PageAction>
    <button type="button" class="mt-[13px] lg:mt-0" :class="createButton" :disabled="state !== 'ready'" @click="creating = true">+ Create key</button>
  </PageAction>

  <ListState v-if="state === 'loading'" kind="loading" title="Loading your API keys…" />

  <div v-else-if="state === 'failed'" :class="frame">
    <ListState kind="error" title="Your API keys could not be loaded" text="Try again in a moment.">
      <button type="button" class="button-outline h-[40px] rounded-[5px] px-[24px] text-[12px] font-semibold lg:text-[14px]" @click="read">Try again</button>
    </ListState>
  </div>

  <div v-else-if="!rows.length" :class="frame">
    <ListState title="No API keys yet" text="A key lets your own software read your accounts or move money through the NODA API, with only the permissions you give it.">
      <button type="button" :class="createButton" @click="creating = true">+ Create key</button>
    </ListState>
  </div>

  <template v-else>
    <DataTable title="Your keys" :columns="columns" :rows="rows" :grid="grid" class="mt-[24px] mb-[67px] max-lg:hidden">
      <template #default="{ row }">
        <!-- A name can be 64 characters: it ends in "…" rather than widening every column. -->
        <span role="cell" class="contain-inline-size" :class="[cell, { 'opacity-50': row.status === 'Revoked' }]" :title="row.key.name">{{ row.key.name }}</span>
        <span role="cell" :class="[cell, { 'opacity-50': row.status === 'Revoked' }]" class="font-mono text-[13px]!" :title="row.key.keyId">{{ row.shortId }}</span>
        <span role="cell" :class="[cell, { 'opacity-50': row.status === 'Revoked' }]">{{ row.permissions }}</span>
        <span role="cell" :class="[cell, { 'opacity-50': row.status === 'Revoked' }]" :title="row.key.ipAllowlist.join(', ')">{{ row.ips }}</span>
        <span role="cell" :class="[cell, { 'opacity-50': row.status === 'Revoked' }]">{{ row.rate }}</span>
        <span role="cell" :class="[cell, { 'opacity-50': row.status === 'Revoked' }]">{{ row.lastUsed }}</span>
        <span role="cell"><StatusPill :status="row.status" /></span>
        <span role="cell" class="flex gap-[6px] pr-[20px]">
          <button v-if="row.canEdit" type="button" class="button-outline" :class="action" :aria-label="`Edit ${row.key.name}`" @click="openEdit(row.key)">Edit</button>
          <button v-if="row.canRevoke" type="button" class="card text-red" :class="action" :aria-label="`Revoke ${row.key.name}`" @click="openRevoke(row.key)">Revoke</button>
        </span>
      </template>
    </DataTable>

    <ul class="mt-[20px] mb-[30px] space-y-[15px] lg:hidden">
      <li v-for="row in rows" :key="row.key.keyId" class="card rounded-[10px] px-[14px] py-[16px]">
        <div class="flex items-center gap-[10px]" :class="{ 'opacity-50': row.status === 'Revoked' }">
          <p class="min-w-0 flex-1 truncate py-[2px] text-[16px] leading-none font-medium">{{ row.key.name }}</p>
          <StatusPill :status="row.status" class="mt-0!" />
        </div>
        <dl class="mt-[14px] space-y-[11px]" :class="{ 'opacity-50': row.status === 'Revoked' }">
          <div class="flex justify-between gap-[12px]"><dt :class="rowLabel">Key</dt><dd :class="rowValue" class="font-mono">{{ row.shortId }}</dd></div>
          <div class="flex justify-between gap-[12px]"><dt :class="rowLabel">Permissions</dt><dd :class="rowValue">{{ row.permissions }}</dd></div>
          <div class="flex justify-between gap-[12px]"><dt :class="rowLabel">Allowed IPs</dt><dd :class="rowValue">{{ row.ips }}</dd></div>
          <div class="flex justify-between gap-[12px]"><dt :class="rowLabel">Rate limit</dt><dd :class="rowValue">{{ row.rate }}</dd></div>
          <div class="flex justify-between gap-[12px]"><dt :class="rowLabel">Last used</dt><dd :class="rowValue">{{ row.lastUsed }}</dd></div>
        </dl>
        <div v-if="row.canEdit || row.canRevoke" class="mt-[16px] grid grid-cols-2 gap-[10px]">
          <button v-if="row.canEdit" type="button" class="button-outline" :class="action" @click="openEdit(row.key)">Edit</button>
          <button v-if="row.canRevoke" type="button" class="card text-red" :class="[action, { 'col-span-2': !row.canEdit }]" @click="openRevoke(row.key)">Revoke</button>
        </div>
      </li>
    </ul>
  </template>

  <CreateApiKeyDialog v-if="creating" :catalogue="catalogue" :kyc="kyc" :create="create" @close="closeCreate" />

  <AppDialog v-if="editing" title="Edit key" :locked="saving" @close="editing = null">
    <form @submit.prevent="save">
      <ApiKeyFields v-model:name="editName" v-model:permissions="editPermissions" v-model:ips="editIps" :catalogue="catalogue" :kyc="kyc" :disabled="saving" />

      <div v-if="editProblem" role="alert" :class="warning">
        <AppIcon name="info" class="shrink-0" />
        <p :class="warningText">{{ editProblem }}</p>
      </div>

      <div class="mt-[20px] grid grid-cols-2 gap-[15px] lg:mt-[28.5px]">
        <button type="button" class="button-outline" :class="dialogButton" :disabled="saving" @click="editing = null">Cancel</button>
        <button type="submit" :class="mainButton" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </form>
  </AppDialog>

  <AppDialog v-if="revoking" title="Revoke key" :locked="sending" @close="revoking = null">
    <p class="text-[14px] leading-[20px] font-medium lg:text-[16px] lg:leading-[22px]">
      Revoke <span class="font-semibold">{{ revoking.name }}</span>?
    </p>
    <p class="mt-[10px] text-[12px] leading-[16px] font-medium text-muted lg:text-[14px] lg:leading-[18px]">
      Software using <span class="font-mono">{{ revoking.keyId }}</span> is refused from now on. This cannot be undone: to use the API again, create a new key.
    </p>

    <div v-if="revokeProblem" role="alert" :class="warning">
      <AppIcon name="info" class="shrink-0" />
      <p :class="warningText">{{ revokeProblem }}</p>
    </div>

    <div class="mt-[20px] grid grid-cols-2 gap-[15px] lg:mt-[28.5px]">
      <button type="button" class="button-outline" :class="dialogButton" :disabled="sending" @click="revoking = null">Cancel</button>
      <button type="button" :class="mainButton" :disabled="sending" @click="confirmRevoke">{{ sending ? 'Revoking…' : 'Revoke key' }}</button>
    </div>
  </AppDialog>
</template>
