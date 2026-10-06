import { ref } from 'vue'
import { getKycStatus, startDiditSession } from '../api/kyc'

export type KycStatus = 'approved' | 'pending' | 'not-started' | 'failed'

// Identity verification (Didit) for the signed-in user.
export function useKyc() {
  const status   = ref<KycStatus | null>(null)
  const starting = ref(false)

  // Throws when the request itself fails. No profile or no KYC record counts as not started.
  async function load() {
    const { data } = await getKycStatus()
    const didit = data.kyc?.status
    if (didit === 'Approved') status.value = 'approved'
    else if (didit === 'In Progress') status.value = 'pending'
    else if (!didit || didit === 'Not Started') status.value = 'not-started'
    // Any other Didit status (Declined, In Review, Expired…).
    else status.value = 'failed'
  }

  // Opens a Didit session and sends the browser to its hosted verification page.
  async function start() {
    starting.value = true
    try {
      const { data } = await startDiditSession()
      if (data.verification_url) {
        window.location.href = data.verification_url
      }
    } catch (e) {
      console.error('Failed to start KYC session', e)
    } finally {
      starting.value = false
    }
  }

  return { status, starting, load, start }
}
