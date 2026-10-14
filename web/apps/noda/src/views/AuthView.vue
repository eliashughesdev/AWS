<script setup lang="ts">
// Not in Figma: Loudibly's sign-in screen (apps/loudibly/src/views/AuthView.vue) without its
// non-custodial mode, drawn with the app's own panel, switch, fields and buttons until the client
// supplies a design. It follows the theme like every other view.
import { ref, computed, onMounted } from 'vue'
import { signInWithPassword, isSignedIn } from '@loudibly/core/auth/signIn'
import { useSignUp, passwordStrength } from '@loudibly/core/composables/useSignUp'
import { useRoute, useRouter } from 'vue-router'
import logoMark from '../assets/logo-mark.png'
import logoWordmark from '../assets/logo-wordmark.png'
import AppIcon from '../components/AppIcon.vue'

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

const tab = 'grid h-full place-items-center rounded-[10px] pb-[3px] lg:pb-[2px]'
const label = 'text-[12px] leading-none font-semibold text-muted lg:text-[14px]'
// The box shows the focus. The browser's ring around the bare <input> covers the caret.
const input = 'mt-[11.5px] flex h-[35px] items-center rounded-[5px] border-[0.5px] border-card-line bg-field px-[9px] text-[12px] font-medium focus-within:border-accent light:shadow-(--shadow-card) lg:mt-[14px] lg:h-[50px] lg:px-[17px] lg:text-[14px]'
const field = 'min-w-0 flex-1 bg-transparent text-ink text-ellipsis outline-none placeholder:text-muted'
const reveal = '-mr-[4px] -my-[8px] flex p-[8px] text-muted lg:-mr-[6px]'
const message = 'text-[12px] leading-[16px] font-medium lg:text-[14px] lg:leading-[18px]'
const link = 'font-semibold text-accent underline underline-offset-[2.5px] lg:underline-offset-[3px]'
const mainButton = 'bg-cta flex h-[45px] w-full items-center justify-center gap-[8px] rounded-[5px] border-[0.5px] border-card-line text-[12px] font-semibold text-white light:border-0 disabled:opacity-60 lg:h-[50px] lg:text-[16px] lg:font-medium'
const stack = 'flex flex-col gap-[20px] lg:gap-[25px]'

</script>

<template>
  <div class="flex flex-1 flex-col">
    <main class="mx-auto flex w-full max-w-[470px] flex-1 flex-col justify-center px-[10px] py-[40px] lg:py-[60px]">
      <!-- The header's logo, at its desktop size. -->
      <div class="flex items-center justify-center gap-[7.5px]">
        <img :src="logoMark" alt="" class="h-[25px]" />
        <img :src="logoWordmark" alt="NODA" class="h-[21px] w-[90px] light:invert" />
      </div>

      <!-- The layout's page heading and subtitle. -->
      <header class="mt-[30px] text-center lg:mt-[40px]">
        <h1 class="text-[20px] leading-[30px] font-semibold lg:text-[30px] lg:leading-[36px]">
          <template v-if="step === 'confirm'">Verify your email</template>
          <template v-else-if="activeTab === 'signUp'">Create Account</template>
          <template v-else>Sign In</template>
        </h1>
        <p class="mt-[3px] text-[12px] leading-[14px] font-semibold text-muted lg:mt-[7.5px] lg:leading-none">
          <template v-if="step === 'confirm'">Check your inbox</template>
          <template v-else-if="activeTab === 'signUp'">Join NODA</template>
          <template v-else>Your account, your assets.</template>
        </p>
      </header>

      <section class="panel mt-[20px] rounded-[10px] px-[14px] pb-[29px] pt-[20px] lg:mt-[30px] lg:px-[29px] lg:pb-[29px] lg:pt-[29px]">

        <!-- ── Confirm step (email verification code) ── -->
        <form v-if="step === 'confirm'" :class="stack" @submit.prevent="handleConfirm">
          <p class="text-[12px] leading-[18px] font-medium text-muted lg:text-[14px] lg:leading-[22px]">
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
                  <input
                    id="si-email"
                    v-model="siEmail"
                    type="email"
                    autocomplete="email"
                    placeholder="operator@domain.com"
                    required
                    :class="field"
                  />
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between">
                  <label for="si-password" :class="label">Password</label>
                  <a href="#" class="text-[12px] leading-none lg:text-[14px]" :class="link">Forgot password?</a>
                </div>
                <div :class="input">
                  <input
                    id="si-password"
                    v-model="siPassword"
                    type="password"
                    autocomplete="current-password"
                    placeholder="••••••••"
                    required
                    :class="field"
                  />
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

              <div>
                <label for="su-password" :class="label">Password</label>
                <div :class="input">
                  <input
                    id="su-password"
                    v-model="suPassword"
                    :type="showSuPass ? 'text' : 'password'"
                    autocomplete="new-password"
                    placeholder="••••••••"
                    required
                    :class="field"
                  />
                  <button
                    type="button"
                    :aria-label="showSuPass ? 'Hide password' : 'Show password'"
                    :aria-pressed="showSuPass"
                    :class="[reveal, { 'text-accent!': showSuPass }]"
                    @click="showSuPass = !showSuPass"
                  >
                    <AppIcon name="eye-sm" />
                  </button>
                </div>
                <!-- The Withdraw Limits bar, in four steps. -->
                <template v-if="suPassword">
                  <div class="mt-[10px] flex h-[6px] gap-[4px] lg:mt-[12px]">
                    <div
                      v-for="i in 4"
                      :key="i"
                      class="flex-1 rounded-full"
                      :class="i <= passwordBars ? 'bg-teal-rise' : 'bg-card light:bg-track'"
                    />
                  </div>
                  <p class="mt-[8px] text-right text-[10px] leading-none font-semibold text-muted lg:text-[12px]">{{ passwordStrengthLabel }}</p>
                </template>
              </div>

              <div>
                <label for="su-confirm" :class="label">Confirm password</label>
                <div :class="input">
                  <input
                    id="su-confirm"
                    v-model="suConfirmPass"
                    :type="showSuConfirm ? 'text' : 'password'"
                    autocomplete="new-password"
                    placeholder="••••••••"
                    required
                    :class="field"
                  />
                  <button
                    type="button"
                    :aria-label="showSuConfirm ? 'Hide password' : 'Show password'"
                    :aria-pressed="showSuConfirm"
                    :class="[reveal, { 'text-accent!': showSuConfirm }]"
                    @click="showSuConfirm = !showSuConfirm"
                  >
                    <AppIcon name="eye-sm" />
                  </button>
                </div>
              </div>

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
      </section>

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
    </main>

    <!-- The layout's footer. -->
    <footer class="px-[10px] py-[21px] text-[10px] leading-none font-semibold text-faint lg:px-[30px] lg:pb-[23px] lg:pt-[31px]">
      NodabaseStaging©2025
    </footer>
  </div>
</template>
