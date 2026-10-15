import { computed, onMounted, onUnmounted } from 'vue'
import { useKyc } from '@loudibly/core/composables/useKyc'

// The user's KYC status for the forms an account's KYC policy may gate (Withdraw, Transfer, Deposit).
// null while unread or when the read failed: the form then sends as usual and the API decides.
// Read again when the page comes back from Didit through the browser's back button.
export function useKycGate() {
  const { status, failed, load } = useKyc()
  const kyc = computed(() => failed.value ? null : status.value)

  async function readKyc() {
    await load().catch(() => { status.value = null })
  }

  function onPageShow(event: PageTransitionEvent) {
    if (event.persisted) readKyc()
  }

  onMounted(() => {
    readKyc()
    window.addEventListener('pageshow', onPageShow)
  })
  onUnmounted(() => window.removeEventListener('pageshow', onPageShow))

  return { kyc, readKyc }
}
