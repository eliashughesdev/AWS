<script setup lang="ts">
// Where the emailed claim link lands: the payer chooses a first password. Loudibly's screen
// (apps/loudibly/src/views/SetPasswordView.vue), drawn like sign-in (AuthFrame) until the client
// supplies a design.
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClaim } from '@loudibly/core/composables/useClaim'
import AppIcon from '../components/AppIcon.vue'
import AuthFrame from '../components/AuthFrame.vue'
import ListState from '../components/ListState.vue'
import PasswordField from '../components/PasswordField.vue'
import { label, link, mainButton, message, outlineButton, stack } from '../authForm'

const route  = useRoute()
const router = useRouter()

// 'unchecked': no answer about the link, or an answer that is not about the link.
type Step = 'checking' | 'form' | 'dead' | 'unchecked'

const step  = ref<Step>('checking')
const error = ref('')

const { email, firstName, passwordSet, verify, setPassword } = useClaim()

// The error codes of a link that is finished, and what the screen says of each.
const DEAD_LINK: Record<number, string> = {
  100034: 'This link is not valid.',
  100035: 'This link has expired.',
  100036: 'This link has already been used.',
}
const PASSWORD_REFUSED = 100037

const password    = ref('')
const confirmPass = ref('')
const accepted    = ref(false)
const submitting  = ref(false)

const subtitle = computed(() => ({
  checking: 'Checking your link…',
  dead: 'This link cannot be used',
  unchecked: 'This link could not be checked',
  form: 'Choose a password to finish',
})[step.value])

// The link's token, kept in memory only.
let token = ''

async function checkLink() {
  step.value = 'checking'
  try {
    const result = await verify(token)
    if (result.ok) {
      step.value = 'form'
      return
    }

    const dead = DEAD_LINK[result.errorCode ?? 0]
    if (dead) error.value = dead
    step.value = dead ? 'dead' : 'unchecked'
  } catch {
    step.value = 'unchecked'
  }
}

onMounted(async () => {
  token = String(route.query.token ?? '')

  if (!token) {
    step.value = 'dead'
    error.value = 'This link is incomplete. Open the link from your email again.'
    return
  }

  // Keep the token out of the address bar and the browser history. Through the router, which
  // writes the address it remembers back into the history entry on the next navigation.
  await router.replace({ name: 'set-password' })
  await checkLink()
})

async function handleSubmit() {
  error.value = ''

  if (password.value !== confirmPass.value) {
    error.value = 'Passwords do not match.'
    return
  }

  submitting.value = true
  try {
    const result = await setPassword(password.value)

    if (result.ok) {
      router.replace({ name: 'dashboard' })
      return
    }

    const dead = DEAD_LINK[result.errorCode ?? 0]
    if (dead) {
      // The link is spent — no point keeping the form up.
      error.value = dead
      step.value  = 'dead'
    } else if (result.errorCode === PASSWORD_REFUSED) {
      // The server's own sentence: nothing else says which rule the password broke.
      error.value = result.message ? String(result.message) : 'This password does not meet the requirements.'
    } else {
      error.value = 'Your password could not be set. Try again in a moment.'
    }
  } catch {
    if (passwordSet.value) {
      // Password is set; only the automatic sign-in failed. Send them to sign in
      // with the address prefilled rather than leaving them stuck here.
      router.replace({ name: 'auth', query: { email: email.value } })
    } else {
      error.value = 'We could not reach NODA, so your password was not set. Check your connection and try again.'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthFrame :title="step === 'form' && firstName ? `Welcome, ${firstName}` : 'Set your password'" :subtitle="subtitle">
    <ListState v-if="step === 'checking'" kind="loading" title="One moment…" />

    <ListState
      v-else-if="step === 'dead'"
      kind="error"
      :title="error"
      text="Ask NODA to send you a new link, or sign in if you already set a password."
    >
      <RouterLink :to="{ name: 'auth' }" :class="outlineButton">Go to sign in</RouterLink>
    </ListState>

    <ListState
      v-else-if="step === 'unchecked'"
      kind="error"
      title="We could not check your link."
      text="The link may still be good. Check your connection and try again."
    >
      <div class="flex flex-col items-center gap-[16px]">
        <button type="button" :class="outlineButton" @click="checkLink">Try again</button>
        <RouterLink :to="{ name: 'auth' }" class="text-[12px] lg:text-[14px]" :class="link">Go to sign in</RouterLink>
      </div>
    </ListState>

    <form v-else :class="stack" @submit.prevent="handleSubmit">
      <p class="text-muted" :class="message">Your NODA account is ready. Set a password and it is yours.</p>

      <p v-if="error" role="alert" class="text-red" :class="message">{{ error }}</p>

      <!-- Email, fixed: it identifies the account and the payer cannot change it -->
      <div>
        <span :class="label">Your account</span>
        <p class="value-box mt-[11.5px] flex h-[35px] items-center gap-[8px] rounded-[5px] px-[9px] text-[12px] font-medium text-muted lg:mt-[14px] lg:h-[50px] lg:px-[17px] lg:text-[14px]">
          <span class="min-w-0 flex-1 truncate">{{ email }}</span>
          <AppIcon name="lock" />
        </p>
      </div>

      <PasswordField id="sp-password" v-model="password" text="Password" strength />
      <PasswordField id="sp-confirm" v-model="confirmPass" text="Confirm password" />

      <label class="flex cursor-pointer items-start gap-[10px]">
        <input v-model="accepted" type="checkbox" required class="mt-[1px] size-[16px] flex-none accent-accent" />
        <span class="text-muted" :class="message">I agree to the NODA Terms of Service and Privacy Policy.</span>
      </label>

      <!-- Never disabled for what is missing: the browser points at an empty field or the
           unticked box, and handleSubmit says when the passwords differ. -->
      <button type="submit" :disabled="submitting" class="mt-[5px]" :class="mainButton">
        {{ submitting ? 'Setting password…' : 'Set password and continue' }}
      </button>
    </form>
  </AuthFrame>
</template>
