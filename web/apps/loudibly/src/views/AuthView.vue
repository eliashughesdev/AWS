<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { signIn, signUp, confirmSignUp, getCurrentUser, resendSignUpCode, fetchAuthSession } from 'aws-amplify/auth'
import { useRoute, useRouter } from 'vue-router'
import { CForm, CFormLabel, CFormInput, CButton } from '@coreui/vue'
import { deriveTronAddress, generateTronWallet } from '../wallet/tron'
import { deriveSolanaAddress, generateSolanaWallet } from '../wallet/solana'
import { useWalletSession } from '../wallet/session'
import { CHAINS, chainLabels, type Chain } from '../wallet/types'
import BrandLogo from '../components/BrandLogo.vue'
import { brand } from '../brands'
import { API_BASE } from '../config'

const PENDING_PROFILE_KEY = 'loudibly.pendingProfile'

const route  = useRoute()
const router = useRouter()

// ─── Mode / Tab / Step state ───────────────────────────────────────────────────
type Mode = 'custodial' | 'nonCustodial'
type Tab  = 'signIn' | 'signUp'
type Step = 'form' | 'confirm' | 'ncKey'

const mode      = ref<Mode>('custodial')
const activeTab = ref<Tab>('signIn')
const step      = ref<Step>('form')

// ─── Shared ────────────────────────────────────────────────────────────────────
const loading = ref(false)
const error   = ref('')

const verifiedBanner = ref(false)

function clearError() { error.value = '' }

// Saves the name captured at signup once a session exists. Stored in localStorage
// because link-based confirmation happens in a new tab with fresh component state.
async function flushPendingProfile() {
  const raw = localStorage.getItem(PENDING_PROFILE_KEY)
  if (!raw) return
  try {
    const { name, email } = JSON.parse(raw)
    const session = await fetchAuthSession()
    const token = session.tokens?.accessToken?.toString()
    if (!token || !name) return
    await fetch(`${API_BASE}/accounts/profile/save`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Project': 'web', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    })
    localStorage.removeItem(PENDING_PROFILE_KEY)
  } catch (e) {
    console.error('Failed to save pending profile', e)
  }
}

function switchTab(tab: Tab) {
  activeTab.value = tab
  step.value      = 'form'
  clearError()
}

// ─── Non-custodial (anonymous) ─────────────────────────────────────────────────
// No Cognito, no server record: the key is the credential. It is derived to an
// address in the browser and held in memory for this session only.
const session = useWalletSession()

const ncChain      = ref<Chain>('TRON')
const ncPrivateKey = ref('')
const ncGenerated  = ref<{ address: string; privateKey: string } | null>(null)
const ncKeySaved   = ref(false)
const ncCopied     = ref(false)

function switchMode(m: Mode) {
  mode.value         = m
  step.value         = 'form'
  ncPrivateKey.value = ''
  ncGenerated.value  = null
  ncKeySaved.value   = false
  clearError()
}

function deriveAddress(chain: Chain, privateKey: string): string {
  return chain === 'SOL' ? deriveSolanaAddress(privateKey) : deriveTronAddress(privateKey)
}

function handleNonCustodialSignIn() {
  clearError()
  const key = ncPrivateKey.value.trim()
  if (!key) {
    error.value = 'Enter your private key.'
    return
  }
  try {
    const address = deriveAddress(ncChain.value, key)
    session.addWallet({ chain: ncChain.value, address, privateKey: key })
    ncPrivateKey.value = ''
    router.push({ name: 'wallet' })
  } catch (e: unknown) {
    error.value = (e as Error).message ?? 'Invalid private key.'
  }
}

async function handleNonCustodialGenerate() {
  clearError()
  loading.value = true
  try {
    const wallet = ncChain.value === 'SOL'
      ? generateSolanaWallet()
      : await generateTronWallet()
    ncGenerated.value = { address: wallet.address, privateKey: wallet.privateKey }
    ncKeySaved.value  = false
    step.value        = 'ncKey'
  } catch (e: unknown) {
    error.value = 'Failed to generate wallet. Please try again.'
    console.error(e)
  } finally {
    loading.value = false
  }
}

async function copyNcKey() {
  if (!ncGenerated.value) return
  await navigator.clipboard.writeText(ncGenerated.value.privateKey)
  ncCopied.value = true
  setTimeout(() => { ncCopied.value = false }, 2000)
}

function activateNonCustodial() {
  if (!ncGenerated.value || !ncKeySaved.value) return
  session.addWallet({
    chain: ncChain.value,
    address: ncGenerated.value.address,
    privateKey: ncGenerated.value.privateKey,
  })
  ncGenerated.value = null
  router.push({ name: 'wallet' })
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
      await flushPendingProfile()
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
        },
      },
    })
    if (ns.signUpStep === 'CONFIRM_SIGN_UP') {
      pendingEmail.value     = suEmail.value.trim()
      pendingPassword.value  = suPassword.value
      pendingFirstName.value = suFirstName.value.trim()
      pendingLastName.value  = suLastName.value.trim()
      localStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify({
        name: `${pendingFirstName.value} ${pendingLastName.value}`.trim(),
        email: pendingEmail.value,
      }))
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
    let confirmed = false
    try {
      const { isSignUpComplete } = await confirmSignUp({
        username: pendingEmail.value,
        confirmationCode: confirmCode.value.trim(),
      })
      confirmed = isSignUpComplete
    } catch (e: unknown) {
      // Already confirmed via the email link — proceed to sign in
      const msg = (e as Error).message ?? ''
      if (!msg.includes('Current status is CONFIRMED')) throw e
      confirmed = true
    }
    if (confirmed) {
      await signIn({ username: pendingEmail.value, password: pendingPassword.value })
      await flushPendingProfile()
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
  if (route.query.verified === '1') {
    verifiedBanner.value = true
    if (typeof route.query.email === 'string') siEmail.value = route.query.email
  }
  try {
    await getCurrentUser()
    router.push({ name: 'dashboard', query: route.query.verified === '1' ? { verified: '1' } : {} })
  } catch {
    // Not signed in — stay on auth page
  }
})
</script>

