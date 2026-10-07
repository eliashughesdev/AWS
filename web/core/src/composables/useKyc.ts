import { ref } from 'vue'
import { getKycStatus, startDiditSession } from '../api/kyc'

export type KycStatus = 'approved' | 'pending' | 'not-started' | 'failed'

// Identity verification (Didit) for the signed-in user.
export function useKyc() {
  const status   = ref<KycStatus | null>(null)
  const starting = ref(false)
  // The server refused the read, so `status` is not the user's.
  const failed   = ref(false)

  // Throws when the request itself fails. No profile or no KYC record counts as not started.
  async function load() {
    const { ok, status: httpStatus, data } = await getKycStatus()
    // A 404 is a user with no profile yet.
    failed.value = !ok && httpStatus !== 404
    const didit = data.kyc?.status
    if (didit === 'Approved') status.value = 'approved'
    // In Review is waiting for a person at Didit, so it is not the user's to redo.
    else if (didit === 'In Progress' || didit === 'In Review') status.value = 'pending'
    else if (!didit || didit === 'Not Started') status.value = 'not-started'
    // Any other Didit status (Declined, Expired…).
    else status.value = 'failed'
  }

  // Opens a Didit session and sends the browser to its hosted verification page.
  // Resolves false when there is no page to go to.
  async function start(): Promise<boolean> {
    starting.value = true
    try {
      const { data } = await startDiditSession()
      if (!data.verification_url) return false
      window.location.href = data.verification_url
      return true
    } catch (e) {
      console.error('Failed to start KYC session', e)
      return false
    } finally {
      starting.value = false
    }
  }

  return { status, starting, failed, load, start }
}
