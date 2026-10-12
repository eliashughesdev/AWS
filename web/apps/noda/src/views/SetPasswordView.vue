<script setup lang="ts">
// Where the emailed claim link lands: the payer chooses a first password. Loudibly's screen
// (apps/loudibly/src/views/SetPasswordView.vue) until the client supplies a design.
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useClaim } from '@loudibly/core/composables/useClaim'
import { passwordStrength } from '@loudibly/core/composables/useSignUp'
import logoMark from '../assets/logo-mark.png'
import logoWordmark from '../assets/logo-wordmark.png'

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
const showPass    = ref(false)
const showConfirm = ref(false)
const accepted    = ref(false)
const submitting  = ref(false)

const passwordBars = computed((): number => passwordStrength(password.value))

const passwordStrengthLabel = computed((): string =>
  (['', 'Weak', 'Fair', 'Good', 'Strong'] as const)[passwordBars.value] ?? ''
)

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

const inputClass =
  'w-full bg-surface-2 border border-border-subtle rounded text-text-primary ' +
  'font-label-mono-base text-label-mono-base leading-6 px-space-4 py-space-3 pr-10 ' +
  'placeholder:text-text-muted/80 focus:outline-none focus:border-brand ' +
  'focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200'

const buttonClass =
  'w-full bg-brand text-on-brand font-label-mono-base text-label-mono-base ' +
  'font-bold py-space-3 rounded-[12px] border-0 hover:bg-brand-hover transition-colors ' +
  'active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed'
</script>

