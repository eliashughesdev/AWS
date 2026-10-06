<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import QRCode from 'qrcode'
import MainLayout from '../layouts/MainLayout.vue'
import { useWalletSession } from '@loudibly/core/wallet/session'
import { chainLabels } from '@loudibly/core/wallet/types'

const router  = useRouter()
const session = useWalletSession()

const selected  = ref('')
const qrDataUrl = ref('')
const copied    = ref(false)

const wallet = computed(() => session.wallets.value.find(w => w.address === selected.value) ?? null)

const displayName = computed(() => session.shortAddress.value || 'Wallet')

async function generateQr(address: string) {
  try {
    const brand = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim()
    qrDataUrl.value = await QRCode.toDataURL(address, {
      width: 220,
      margin: 2,
      color: { dark: '#000000', light: brand },
    })
  } catch {
    qrDataUrl.value = ''
  }
}

onMounted(() => {
  if (session.wallets.value.length === 0) {
    router.push({ name: 'auth' })
    return
  }
  selected.value = session.active.value?.address ?? session.wallets.value[0].address
})

watch(selected, address => { if (address) generateQr(address) }, { immediate: true })

async function copyAddress() {
  if (!wallet.value) return
  await navigator.clipboard.writeText(wallet.value.address)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function handleSignOut() {
  session.clear()
  router.push({ name: 'auth' })
}
</script>

<template>
  <MainLayout :displayName="displayName" userEmail="" :nonCustodial="true" @signOut="handleSignOut">
    <section class="p-8 max-w-xl mx-auto w-full">
      <h1 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.2em] text-text-muted mb-8">Receive</h1>

      <div class="bg-surface-1 border border-border-subtle rounded-xl p-8 flex flex-col items-center gap-6">

        <div class="w-full">
          <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Wallet
          </label>
          <select
            v-model="selected"
            class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 text-sm text-white font-['JetBrains_Mono'] focus:outline-none focus:border-brand/50 transition-colors">
            <option v-for="w in session.wallets.value" :key="w.address" :value="w.address">
              {{ chainLabels[w.chain] }} — {{ w.address }}
            </option>
          </select>
        </div>

        <img v-if="qrDataUrl" :src="qrDataUrl" alt="Wallet address QR code" class="rounded-lg" />

        <div class="w-full">
          <label class="block font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-text-muted mb-2">
            Your {{ wallet ? chainLabels[wallet.chain] : '' }} address
          </label>
          <div class="relative">
            <div class="w-full bg-page border border-border-subtle rounded-lg px-4 py-3 pr-20 font-['JetBrains_Mono'] text-xs text-white break-all">
              {{ wallet?.address }}
            </div>
            <button
              @click="copyAddress"
              class="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-brand text-on-brand font-['JetBrains_Mono'] text-[10px] font-bold rounded hover:bg-brand-hover transition-colors">
              {{ copied ? 'Copied!' : 'Copy' }}
            </button>
          </div>
        </div>

        <p class="font-['JetBrains_Mono'] text-[11px] text-text-muted text-center">
          Send only {{ wallet ? chainLabels[wallet.chain] : '' }} assets to this address.
          Incoming funds appear on your wallet within about 30 seconds.
        </p>

      </div>
    </section>
  </MainLayout>
</template>
