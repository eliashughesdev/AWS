<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CForm, CButton } from '@coreui/vue'
import BrandLogo from '../components/BrandLogo.vue'
import { brand } from '../brands'
import { useClaim } from '@loudibly/core/composables/useClaim'
import { passwordStrength } from '@loudibly/core/composables/useSignUp'

const route  = useRoute()
const router = useRouter()

type Step = 'checking' | 'form' | 'dead'

const step  = ref<Step>('checking')
const error = ref('')

const { email, firstName, verify, setPassword } = useClaim()

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

const canSubmit = computed((): boolean =>
  !submitting.value && accepted.value && password.value.length > 0 && password.value === confirmPass.value
)

onMounted(async () => {
  const token = String(route.query.token ?? '')

  // Keep the token out of the address bar, the browser history and any Referer
  // header the page sends on.
  if (token) history.replaceState({}, '', location.pathname)

  if (!token) {
    step.value = 'dead'
    error.value = 'This link is incomplete. Open the link from your email again.'
    return
  }

  const result = await verify(token)

  if (!result.ok) {
    step.value = 'dead'
    error.value = result.message
      ? `${String(result.message).charAt(0).toUpperCase()}${String(result.message).slice(1)}.`
      : 'This link could not be checked. Open the link from your email again.'
    return
  }

  step.value = 'form'
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

    if (!result.ok) {
      error.value = result.message ? String(result.message) : 'Could not set your password.'
      // The link is spent — no point keeping the form up.
      if (result.linkSpent) step.value = 'dead'
      return
    }

    router.push({ name: 'dashboard' })
  } catch {
    // Password is set; only the automatic sign-in failed. Send them to sign in
    // with the address prefilled rather than leaving them stuck here.
    router.push({ name: 'auth', query: { email: email.value } })
  } finally {
    submitting.value = false
  }
}

const inputClass =
  'w-full bg-surface-2 border border-border-subtle rounded text-text-primary ' +
  'font-label-mono-base text-label-mono-base px-space-4 py-space-3 pr-10 ' +
  'placeholder:text-text-muted/80 focus:outline-none focus:border-brand ' +
  'focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-brand)_15%,transparent)] transition-all duration-200'
</script>

<template>
  <div class="min-h-screen bg-page-gradient flex flex-col items-center justify-center p-margin-mobile md:p-margin-desktop">
    <main class="w-full max-w-[390px] mx-auto flex flex-col gap-space-8 relative z-10">

      <!-- ── Header ─────────────────────────────────────────────────────── -->
      <header class="text-center flex flex-col items-center gap-space-4">
        <BrandLogo variant="mark" size="lg" />
        <div>
          <h1
            v-if="!brand.logoSrc"
            class="font-headline-h1-mobile text-headline-h1-mobile text-text-primary font-semibold mb-space-2"
          >
            {{ brand.name }}
          </h1>
          <p class="font-body-base text-body-base text-text-secondary">
            <template v-if="step === 'checking'">Checking your link…</template>
            <template v-else-if="step === 'dead'">This link cannot be used</template>
            <template v-else>Choose a password to finish</template>
          </p>
        </div>
      </header>

      <section
        class="bg-surface-1 border border-border-subtle rounded-lg p-space-8
               flex flex-col gap-space-6 shadow-2xl shadow-black/50"
      >

        <!-- ── Checking ──────────────────────────────────────────────────── -->
        <template v-if="step === 'checking'">
          <div class="flex flex-col items-center gap-space-4 py-space-4">
            <span class="material-symbols-outlined text-brand text-4xl animate-pulse">key</span>
            <p class="font-label-mono-base text-label-mono-base text-text-secondary">One moment…</p>
          </div>
        </template>

        <!-- ── Dead link ─────────────────────────────────────────────────── -->
        <template v-else-if="step === 'dead'">
          <div class="flex flex-col items-center gap-space-4 text-center">
            <span class="material-symbols-outlined text-status-danger text-4xl">link_off</span>
            <p class="font-body-base text-body-base text-text-primary">{{ error }}</p>
            <p class="font-caption text-caption text-text-muted">
              Ask {{ brand.name }} to send you a new link, or sign in if you already set a password.
            </p>
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
              Your {{ brand.name }} account is ready. Set a password and it is yours.
            </p>
          </div>

          <CForm @submit.prevent="handleSubmit" class="flex flex-col gap-space-4">

            <p v-if="error" role="alert" class="font-body-base text-body-base text-status-danger">
              {{ error }}
            </p>

            <!-- Email, fixed: it identifies the account and the payer cannot change it -->
            <div class="flex flex-col gap-space-2">
              <label class="font-body-base text-[13px] font-medium text-text-secondary">
                Your account
              </label>
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
                I agree to the {{ brand.name }} Terms of Service and Privacy Policy.
              </span>
            </label>

            <CButton
              type="submit"
              :disabled="!canSubmit"
              class="w-full bg-brand text-on-brand font-label-mono-base text-label-mono-base
                     font-bold py-space-3 rounded-full border-0 hover:bg-brand-hover transition-colors
                     active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {{ submitting ? 'Setting password…' : 'Set password and continue' }}
            </CButton>
          </CForm>
        </template>

      </section>
    </main>
  </div>
</template>
