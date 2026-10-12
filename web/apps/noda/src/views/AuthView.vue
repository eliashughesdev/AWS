<script setup lang="ts">
// Loudibly's sign-in screen (apps/loudibly/src/views/AuthView.vue) without its non-custodial
// mode, until the client supplies a design. Its colour and type names are in assets/auth.css.
import { ref, computed, onMounted } from 'vue'
import { signInWithPassword, isSignedIn } from '@loudibly/core/auth/signIn'
import { useSignUp, passwordStrength } from '@loudibly/core/composables/useSignUp'
import { useRoute, useRouter } from 'vue-router'
import logoMark from '../assets/logo-mark.png'
import logoWordmark from '../assets/logo-wordmark.png'

const route  = useRoute()
const router = useRouter()

// ─── Tab / Step state ──────────────────────────────────────────────────────────
type Tab  = 'signIn' | 'signUp'
type Step = 'form' | 'confirm'

const activeTab = ref<Tab>('signIn')
const step      = ref<Step>('form')

// ─── Shared ────────────────────────────────────────────────────────────────────
const loading = ref(false)
const error   = ref('')

function clearError() { error.value = '' }

function switchTab(tab: Tab) {
  activeTab.value = tab
  step.value      = 'form'
  clearError()
}

// ─── Sign In ───────────────────────────────────────────────────────────────────
const siEmail    = ref('')
const siPassword = ref('')

// The emailed links end here when there is no session: with the address to sign in with,
// and `verified` when the link confirmed it.
const verifiedBanner = ref(false)

async function handleSignIn() {
  clearError()
  loading.value = true
  try {
    if (await signInWithPassword(siEmail.value.trim(), siPassword.value)) {
      router.push('/dashboard')
    }
  } catch (e: unknown) {
    error.value = (e as Error).message ?? 'Sign in failed.'
  } finally {
    loading.value = false
  }
}

// ─── Sign Up ───────────────────────────────────────────────────────────────────
const suFirstName   = ref('')
const suLastName    = ref('')
const suEmail       = ref('')
const suPassword    = ref('')
const suConfirmPass = ref('')
const showSuPass    = ref(false)
const showSuConfirm = ref(false)

const { pendingEmail, register, confirm, resend } = useSignUp()

const passwordBars = computed((): number => passwordStrength(suPassword.value))

const passwordStrengthLabel = computed((): string => {
  return (['', 'Weak', 'Fair', 'Good', 'Strong'] as const)[passwordBars.value] ?? ''
})

async function handleSignUp() {
  clearError()
  if (suPassword.value !== suConfirmPass.value) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    const needsCode = await register({
      email:     suEmail.value.trim(),
      password:  suPassword.value,
      firstName: suFirstName.value.trim(),
      lastName:  suLastName.value.trim(),
    })
    if (needsCode) {
      confirmCode.value = ''
      step.value        = 'confirm'
    } else {
      router.push('/')
    }
  } catch (e: unknown) {
    error.value = (e as Error).message ?? 'Sign up failed.'
  } finally {
    loading.value = false
  }
}

// ─── Confirm sign up ───────────────────────────────────────────────────────────
const confirmCode = ref('')

async function handleConfirm() {
  clearError()
  loading.value = true
  try {
    if (await confirm(confirmCode.value.trim())) {
      router.push('/dashboard')
    }
  } catch (e: unknown) {
    error.value = (e as Error).message ?? 'Confirmation failed.'
  } finally {
    loading.value = false
  }
}

async function handleResend() {
  clearError()
  try {
    await resend()
  } catch (e: unknown) {
    error.value = (e as Error).message ?? 'Could not resend code.'
  }
}

// ─── Redirect if already authenticated ────────────────────────────────────────
onMounted(async () => {
  if (typeof route.query.email === 'string') siEmail.value = route.query.email
  verifiedBanner.value = route.query.verified === '1'
  if (await isSignedIn()) router.push({ name: 'dashboard' })
})
</script>