<template>
  <div class="min-h-screen bg-page-gradient flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop">
    <main class="w-full max-w-[390px] mx-auto flex flex-col gap-space-8 relative z-10">

      <!-- ── Header ─────────────────────────────────────────────────────── -->
      <header class="text-center flex flex-col items-center gap-space-4">
        <BrandLogo variant="mark" size="lg" />
        <div>
          <h1
            v-if="activeTab === 'signUp' && step === 'form'"
            class="font-headline-h1-mobile text-headline-h1-mobile text-text-primary font-extrabold uppercase tracking-wide mb-space-2"
          >
            Create account
          </h1>
          <!-- Brands without a logo image carry their name here instead -->
          <h1
            v-else-if="!brand.logoSrc"
            class="font-headline-h1-mobile text-headline-h1-mobile text-text-primary font-semibold mb-space-2"
          >
            {{ brand.name }}
          </h1>
          <p class="font-body-base text-body-base text-text-secondary">
            <template v-if="step === 'confirm'">Check your inbox</template>
            <template v-else-if="step === 'ncKey'">Save your private key</template>
            <template v-else-if="mode === 'nonCustodial'">Your keys, your assets. No account, no trace.</template>
            <template v-else-if="activeTab === 'signUp'">Join {{ brand.name }}</template>
            <template v-else>Your account, your assets.</template>
          </p>
        </div>
      </header>

      <!-- ── Auth card ────────────────────────────────────────────────────── -->
      <section
        class="bg-surface-1 border border-border-subtle rounded-lg p-space-8
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
              <div class="relative flex items-center bg-surface-2 border border-border-subtle rounded focus-ring transition-all duration-200">
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
              class="mt-space-4 w-full bg-brand text-on-brand font-body-large text-body-large
                     font-bold py-space-3 rounded-full border-0 hover:bg-brand-hover transition-colors
                     active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {{ loading ? 'Verifying…' : 'Verify email' }}
            </CButton>

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
          </CForm>
        </template>

        <!-- ── Non-custodial: the generated key, shown once ────────────────── -->
        <template v-else-if="step === 'ncKey'">
          <div class="flex items-start gap-space-3 p-space-4 bg-status-danger/10 border border-status-danger/30 rounded">
            <span class="material-symbols-outlined text-status-danger shrink-0" style="font-size: 20px;">lock</span>
            <p class="font-body-base text-body-base text-status-danger leading-relaxed">
              <strong>This is the only time your private key will be shown.</strong>
              It is the only way back into this account — {{ brand.name }} stores nothing about it.
              Copy it somewhere safe before continuing.
            </p>
          </div>

          <div class="flex flex-col gap-space-2">
            <label class="font-caption text-caption uppercase tracking-widest text-text-secondary">
              Your private key ({{ chainLabels[ncChain] }})
            </label>
            <div class="relative">
              <div class="w-full bg-surface-2 border border-border-subtle rounded
                          px-space-4 py-space-3 font-label-mono-base text-label-mono-base
                          text-text-primary break-all pr-20">
                {{ ncGenerated?.privateKey }}
              </div>
              <button
                type="button"
                @click="copyNcKey"
                class="absolute right-2 top-1/2 -translate-y-1/2 px-space-3 py-1.5 bg-brand
                       text-on-brand font-caption text-caption font-bold rounded hover:bg-brand-hover transition-colors"
              >
                {{ ncCopied ? 'Copied!' : 'Copy' }}
              </button>
            </div>
          </div>

          <div class="flex flex-col gap-space-2">
            <label class="font-caption text-caption uppercase tracking-widest text-text-secondary">
              Your wallet address
            </label>
            <div class="w-full bg-surface-2 border border-border-subtle rounded
                        px-space-4 py-space-3 font-label-mono-base text-label-mono-base
                        text-text-secondary break-all">
              {{ ncGenerated?.address }}
            </div>
          </div>

          <label class="flex items-start gap-space-3 cursor-pointer">
            <input type="checkbox" v-model="ncKeySaved" class="mt-1 shrink-0 accent-brand" />
            <span class="font-body-base text-body-base text-text-secondary leading-relaxed">
              I have saved my private key. I understand it is never stored and cannot be recovered —
              losing it means permanently losing this account and its funds.
            </span>
          </label>

          <p v-if="error" role="alert" class="font-body-base text-body-base text-status-danger">
            {{ error }}
          </p>

          <CButton
            type="button"
            :disabled="!ncKeySaved"
            @click="activateNonCustodial"
            class="w-full bg-brand text-on-brand font-body-large text-body-large font-bold
                   py-space-3 rounded-full border-0 hover:bg-brand-hover transition-colors
                   active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Enter wallet
          </CButton>

          <button
            type="button"
            @click="switchMode('nonCustodial')"
            class="font-caption text-caption text-text-secondary hover:text-text-primary transition-colors"
          >
            ← Back
          </button>
        </template>

        <!-- ── Main form (mode → sign in / sign up tabs) ───────────────────── -->
        <template v-else>

          <!-- Mode: which universe you sign into -->
          <div
            role="group"
            aria-label="Account mode"
            class="flex bg-surface-2 border border-border-subtle rounded p-1 gap-1"
          >
            <button
              type="button"
              @click="switchMode('custodial')"
              :aria-pressed="mode === 'custodial'"
              class="flex-1 py-space-2 rounded font-body-base text-body-base font-bold transition-all"
              :class="mode === 'custodial'
                ? 'bg-brand text-on-brand'
                : 'text-text-secondary hover:text-text-primary'"
            >
              Custodial
            </button>
            <button
              type="button"
              @click="switchMode('nonCustodial')"
              :aria-pressed="mode === 'nonCustodial'"
              class="flex-1 py-space-2 rounded font-body-base text-body-base font-bold transition-all"
              :class="mode === 'nonCustodial'
                ? 'bg-brand text-on-brand'
                : 'text-text-secondary hover:text-text-primary'"
            >
              Non-Custodial
            </button>
          </div>

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
            v-show="mode === 'custodial' && activeTab === 'signIn'"
            id="panel-signin"
            role="tabpanel"
            aria-labelledby="tab-signin"
          >
            <CForm @submit.prevent="handleSignIn" class="flex flex-col gap-space-4">
              <p v-if="verifiedBanner" role="status"
                 class="font-body-base text-body-base text-brand text-center">
                Your email has been verified — sign in to continue.
              </p>
              <p v-if="error && activeTab === 'signIn'" role="alert"
                 class="font-body-base text-body-base text-status-danger">
                {{ error }}
              </p>

              <div class="flex flex-col gap-space-2">
                <CFormLabel for="si-email" class="font-body-base text-body-base text-text-secondary">
                  Email Address
                </CFormLabel>
                <div class="relative flex items-center bg-surface-2 border border-border-subtle rounded focus-ring transition-all duration-200">
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
                    class="font-caption text-caption text-text-secondary hover:text-brand transition-colors"
                  >
                    Forgot password?
                  </a>
                </div>
                <div class="relative flex items-center bg-surface-2 border border-border-subtle rounded focus-ring transition-all duration-200">
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
                class="mt-space-4 w-full bg-brand text-on-brand font-body-large text-body-large
                       font-bold py-space-3 rounded-full border-0 hover:bg-brand-hover transition-colors
                       active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {{ loading ? 'Signing in…' : 'Sign In' }}
              </CButton>
            </CForm>
          </div>

          <!-- ── Create Account panel ──────────────────────────────────────── -->
          <div
            v-show="mode === 'custodial' && activeTab === 'signUp'"
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
                    class="w-full bg-surface-2 border border-border-subtle rounded
                           text-text-primary font-label-mono-base text-label-mono-base
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
                           text-text-primary font-label-mono-base text-label-mono-base
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
                         text-text-primary font-label-mono-base text-label-mono-base
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
                           text-text-primary font-label-mono-base text-label-mono-base
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
                           text-text-primary font-label-mono-base text-label-mono-base
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
                <CButton
                  type="submit"
                  :disabled="loading"
                  class="w-full bg-brand text-on-brand font-body-large text-body-large
                         font-bold py-space-3 rounded-full border-0 hover:bg-brand-hover transition-colors
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

          <!-- ── Non-custodial: Sign In (private key) ───────────────────────── -->
          <div
            v-show="mode === 'nonCustodial' && activeTab === 'signIn'"
            id="panel-nc-signin"
            role="tabpanel"
            aria-labelledby="tab-signin"
          >
            <CForm @submit.prevent="handleNonCustodialSignIn" class="flex flex-col gap-space-4">
              <p v-if="error" role="alert" class="font-body-base text-body-base text-status-danger">
                {{ error }}
              </p>

              <div class="flex flex-col gap-space-2">
                <label for="nc-chain" class="font-body-base text-[13px] font-medium text-text-secondary">
                  Blockchain
                </label>
                <select
                  id="nc-chain"
                  v-model="ncChain"
                  class="w-full bg-surface-2 border border-border-subtle rounded
                         text-text-primary font-label-mono-base text-label-mono-base
                         px-space-4 py-space-3 focus:outline-none focus:border-brand
                         focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200"
                >
                  <option v-for="c in CHAINS" :key="c" :value="c">{{ chainLabels[c] }}</option>
                </select>
              </div>

              <div class="flex flex-col gap-space-2">
                <label for="nc-key" class="font-body-base text-[13px] font-medium text-text-secondary">
                  Private key
                </label>
                <input
                  id="nc-key"
                  v-model="ncPrivateKey"
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="Paste your private key"
                  required
                  class="w-full bg-surface-2 border border-border-subtle rounded
                         text-text-primary font-label-mono-base text-label-mono-base
                         px-space-4 py-space-3 placeholder:text-text-muted/80
                         focus:outline-none focus:border-brand
                         focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200"
                />
                <p class="font-caption text-caption text-text-muted">
                  Your key never leaves this browser and is never stored — you re-enter it each session.
                </p>
              </div>

              <CButton
                type="submit"
                class="mt-space-4 w-full bg-brand text-on-brand font-body-large text-body-large
                       font-bold py-space-3 rounded-full border-0 hover:bg-brand-hover transition-colors
                       active:scale-[0.98]"
              >
                Unlock Wallet
              </CButton>
            </CForm>
          </div>

          <!-- ── Non-custodial: Create Account (generate) ───────────────────── -->
          <div
            v-show="mode === 'nonCustodial' && activeTab === 'signUp'"
            id="panel-nc-signup"
            role="tabpanel"
            aria-labelledby="tab-signup"
          >
            <CForm @submit.prevent="handleNonCustodialGenerate" class="flex flex-col gap-space-4">
              <p v-if="error" role="alert" class="font-body-base text-body-base text-status-danger">
                {{ error }}
              </p>

              <div class="flex items-start gap-space-3 p-space-4 bg-amber-400/10 border border-amber-400/30 rounded">
                <span class="material-symbols-outlined text-amber-400 shrink-0" style="font-size: 20px;">key</span>
                <p class="font-body-base text-body-base text-amber-300 leading-relaxed">
                  Your key is generated in this browser and never sent to us. No email, no identity —
                  the key alone is your account.
                  <strong>Lose it and the account and its funds are gone for good.</strong>
                </p>
              </div>

              <div class="flex flex-col gap-space-2">
                <label for="nc-chain-new" class="font-body-base text-[13px] font-medium text-text-secondary">
                  Blockchain
                </label>
                <select
                  id="nc-chain-new"
                  v-model="ncChain"
                  class="w-full bg-surface-2 border border-border-subtle rounded
                         text-text-primary font-label-mono-base text-label-mono-base
                         px-space-4 py-space-3 focus:outline-none focus:border-brand
                         focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200"
                >
                  <option v-for="c in CHAINS" :key="c" :value="c">{{ chainLabels[c] }}</option>
                </select>
              </div>

              <CButton
                type="submit"
                :disabled="loading"
                class="mt-space-2 w-full bg-brand text-on-brand font-body-large text-body-large
                       font-bold py-space-3 rounded-full border-0 hover:bg-brand-hover transition-colors
                       active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {{ loading ? 'Generating…' : 'Generate Wallet' }}
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

    <!-- Ambient glow -->
    <div
      class="fixed top-0 left-0 w-full h-full pointer-events-none z-[-1] opacity-20
             overflow-hidden flex items-center justify-center"
      aria-hidden="true"
    >
      <div class="w-[800px] h-[800px] rounded-full bg-brand/5 blur-[120px]"></div>
    </div>
  </div>
</template>
