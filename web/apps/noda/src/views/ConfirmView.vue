<script setup lang="ts">
// Where the "Confirm my email" link of the sign-up email lands. Loudibly's screen
// (apps/loudibly/src/views/ConfirmView.vue), drawn like sign-in (AuthFrame) until the client
// supplies a design.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isSignedIn } from '@loudibly/core/auth/signIn'
import { confirmEmail } from '@loudibly/core/composables/useSignUp'
import AuthFrame from '../components/AuthFrame.vue'
import ListState from '../components/ListState.vue'
import { outlineButton } from '../authForm'

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
  <AuthFrame title="Confirm your email">
    <ListState v-if="!failed" kind="loading" title="Confirming your email…" />
    <ListState v-else kind="error" :title="errorMsg">
      <RouterLink :to="{ name: 'auth' }" :class="outlineButton">Go to sign in</RouterLink>
    </ListState>
  </AuthFrame>
</template>