<template>
  <div class="auth-screen min-h-screen bg-page-gradient flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop">
    <main class="w-full max-w-[390px] mx-auto flex flex-col gap-space-8 relative z-10">

      <!-- ── Header ─────────────────────────────────────────────────────── -->
      <header class="text-center flex flex-col items-center gap-space-4">
        <!-- The two cuts the app's header uses, in the proportions of Loudibly's logo image. -->
        <div class="flex items-center gap-[14px]">
          <img :src="logoMark" alt="" class="h-9" />
          <img :src="logoWordmark" alt="NODA" class="h-[25.6px] w-[108.4px]" />
        </div>
        <div>
          <h1
            v-if="activeTab === 'signUp' && step === 'form'"
            class="font-headline-h1-mobile text-headline-h1-mobile text-text-primary font-extrabold uppercase tracking-wide mb-space-2"
          >
            Create account
          </h1>
          <p class="font-body-base text-body-base text-text-secondary">
            <template v-if="step === 'confirm'">Check your inbox</template>
            <template v-else-if="activeTab === 'signUp'">Join NODA</template>
            <template v-else>Your account, your assets.</template>
          </p>
        </div>
      </header>

      <!-- ── Auth card ────────────────────────────────────────────────────── -->
      <section
        class="bg-surface-1 border border-border-subtle rounded p-space-8
               flex flex-col gap-space-6 shadow-2xl shadow-black/50"
      >

        <!-- ── Confirm step (email verification code) ─────────────────────── -->
        <template v-if="step === 'confirm'">
          <div class="flex flex-col gap-space-2 text-center">
            <h2 class="font-headline-h3 text-headline-h3 text-text-primary font-semibold">
              Verify your email
            </h2>
            <p class="font-body-base text-body-base text-text-secondary">
              Enter the 6-digit code sent to
              <span class="text-text-primary font-medium">{{ pendingEmail }}</span>
            </p>
          </div>

          <form @submit.prevent="handleConfirm" class="flex flex-col gap-space-4">
            <p v-if="error" role="alert" class="font-body-base text-body-base text-status-danger text-center">
              {{ error }}
            </p>

            <div class="flex flex-col gap-space-2">
              <label for="confirm-code" class="font-body-base text-body-base text-text-secondary">
                Verification code
              </label>
              <div class="relative flex items-center bg-surface-2 border border-border-subtle rounded focus-ring transition-all duration-200">
                <span class="material-symbols-outlined text-text-secondary absolute left-space-3 text-[18px] pointer-events-none select-none">
                  pin
                </span>
                <input
                  id="confirm-code"
                  v-model="confirmCode"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="000000"
                  maxlength="6"
                  required
                  class="w-full bg-transparent border-none shadow-none ring-0 text-text-primary
                         font-label-mono-base text-label-mono-base leading-6 py-space-3 pl-10 pr-space-3
                         placeholder:text-text-secondary/50 focus:ring-0 focus:shadow-none focus:outline-hidden"
                />
              </div>
            </div>

            <button
              type="submit"
              :disabled="loading"
              class="mt-space-4 w-full bg-brand text-on-brand font-body-large text-body-large
                     font-bold py-space-3 rounded-[12px] border-0 hover:bg-brand-hover transition-colors
                     active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {{ loading ? 'Verifying…' : 'Verify email' }}
            </button>

            <p class="text-center font-body-base text-body-base text-text-secondary">
              Didn't receive it?
              <button
                type="button"
                @click="handleResend"
                class="text-text-primary font-bold hover:text-brand transition-colors
                       underline decoration-border-subtle hover:decoration-brand underline-offset-4"
              >
                Resend code
              </button>
            </p>
          </form>
        </template>

        <!-- ── Main form (sign in / sign up tabs) ──────────────────────────── -->
        <template v-else>

          <!-- Tabs -->
          <nav
            role="tablist"
            aria-label="Authentication options"
            class="flex border-b border-border-subtle pb-space-2 gap-space-4"
          >
            <button
              id="tab-signin"
              role="tab"
              :aria-selected="activeTab === 'signIn'"
              aria-controls="panel-signin"
              @click="switchTab('signIn')"
              class="font-body-base text-body-base pb-space-2 -mb-[9px] px-space-2 transition-colors"
              :class="activeTab === 'signIn'
                ? 'font-bold text-text-primary border-b-2 border-brand'
                : 'text-text-secondary hover:text-text-primary'"
            >
              Sign In
            </button>
            <button
              id="tab-signup"
              role="tab"
              :aria-selected="activeTab === 'signUp'"
              aria-controls="panel-signup"
              @click="switchTab('signUp')"
              class="font-body-base text-body-base pb-space-2 -mb-[9px] px-space-2 transition-colors"
              :class="activeTab === 'signUp'
                ? 'font-bold text-text-primary border-b-2 border-brand'
                : 'text-text-secondary hover:text-text-primary'"
            >
              Create Account
            </button>
          </nav>

          <!-- ── Sign In panel ─────────────────────────────────────────────── -->
          <div
            v-show="activeTab === 'signIn'"
            id="panel-signin"
            role="tabpanel"
            aria-labelledby="tab-signin"
          >
            <form @submit.prevent="handleSignIn" class="flex flex-col gap-space-4">
              <p v-if="verifiedBanner" role="status"
                 class="font-body-base text-body-base text-brand text-center">
                Your email has been verified — sign in to continue.
              </p>
              <p v-if="error && activeTab === 'signIn'" role="alert"
                 class="font-body-base text-body-base text-status-danger">
                {{ error }}
              </p>

              <div class="flex flex-col gap-space-2">
                <label for="si-email" class="font-body-base text-body-base text-text-secondary">
                  Email Address
                </label>
                <div class="relative flex items-center bg-surface-2 border border-border-subtle rounded focus-ring transition-all duration-200">
                  <span class="material-symbols-outlined text-text-secondary absolute left-space-3 text-[18px] pointer-events-none select-none">
                    mail
                  </span>
                  <input
                    id="si-email"
                    v-model="siEmail"
                    type="email"
                    autocomplete="email"
                    placeholder="operator@domain.com"
                    required
                    class="w-full bg-transparent border-none shadow-none ring-0 text-text-primary
                           font-label-mono-base text-label-mono-base leading-6 py-space-3 pl-10 pr-space-3
                           placeholder:text-text-secondary/50 focus:ring-0 focus:shadow-none focus:outline-hidden"
                  />
                </div>
              </div>

              <div class="flex flex-col gap-space-2">
                <div class="flex justify-between items-baseline">
                  <label for="si-password" class="font-body-base text-body-base text-text-secondary">
                    Password
                  </label>
                  <a
                    href="#"
                    class="font-caption text-caption text-text-secondary hover:text-brand transition-colors"
                  >
                    Forgot password?
                  </a>
                </div>
                <div class="relative flex items-center bg-surface-2 border border-border-subtle rounded focus-ring transition-all duration-200">
                  <span class="material-symbols-outlined text-text-secondary absolute left-space-3 text-[18px] pointer-events-none select-none">
                    lock
                  </span>
                  <input
                    id="si-password"
                    v-model="siPassword"
                    type="password"
                    autocomplete="current-password"
                    placeholder="••••••••"
                    required
                    class="w-full bg-transparent border-none shadow-none ring-0 text-text-primary
                           font-label-mono-base text-label-mono-base leading-6 py-space-3 pl-10 pr-space-3
                           placeholder:text-text-secondary/50 focus:ring-0 focus:shadow-none focus:outline-hidden"
                  />
                </div>
              </div>

              <button
                type="submit"
                :disabled="loading"
                class="mt-space-4 w-full bg-brand text-on-brand font-body-large text-body-large
                       font-bold py-space-3 rounded-[12px] border-0 hover:bg-brand-hover transition-colors
                       active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {{ loading ? 'Signing in…' : 'Sign In' }}
              </button>
            </form>
          </div>

          <!-- ── Create Account panel ──────────────────────────────────────── -->
          <div
            v-show="activeTab === 'signUp'"
            id="panel-signup"
            role="tabpanel"
            aria-labelledby="tab-signup"
          >
            <form @submit.prevent="handleSignUp" class="flex flex-col gap-space-4">
              <p v-if="error && activeTab === 'signUp'" role="alert"
                 class="font-body-base text-body-base text-status-danger">
                {{ error }}
              </p>

              <!-- Name row -->
              <div class="grid grid-cols-2 gap-space-4">
                <div class="flex flex-col gap-space-2">
                  <label for="su-first-name"
                         class="font-body-base text-[13px] font-medium text-text-secondary">
                    First name
                  </label>
                  <input
                    id="su-first-name"
                    v-model="suFirstName"
                    type="text"
                    autocomplete="given-name"
                    placeholder="Jane"
                    required
                    class="w-full bg-surface-2 border border-border-subtle rounded
                           text-text-primary font-label-mono-base text-label-mono-base leading-6
                           px-space-4 py-space-3 placeholder:text-text-muted/80
                           focus:outline-none focus:border-brand
                           focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200"
                  />
                </div>
                <div class="flex flex-col gap-space-2">
                  <label for="su-last-name"
                         class="font-body-base text-[13px] font-medium text-text-secondary">
                    Last name
                  </label>
                  <input
                    id="su-last-name"
                    v-model="suLastName"
                    type="text"
                    autocomplete="family-name"
                    placeholder="Doe"
                    required
                    class="w-full bg-surface-2 border border-border-subtle rounded
                           text-text-primary font-label-mono-base text-label-mono-base leading-6
                           px-space-4 py-space-3 placeholder:text-text-muted/80
                           focus:outline-none focus:border-brand
                           focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200"
                  />
                </div>
              </div>

              <!-- Email -->
              <div class="flex flex-col gap-space-2">
                <label for="su-email"
                       class="font-body-base text-[13px] font-medium text-text-secondary">
                  Email address
                </label>
                <input
                  id="su-email"
                  v-model="suEmail"
                  type="email"
                  autocomplete="email"
                  placeholder="jane.doe@company.com"
                  required
                  class="w-full bg-surface-2 border border-border-subtle rounded
                         text-text-primary font-label-mono-base text-label-mono-base leading-6
                         px-space-4 py-space-3 placeholder:text-text-muted/80
                         focus:outline-none focus:border-brand
                         focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200"
                />
              </div>

              <!-- Password + strength indicator -->
              <div class="flex flex-col gap-space-2">
                <label for="su-password"
                       class="font-body-base text-[13px] font-medium text-text-secondary">
                  Password
                </label>
                <div class="relative">
                  <input
                    id="su-password"
                    v-model="suPassword"
                    :type="showSuPass ? 'text' : 'password'"
                    autocomplete="new-password"
                    placeholder="••••••••"
                    required
                    class="w-full bg-surface-2 border border-border-subtle rounded
                           text-text-primary font-label-mono-base text-label-mono-base leading-6
                           px-space-4 py-space-3 pr-10 placeholder:text-text-muted/80
                           focus:outline-none focus:border-brand
                           focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200"
                  />
                  <button
                    type="button"
                    @click="showSuPass = !showSuPass"
                    :aria-label="showSuPass ? 'Hide password' : 'Show password'"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary
                           hover:text-text-primary transition-colors"
                  >
                    <span class="material-symbols-outlined" style="font-size: 20px;">
                      {{ showSuPass ? 'visibility' : 'visibility_off' }}
                    </span>
                  </button>
                </div>
                <template v-if="suPassword">
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

              <!-- Confirm password -->
              <div class="flex flex-col gap-space-2">
                <label for="su-confirm"
                       class="font-body-base text-[13px] font-medium text-text-secondary">
                  Confirm password
                </label>
                <div class="relative">
                  <input
                    id="su-confirm"
                    v-model="suConfirmPass"
                    :type="showSuConfirm ? 'text' : 'password'"
                    autocomplete="new-password"
                    placeholder="••••••••"
                    required
                    class="w-full bg-surface-2 border border-border-subtle rounded
                           text-text-primary font-label-mono-base text-label-mono-base leading-6
                           px-space-4 py-space-3 pr-10 placeholder:text-text-muted/80
                           focus:outline-none focus:border-brand
                           focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200"
                  />
                  <button
                    type="button"
                    @click="showSuConfirm = !showSuConfirm"
                    :aria-label="showSuConfirm ? 'Hide password' : 'Show password'"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary
                           hover:text-text-primary transition-colors"
                  >
                    <span class="material-symbols-outlined" style="font-size: 20px;">
                      {{ showSuConfirm ? 'visibility' : 'visibility_off' }}
                    </span>
                  </button>
                </div>
              </div>

              <!-- Submit -->
              <div class="mt-space-2">
                <button
                  type="submit"
                  :disabled="loading"
                  class="w-full bg-brand text-on-brand font-body-large text-body-large
                         font-bold py-space-3 rounded-[12px] border-0 hover:bg-brand-hover transition-colors
                         active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed
                         flex items-center justify-center gap-space-2 group"
                >
                  <template v-if="loading">Creating account…</template>
                  <template v-else>
                    Create Account
                    <span
                      class="material-symbols-outlined group-hover:translate-x-1 transition-transform"
                      style="font-size: 18px;"
                    >arrow_forward</span>
                  </template>
                </button>
              </div>
            </form>
          </div>

        </template>
      </section>

      <!-- ── Footer ───────────────────────────────────────────────────────── -->
      <div class="text-center pt-space-4 pb-space-8">
        <p class="font-body-base text-body-base text-text-secondary">
          <template v-if="activeTab === 'signIn'">
            Don't have an account?
            <button
              type="button"
              @click="switchTab('signUp')"
              class="text-text-primary font-bold hover:text-brand transition-colors
                     underline decoration-border-subtle hover:decoration-brand underline-offset-4"
            >
              Sign up
            </button>
          </template>
          <template v-else>
            Already have an account?
            <button
              type="button"
              @click="switchTab('signIn')"
              class="text-text-primary font-bold hover:text-brand transition-colors
                     underline decoration-border-subtle hover:decoration-brand underline-offset-4"
            >
              Sign in
            </button>
          </template>
        </p>
      </div>

    </main>
  </div>
</template>
