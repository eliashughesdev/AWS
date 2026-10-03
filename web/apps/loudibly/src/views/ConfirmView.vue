<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { confirmSignUp, getCurrentUser } from '@loudibly/core/auth/cognito'

const route = useRoute()
const router = useRouter()

const failed   = ref(false)
const errorMsg = ref('')

onMounted(async () => {
  const email = String(route.query.email ?? '')
  const code  = String(route.query.code ?? '')

  if (!email || !code) {
    failed.value = true
    errorMsg.value = 'This confirmation link is invalid.'
    return
  }

  try {
    await confirmSignUp({ username: email, confirmationCode: code })
  } catch (e: unknown) {
    const msg = (e as Error).message ?? ''
    // Already confirmed (e.g. the code was used in the app first) — treat as success
    if (!msg.includes('Current status is CONFIRMED')) {
      failed.value = true
      errorMsg.value = msg || 'Confirmation failed. The link may have expired.'
      return
    }
  }

  try {
    await getCurrentUser()
    router.push({ name: 'dashboard', query: { verified: '1' } })
  } catch {
    router.push({ name: 'auth', query: { verified: '1', email } })
  }
})
</script>

<template>
  <div class="min-h-screen bg-page flex items-center justify-center p-8">
    <div class="text-center flex flex-col items-center gap-4">
      <template v-if="!failed">
        <span class="material-symbols-outlined text-brand text-4xl animate-pulse">mark_email_read</span>
        <p class="font-['JetBrains_Mono'] text-sm">Confirming your email…</p>
      </template>
      <template v-else>
        <span class="material-symbols-outlined text-red-400 text-4xl">error</span>
        <p class="font-['JetBrains_Mono'] text-sm text-red-400">{{ errorMsg }}</p>
        <RouterLink :to="{ name: 'auth' }" class="text-brand text-sm hover:underline">Go to sign in →</RouterLink>
      </template>
    </div>
  </div>
</template>