<template>
  <div class="auth-screen min-h-screen bg-page-gradient flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop">
    <main class="w-full max-w-[390px] mx-auto flex flex-col gap-space-8 relative z-10">

      <!-- ── Header ─────────────────────────────────────────────────────── -->
      <header class="text-center flex flex-col items-center gap-space-4">
        <div class="flex items-center gap-[14px]">
          <img :src="logoMark" alt="" class="h-9" />
          <img :src="logoWordmark" alt="NODA" class="h-[25.6px] w-[108.4px]" />
        </div>
        <p class="font-body-base text-body-base text-text-secondary">
          <template v-if="step === 'checking'">Checking your link…</template>
          <template v-else-if="step === 'dead'">This link cannot be used</template>
          <template v-else-if="step === 'unchecked'">This link could not be checked</template>
          <template v-else>Choose a password to finish</template>
        </p>
      </header>

      <section
        class="bg-surface-1 border border-border-subtle rounded p-space-8
               flex flex-col gap-space-6 shadow-2xl shadow-black/50"
      >

        <!-- ── Checking ──────────────────────────────────────────────────── -->
        <template v-if="step === 'checking'">
          <div class="flex flex-col items-center gap-space-4 py-space-4">
            <span class="material-symbols-outlined text-brand animate-pulse">key</span>
            <p class="font-label-mono-base text-label-mono-base text-text-secondary">One moment…</p>
          </div>
        </template>

        <!-- ── Dead link ─────────────────────────────────────────────────── -->
        <template v-else-if="step === 'dead'">
          <div class="flex flex-col items-center gap-space-4 text-center">
            <span class="material-symbols-outlined text-status-danger">link_off</span>
            <p class="font-body-base text-body-base text-text-primary">{{ error }}</p>
            <p class="font-caption text-caption text-text-muted">
              Ask NODA to send you a new link, or sign in if you already set a password.
            </p>
            <RouterLink :to="{ name: 'auth' }" class="text-brand font-body-base text-body-base hover:underline">
              Go to sign in →
            </RouterLink>
          </div>
        </template>

        <!-- ── Link not checked ──────────────────────────────────────────── -->
        <template v-else-if="step === 'unchecked'">
          <div class="flex flex-col items-center gap-space-4 text-center">
            <span class="material-symbols-outlined text-status-danger">error</span>
            <p role="alert" class="font-body-base text-body-base text-text-primary">We could not check your link.</p>
            <p class="font-caption text-caption text-text-muted">
              The link may still be good. Check your connection and try again.
            </p>
            <button type="button" :class="buttonClass" @click="checkLink">Try again</button>
            <RouterLink :to="{ name: 'auth' }" class="text-brand font-body-base text-body-base hover:underline">
              Go to sign in →
            </RouterLink>
          </div>
        </template>

        <!-- ── Set password ──────────────────────────────────────────────── -->
        <template v-else>
          <div class="flex flex-col gap-space-2">
            <h2 class="font-headline-h3 text-headline-h3 text-text-primary font-semibold">
              <template v-if="firstName">Welcome, {{ firstName }}</template>
              <template v-else>Welcome</template>
            </h2>
            <p class="font-body-base text-body-base text-text-secondary">
              Your NODA account is ready. Set a password and it is yours.
            </p>
          </div>

          <form @submit.prevent="handleSubmit" class="flex flex-col gap-space-4">

            <p v-if="error" role="alert" class="font-body-base text-body-base text-status-danger">
              {{ error }}
            </p>

            <!-- Email, fixed: it identifies the account and the payer cannot change it -->
            <div class="flex flex-col gap-space-2">
              <span class="font-body-base text-[13px] font-medium text-text-secondary">
                Your account
              </span>
              <div
                class="w-full bg-surface-2/60 border border-border-subtle rounded
                       text-text-secondary font-label-mono-base text-label-mono-base
                       px-space-4 py-space-3 flex items-center gap-space-2"
              >
                <span class="material-symbols-outlined text-text-muted" style="font-size: 18px;">mail</span>
                <span class="truncate">{{ email }}</span>
              </div>
            </div>

            <!-- Password -->
            <div class="flex flex-col gap-space-2">
              <label for="sp-password" class="font-body-base text-[13px] font-medium text-text-secondary">
                Password
              </label>
              <div class="relative">
                <input
                  id="sp-password"
                  v-model="password"
                  :type="showPass ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="••••••••"
                  required
                  :class="inputClass"
                />
                <button
                  type="button"
                  @click="showPass = !showPass"
                  :aria-label="showPass ? 'Hide password' : 'Show password'"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary
                         hover:text-text-primary transition-colors"
                >
                  <span class="material-symbols-outlined" style="font-size: 20px;">
                    {{ showPass ? 'visibility' : 'visibility_off' }}
                  </span>
                </button>
              </div>
              <template v-if="password">
                <div class="flex gap-1 h-1 mt-space-1">
                  <div
                    v-for="i in 4"
                    :key="i"
                    class="flex-1 rounded-full transition-colors duration-200"
                    :class="i <= passwordBars ? 'bg-brand' : 'bg-surface-2'"
                  />
                </div>
                <p class="font-caption text-caption text-text-muted text-right">{{ passwordStrengthLabel }}</p>
              </template>
            </div>

            <!-- Confirm -->
            <div class="flex flex-col gap-space-2">
              <label for="sp-confirm" class="font-body-base text-[13px] font-medium text-text-secondary">
                Confirm password
              </label>
              <div class="relative">
                <input
                  id="sp-confirm"
                  v-model="confirmPass"
                  :type="showConfirm ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="••••••••"
                  required
                  :class="inputClass"
                />
                <button
                  type="button"
                  @click="showConfirm = !showConfirm"
                  :aria-label="showConfirm ? 'Hide password' : 'Show password'"
                  class="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary
                         hover:text-text-primary transition-colors"
                >
                  <span class="material-symbols-outlined" style="font-size: 20px;">
                    {{ showConfirm ? 'visibility' : 'visibility_off' }}
                  </span>
                </button>
              </div>
            </div>

            <!-- Terms -->
            <label class="flex items-start gap-space-2 cursor-pointer">
              <input
                v-model="accepted"
                type="checkbox"
                required
                class="mt-1 accent-brand w-4 h-4 flex-none"
              />
              <span class="font-caption text-caption text-text-secondary">
                I agree to the NODA Terms of Service and Privacy Policy.
              </span>
            </label>

            <!-- Never disabled for what is missing: the browser points at an empty field or the
                 unticked box, and handleSubmit says when the passwords differ. -->
            <button type="submit" :disabled="submitting" :class="buttonClass">
              {{ submitting ? 'Setting password…' : 'Set password and continue' }}
            </button>
          </form>
        </template>

      </section>
    </main>
  </div>
</template>
