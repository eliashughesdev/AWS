<script setup lang="ts">
// Where the "Confirm my email" link of the sign-up email lands. Loudibly's screen
// (apps/loudibly/src/views/ConfirmView.vue) on the sign-in screen's page, until the client
// supplies a design.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isSignedIn } from '@loudibly/core/auth/signIn'
import { confirmEmail } from '@loudibly/core/composables/useSignUp'

const route  = useRoute()
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
    await confirmEmail(email, code)
  } catch (e: unknown) {
    failed.value = true
    errorMsg.value = ((e as Error).message ?? '') || 'Confirmation failed. The link may have expired.'
    return
  }

  // Replaced, not pushed: Back must not come here and confirm again.
  if (await isSignedIn()) {
    router.replace({ name: 'dashboard' })
  } else {
    router.replace({ name: 'auth', query: { verified: '1', email } })
  }
})
</script>

<template>
  <div class="auth-screen min-h-screen bg-page-gradient flex items-center justify-center p-margin-mobile md:p-margin-desktop">
    <div class="text-center flex flex-col items-center gap-space-4">
      <template v-if="!failed">
        <span class="material-symbols-outlined text-brand animate-pulse">mark_email_read</span>
        <p class="font-label-mono-base text-body-base leading-5 text-text-primary">Confirming your email…</p>
      </template>
      <template v-else>
        <span class="material-symbols-outlined text-red-400">error</span>
        <p role="alert" class="font-label-mono-base text-body-base leading-5 text-red-400">{{ errorMsg }}</p>
        <RouterLink :to="{ name: 'auth' }" class="font-body-base text-body-base leading-5 text-brand hover:underline">
          Go to sign in →
        </RouterLink>
      </template>
    </div>
  </div>
</template>
