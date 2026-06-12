<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { signIn, signUp, confirmSignUp, getCurrentUser, resendSignUpCode } from 'aws-amplify/auth'
import { useRouter } from 'vue-router'
import { CForm, CFormLabel, CFormInput, CButton } from '@coreui/vue'

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

async function handleSignIn() {
  clearError()
  loading.value = true
  try {
    const result = await signIn({ username: siEmail.value.trim(), password: siPassword.value })
    if (result.isSignedIn) {
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
const pendingEmail     = ref('')
const pendingPassword  = ref('')
const pendingFirstName = ref('')
const pendingLastName  = ref('')

const passwordBars = computed((): number => {
  const p = suPassword.value
  if (!p) return 0
  let score = 0
  if (p.length >= 8) score++
  if (/[A-Z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  return score
})

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
    const { nextStep: ns } = await signUp({
      username: suEmail.value.trim(),
      password: suPassword.value,
      options: {
        userAttributes: {
          email: suEmail.value.trim(),
          given_name: suFirstName.value.trim(),
        },
      },
    })
    if (ns.signUpStep === 'CONFIRM_SIGN_UP') {
      pendingEmail.value     = suEmail.value.trim()
      pendingPassword.value  = suPassword.value
      pendingFirstName.value = suFirstName.value.trim()
      pendingLastName.value  = suLastName.value.trim()
      confirmCode.value      = ''
      step.value             = 'confirm'
    } else {
      router.push('/')
    }
  } catch (e: unknown) {
    error.value = (e as Error).message ?? 'Sign up failed.'
  } finally {
    loading.value = false
  }
}

// ─── Account creation (detached — called separately after onboarding) ─────────
// async function createAccount() {
//   const session = await fetchAuthSession()
//   const token = session.tokens?.accessToken?.toString()
//   await fetch('https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/account', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       'Authorization': `Bearer ${token}`,
//       'X-Project': 'web',
//     },
//     body: JSON.stringify({
//       account_name: `${pendingFirstName.value} ${pendingLastName.value}`,
//       email: pendingEmail.value,
//       chain: 'TRON',
//       provider: 'PCF0001',
//       accounting_currency: 'USD',
//     }),
//   })
// }

// ─── Confirm sign up ───────────────────────────────────────────────────────────
const confirmCode = ref('')

async function handleConfirm() {
  clearError()
  loading.value = true
  try {
    const { isSignUpComplete } = await confirmSignUp({
      username: pendingEmail.value,
      confirmationCode: confirmCode.value.trim(),
    })
    if (isSignUpComplete) {
      await signIn({ username: pendingEmail.value, password: pendingPassword.value })
      // await createAccount()
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
    await resendSignUpCode({ username: pendingEmail.value })
  } catch (e: unknown) {
    error.value = (e as Error).message ?? 'Could not resend code.'
  }
}

// ─── Redirect if already authenticated ────────────────────────────────────────
onMounted(async () => {
  try {
    await getCurrentUser()
    router.push('/dashboard')
  } catch {
    // Not signed in — stay on auth page
  }
})
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop">
    <main class="w-full max-w-[390px] mx-auto flex flex-col gap-space-8 relative z-10">

      <!-- ── Header ─────────────────────────────────────────────────────── -->
      <header class="text-center flex flex-col items-center gap-space-4">
        <div
          class="h-12 w-12 rounded-xl bg-surface-container-high border border-border-subtle
                 flex items-center justify-center text-accent-lime
                 shadow-[0_0_15px_rgba(204,255,0,0.1)]"
          aria-hidden="true"
        >
          <span class="material-symbols-outlined" style="font-size: 24px;">deployed_code</span>
        </div>
        <div>
          <h1 class="font-headline-h1-mobile text-headline-h1-mobile text-text-primary font-semibold mb-space-2">
            <template v-if="activeTab === 'signUp' && step === 'form'">Create account</template>
            <template v-else>Loudibly</template>
          </h1>
          <p class="font-body-base text-body-base text-text-secondary">
            <template v-if="step === 'confirm'">Check your inbox</template>
            <template v-else-if="activeTab === 'signUp'">Join Loudibly Infrastructure</template>
            <template v-else>Your account, your assets.</template>
          </p>
        </div>
      </header>

      <!-- ── Auth card ────────────────────────────────────────────────────── -->
      <section
        class="bg-surface-container-low border border-border-subtle rounded-lg p-space-8
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

          <CForm @submit.prevent="handleConfirm" class="flex flex-col gap-space-4">
            <p v-if="error" role="alert" class="font-body-base text-body-base text-status-danger text-center">
              {{ error }}
            </p>

            <div class="flex flex-col gap-space-2">
              <CFormLabel for="confirm-code" class="font-body-base text-body-base text-text-secondary">
                Verification code
              </CFormLabel>
              <div class="relative flex items-center bg-surface-container-high border border-border-subtle rounded input-focus-ring transition-all duration-200">
                <span class="material-symbols-outlined text-text-secondary absolute left-space-3 text-[18px] pointer-events-none select-none">
                  pin
                </span>
                <CFormInput
                  id="confirm-code"
                  v-model="confirmCode"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="000000"
                  maxlength="6"
                  required
                  class="w-full bg-transparent border-none shadow-none ring-0 text-text-primary
                         font-label-mono-base text-label-mono-base py-space-3 pl-10 pr-space-3
                         placeholder:text-text-secondary/50 focus:ring-0 focus:shadow-none"
                />
              </div>
            </div>

            <CButton
              type="submit"
              :disabled="loading"
              class="mt-space-4 w-full bg-accent-lime text-black font-body-large text-body-large
                     font-bold py-space-3 rounded border-0 hover:bg-[#d6ff33] transition-colors
                     active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {{ loading ? 'Verifying…' : 'Verify email' }}
            </CButton>

            <p class="text-center font-body-base text-body-base text-text-secondary">
              Didn't receive it?
              <button
                type="button"
                @click="handleResend"
                class="text-text-primary font-bold hover:text-accent-lime transition-colors
                       underline decoration-border-subtle hover:decoration-accent-lime underline-offset-4"
              >
                Resend code
              </button>
            </p>
          </CForm>
        </template>

        <!-- ── Main form (sign in / sign up tabs) ─────────────────────────── -->
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
                ? 'font-bold text-text-primary border-b-2 border-accent-lime'
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
                ? 'font-bold text-text-primary border-b-2 border-accent-lime'
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
            <CForm @submit.prevent="handleSignIn" class="flex flex-col gap-space-4">
              <p v-if="error && activeTab === 'signIn'" role="alert"
                 class="font-body-base text-body-base text-status-danger">
                {{ error }}
              </p>

              <div class="flex flex-col gap-space-2">
                <CFormLabel for="si-email" class="font-body-base text-body-base text-text-secondary">
                  Email Address
                </CFormLabel>
                <div class="relative flex items-center bg-surface-container-high border border-border-subtle rounded input-focus-ring transition-all duration-200">
                  <span class="material-symbols-outlined text-text-secondary absolute left-space-3 text-[18px] pointer-events-none select-none">
                    mail
                  </span>
                  <CFormInput
                    id="si-email"
                    v-model="siEmail"
                    type="email"
                    autocomplete="email"
                    placeholder="operator@domain.com"
                    required
                    class="w-full bg-transparent border-none shadow-none ring-0 text-text-primary
                           font-label-mono-base text-label-mono-base py-space-3 pl-10 pr-space-3
                           placeholder:text-text-secondary/50 focus:ring-0 focus:shadow-none"
                  />
                </div>
              </div>

              <div class="flex flex-col gap-space-2">
                <div class="flex justify-between items-baseline">
                  <CFormLabel for="si-password" class="font-body-base text-body-base text-text-secondary">
                    Password
                  </CFormLabel>
                  <a
                    href="#"
                    class="font-caption text-caption text-text-secondary hover:text-accent-lime transition-colors"
                  >
                    Forgot password?
                  </a>
                </div>
                <div class="relative flex items-center bg-surface-container-high border border-border-subtle rounded input-focus-ring transition-all duration-200">
                  <span class="material-symbols-outlined text-text-secondary absolute left-space-3 text-[18px] pointer-events-none select-none">
                    lock
                  </span>
                  <CFormInput
                    id="si-password"
                    v-model="siPassword"
                    type="password"
                    autocomplete="current-password"
                    placeholder="••••••••"
                    required
                    class="w-full bg-transparent border-none shadow-none ring-0 text-text-primary
                           font-label-mono-base text-label-mono-base py-space-3 pl-10 pr-space-3
                           placeholder:text-text-secondary/50 focus:ring-0 focus:shadow-none"
                  />
                </div>
              </div>

              <CButton
                type="submit"
                :disabled="loading"
                class="mt-space-4 w-full bg-accent-lime text-black font-body-large text-body-large
                       font-bold py-space-3 rounded border-0 hover:bg-[#d6ff33] transition-colors
                       active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {{ loading ? 'Signing in…' : 'Sign In' }}
              </CButton>
            </CForm>
          </div>

          <!-- ── Create Account panel ──────────────────────────────────────── -->
          <div
            v-show="activeTab === 'signUp'"
            id="panel-signup"
            role="tabpanel"
            aria-labelledby="tab-signup"
          >
            <CForm @submit.prevent="handleSignUp" class="flex flex-col gap-space-4">
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
                    class="w-full bg-surface-container-high border border-border-subtle rounded
                           text-text-primary font-label-mono-base text-label-mono-base
                           px-space-4 py-space-3 placeholder:text-text-muted/80
                           focus:outline-none focus:border-accent-lime
                           focus:shadow-[0_0_0_2px_rgba(204,255,0,0.1)] transition-all duration-200"
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
                    class="w-full bg-surface-container-high border border-border-subtle rounded
                           text-text-primary font-label-mono-base text-label-mono-base
                           px-space-4 py-space-3 placeholder:text-text-muted/80
                           focus:outline-none focus:border-accent-lime
                           focus:shadow-[0_0_0_2px_rgba(204,255,0,0.1)] transition-all duration-200"
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
                  class="w-full bg-surface-container-high border border-border-subtle rounded
                         text-text-primary font-label-mono-base text-label-mono-base
                         px-space-4 py-space-3 placeholder:text-text-muted/80
                         focus:outline-none focus:border-accent-lime
                         focus:shadow-[0_0_0_2px_rgba(204,255,0,0.1)] transition-all duration-200"
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
                    class="w-full bg-surface-container-high border border-border-subtle rounded
                           text-text-primary font-label-mono-base text-label-mono-base
                           px-space-4 py-space-3 pr-10 placeholder:text-text-muted/80
                           focus:outline-none focus:border-accent-lime
                           focus:shadow-[0_0_0_2px_rgba(204,255,0,0.1)] transition-all duration-200"
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
                      :class="i <= passwordBars ? 'bg-accent-lime' : 'bg-surface-container-highest'"
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
                    class="w-full bg-surface-container-high border border-border-subtle rounded
                           text-text-primary font-label-mono-base text-label-mono-base
                           px-space-4 py-space-3 pr-10 placeholder:text-text-muted/80
                           focus:outline-none focus:border-accent-lime
                           focus:shadow-[0_0_0_2px_rgba(204,255,0,0.1)] transition-all duration-200"
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
                <CButton
                  type="submit"
                  :disabled="loading"
                  class="w-full bg-accent-lime text-black font-body-large text-body-large
                         font-bold py-space-3 rounded border-0 hover:bg-[#d6ff33] transition-colors
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
                </CButton>
              </div>
            </CForm>
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
              class="text-text-primary font-bold hover:text-accent-lime transition-colors
                     underline decoration-border-subtle hover:decoration-accent-lime underline-offset-4"
            >
              Sign up
            </button>
          </template>
          <template v-else>
            Already have an account?
            <button
              type="button"
              @click="switchTab('signIn')"
              class="text-text-primary font-bold hover:text-accent-lime transition-colors
                     underline decoration-border-subtle hover:decoration-accent-lime underline-offset-4"
            >
              Sign in
            </button>
          </template>
        </p>
      </div>

    </main>

    <!-- Ambient glow -->
    <div
      class="fixed top-0 left-0 w-full h-full pointer-events-none z-[-1] opacity-20
             overflow-hidden flex items-center justify-center"
      aria-hidden="true"
    >
      <div class="w-[800px] h-[800px] rounded-full bg-accent-lime/5 blur-[120px]"></div>
    </div>
  </div>
</template>
