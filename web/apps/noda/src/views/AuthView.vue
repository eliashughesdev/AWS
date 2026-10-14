<script setup lang="ts">
// Not in Figma: Loudibly's sign-in screen (apps/loudibly/src/views/AuthView.vue) without its
// non-custodial mode, drawn with the app's own panel, switch, fields and buttons (AuthFrame)
// until the client supplies a design. It follows the theme like every other view.
import { ref, computed, onMounted } from 'vue'
import { signInWithPassword, isSignedIn } from '@loudibly/core/auth/signIn'
import { useSignUp } from '@loudibly/core/composables/useSignUp'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AuthFrame from '../components/AuthFrame.vue'
import PasswordField from '../components/PasswordField.vue'
import { field, input, label, link, mainButton, message, stack } from '../authForm'

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

const { pendingEmail, register, confirm, resend } = useSignUp()

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

const tab = 'grid h-full place-items-center rounded-[10px] pb-[3px] lg:pb-[2px]'

const title = computed(() =>
  step.value === 'confirm' ? 'Verify your email' : activeTab.value === 'signUp' ? 'Create Account' : 'Sign In')
const subtitle = computed(() =>
  step.value === 'confirm' ? 'Check your inbox' : activeTab.value === 'signUp' ? 'Join NODA' : 'Your account, your assets.')
</script>

<template>
  <AuthFrame :title="title" :subtitle="subtitle">
    <!-- ── Confirm step (email verification code) ── -->
    <form v-if="step === 'confirm'" :class="stack" @submit.prevent="handleConfirm">
      <p class="text-muted" :class="message">
        Enter the 6-digit code sent to
        <span class="font-semibold text-ink">{{ pendingEmail }}</span>
      </p>
      <p v-if="error" role="alert" class="text-red" :class="message">{{ error }}</p>

      <div>
        <label for="confirm-code" :class="label">Verification code</label>
        <div :class="input">
          <input
            id="confirm-code"
            v-model="confirmCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="000000"
            maxlength="6"
            required
            class="tracking-[0.3em]"
            :class="field"
          />
        </div>
      </div>

      <button type="submit" :disabled="loading" :class="mainButton">
        {{ loading ? 'Verifying…' : 'Verify email' }}
      </button>

      <p class="text-center text-muted" :class="message">
        Didn't receive it?
        <button type="button" :class="link" @click="handleResend">Resend code</button>
      </p>
    </form>

    <!-- ── Sign in / Create account ── -->
    <template v-else>
      <!-- The Withdraw / History switch. -->
      <nav
        role="tablist"
        aria-label="Authentication options"
        class="bg-toggle grid h-[40px] grid-cols-2 rounded-[10px] text-[12px] font-semibold text-faint lg:h-[45px] lg:text-[14px]"
      >
        <button
          id="tab-signin"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'signIn'"
          aria-controls="panel-signin"
          :class="[tab, { 'bg-toggle-active text-accent light:text-white': activeTab === 'signIn' }]"
          @click="switchTab('signIn')"
        >Sign In</button>
        <button
          id="tab-signup"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'signUp'"
          aria-controls="panel-signup"
          :class="[tab, { 'bg-toggle-active text-accent light:text-white': activeTab === 'signUp' }]"
          @click="switchTab('signUp')"
        >Create Account</button>
      </nav>

      <!-- ── Sign In panel ── -->
      <div
        v-show="activeTab === 'signIn'"
        id="panel-signin"
        role="tabpanel"
        aria-labelledby="tab-signin"
        class="mt-[25px] lg:mt-[30px]"
      >
        <form :class="stack" @submit.prevent="handleSignIn">
          <p v-if="verifiedBanner" role="status" class="text-accent" :class="message">
            Your email has been verified — sign in to continue.
          </p>
          <p v-if="error && activeTab === 'signIn'" role="alert" class="text-red" :class="message">{{ error }}</p>

          <div>
            <label for="si-email" :class="label">Email Address</label>
            <div :class="input">
              <input id="si-email" v-model="siEmail" type="email" autocomplete="email" placeholder="operator@domain.com" required :class="field" />
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between">
              <label for="si-password" :class="label">Password</label>
              <a href="#" class="text-[12px] leading-none lg:text-[14px]" :class="link">Forgot password?</a>
            </div>
            <div :class="input">
              <input id="si-password" v-model="siPassword" type="password" autocomplete="current-password" placeholder="••••••••" required :class="field" />
            </div>
          </div>

          <button type="submit" :disabled="loading" class="mt-[5px]" :class="mainButton">
            {{ loading ? 'Signing in…' : 'Sign In' }}
          </button>
        </form>
      </div>

      <!-- ── Create Account panel ── -->
      <div
        v-show="activeTab === 'signUp'"
        id="panel-signup"
        role="tabpanel"
        aria-labelledby="tab-signup"
        class="mt-[25px] lg:mt-[30px]"
      >
        <form :class="stack" @submit.prevent="handleSignUp">
          <p v-if="error && activeTab === 'signUp'" role="alert" class="text-red" :class="message">{{ error }}</p>

          <div class="grid grid-cols-2 gap-[10px] lg:gap-[15px]">
            <div>
              <label for="su-first-name" :class="label">First name</label>
              <div :class="input">
                <input id="su-first-name" v-model="suFirstName" type="text" autocomplete="given-name" placeholder="Jane" required :class="field" />
              </div>
            </div>
            <div>
              <label for="su-last-name" :class="label">Last name</label>
              <div :class="input">
                <input id="su-last-name" v-model="suLastName" type="text" autocomplete="family-name" placeholder="Doe" required :class="field" />
              </div>
            </div>
          </div>

          <div>
            <label for="su-email" :class="label">Email address</label>
            <div :class="input">
              <input id="su-email" v-model="suEmail" type="email" autocomplete="email" placeholder="jane.doe@company.com" required :class="field" />
            </div>
          </div>

          <PasswordField id="su-password" v-model="suPassword" text="Password" strength />
          <PasswordField id="su-confirm" v-model="suConfirmPass" text="Confirm password" />

          <button type="submit" :disabled="loading" class="mt-[5px]" :class="mainButton">
            <template v-if="loading">Creating account…</template>
            <template v-else>
              Create Account
              <AppIcon name="arrow-right" />
            </template>
          </button>
        </form>
      </div>
    </template>

    <template #after>
      <p class="mt-[20px] text-center text-muted lg:mt-[25px]" :class="message">
        <template v-if="activeTab === 'signIn'">
          Don't have an account?
          <button type="button" :class="link" @click="switchTab('signUp')">Sign up</button>
        </template>
        <template v-else>
          Already have an account?
          <button type="button" :class="link" @click="switchTab('signIn')">Sign in</button>
        </template>
      </p>
    </template>
  </AuthFrame>
</template>
