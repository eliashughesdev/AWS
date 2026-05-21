<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
      router.push('/')
    }
  } catch (e: unknown) {
    error.value = (e as Error).message ?? 'Sign in failed.'
  } finally {
    loading.value = false
  }
}

// ─── Sign Up ───────────────────────────────────────────────────────────────────
const suEmail    = ref('')
const suPassword = ref('')
// Keep suEmail in scope for the confirm step auto-fill
const pendingEmail    = ref('')
const pendingPassword = ref('')

async function handleSignUp() {
  clearError()
  loading.value = true
  try {
    const { nextStep: ns } = await signUp({
      username: suEmail.value.trim(),
      password: suPassword.value,
      options: { userAttributes: { email: suEmail.value.trim() } },
    })
    if (ns.signUpStep === 'CONFIRM_SIGN_UP') {
      pendingEmail.value    = suEmail.value.trim()
      pendingPassword.value = suPassword.value
      confirmCode.value     = ''
      step.value            = 'confirm'
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
    const { isSignUpComplete } = await confirmSignUp({
      username: pendingEmail.value,
      confirmationCode: confirmCode.value.trim(),
    })
    if (isSignUpComplete) {
      await signIn({ username: pendingEmail.value, password: pendingPassword.value })
      router.push('/')
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
    router.push('/')
  } catch {
    // Not signed in — stay on auth page
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-margin-mobile md:p-margin-desktop">
    <main class="w-full max-w-[390px] flex flex-col gap-space-8">

      <!-- ── Header: logo mark + tagline ─────────────────────────────────── -->
      <header class="flex flex-col items-center text-center gap-space-4 pt-space-8">
        <!-- Geometric mark -->
        <div
          class="w-16 h-16 bg-surface-container-high rounded-xl border border-border-subtle
                 flex items-center justify-center relative overflow-hidden"
          aria-hidden="true"
        >
          <div class="absolute inset-0 bg-gradient-to-br from-accent-lime/20 to-transparent"></div>
          <div class="w-8 h-8 border-2 border-accent-lime rounded-full relative z-10 flex items-center justify-center">
            <div class="w-2 h-2 bg-text-primary rounded-full"></div>
          </div>
        </div>

        <div class="flex flex-col gap-space-2">
          <h1 class="font-headline-h1-mobile text-headline-h1-mobile text-text-primary font-semibold">
            FintechOS
          </h1>
          <p class="font-body-large text-body-large text-text-secondary">
            Your account, your assets.
          </p>
        </div>
      </header>

      <!-- ── Auth card ────────────────────────────────────────────────────── -->
      <section
        class="bg-[#141517] border border-border-subtle rounded-xl p-space-6
               flex flex-col gap-space-6 shadow-[0_4px_24px_rgba(0,0,0,0.4)]"
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
            <!-- Error -->
            <p v-if="error" role="alert" class="font-body-base text-body-base text-status-danger text-center">
              {{ error }}
            </p>

            <!-- Code field -->
            <div class="flex flex-col gap-space-2">
              <CFormLabel for="confirm-code" class="font-body-base text-body-base text-text-primary">
                Verification code
              </CFormLabel>
              <div class="relative flex items-center bg-[#141517] border border-border-subtle rounded input-focus-ring transition-all duration-200">
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

            <!-- Submit -->
            <CButton
              type="submit"
              :disabled="loading"
              class="mt-space-4 w-full bg-accent-lime text-black font-body-large text-body-large
                     font-bold py-space-3 rounded border-0 hover:bg-[#d6ff33] transition-colors
                     active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {{ loading ? 'Verifying…' : 'Verify email' }}
            </CButton>

            <!-- Resend -->
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
              <!-- Error -->
              <p v-if="error && activeTab === 'signIn'" role="alert"
                 class="font-body-base text-body-base text-status-danger">
                {{ error }}
              </p>

              <!-- Email -->
              <div class="flex flex-col gap-space-2">
                <CFormLabel for="si-email" class="font-body-base text-body-base text-text-primary">
                  Email Address
                </CFormLabel>
                <div class="relative flex items-center bg-[#141517] border border-border-subtle rounded input-focus-ring transition-all duration-200">
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

              <!-- Password -->
              <div class="flex flex-col gap-space-2">
                <div class="flex justify-between items-baseline">
                  <CFormLabel for="si-password" class="font-body-base text-body-base text-text-primary">
                    Password
                  </CFormLabel>
                  <a
                    href="#"
                    class="font-caption text-caption text-text-secondary hover:text-accent-lime transition-colors"
                  >
                    Forgot password?
                  </a>
                </div>
                <div class="relative flex items-center bg-[#141517] border border-border-subtle rounded input-focus-ring transition-all duration-200">
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

              <!-- Submit -->
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
              <!-- Error -->
              <p v-if="error && activeTab === 'signUp'" role="alert"
                 class="font-body-base text-body-base text-status-danger">
                {{ error }}
              </p>

              <!-- Email -->
              <div class="flex flex-col gap-space-2">
                <CFormLabel for="su-email" class="font-body-base text-body-base text-text-primary">
                  Email Address
                </CFormLabel>
                <div class="relative flex items-center bg-[#141517] border border-border-subtle rounded input-focus-ring transition-all duration-200">
                  <span class="material-symbols-outlined text-text-secondary absolute left-space-3 text-[18px] pointer-events-none select-none">
                    mail
                  </span>
                  <CFormInput
                    id="su-email"
                    v-model="suEmail"
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

              <!-- Password -->
              <div class="flex flex-col gap-space-2">
                <CFormLabel for="su-password" class="font-body-base text-body-base text-text-primary">
                  Password
                </CFormLabel>
                <div class="relative flex items-center bg-[#141517] border border-border-subtle rounded input-focus-ring transition-all duration-200">
                  <span class="material-symbols-outlined text-text-secondary absolute left-space-3 text-[18px] pointer-events-none select-none">
                    lock
                  </span>
                  <CFormInput
                    id="su-password"
                    v-model="suPassword"
                    type="password"
                    autocomplete="new-password"
                    placeholder="••••••••"
                    required
                    class="w-full bg-transparent border-none shadow-none ring-0 text-text-primary
                           font-label-mono-base text-label-mono-base py-space-3 pl-10 pr-space-3
                           placeholder:text-text-secondary/50 focus:ring-0 focus:shadow-none"
                  />
                </div>
              </div>

              <!-- Submit -->
              <CButton
                type="submit"
                :disabled="loading"
                class="mt-space-4 w-full bg-accent-lime text-black font-body-large text-body-large
                       font-bold py-space-3 rounded border-0 hover:bg-[#d6ff33] transition-colors
                       active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {{ loading ? 'Creating account…' : 'Create Account' }}
              </CButton>
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
  </div>
</template>
