import { useEffect, useState } from 'react'
import axios from 'axios'
import { fetchAuthSession } from 'aws-amplify/auth'
import { API_BASE } from '../config'

type KycStatus = 'Not Started' | 'In Progress' | 'In Review' | 'Approved' | 'Declined' | 'Abandoned' | 'Expired'

const STATUS_MESSAGES: Record<KycStatus, { heading: string; body: string }> = {
  'Approved':    { heading: 'Verification Approved', body: 'Your identity has been successfully verified.' },
  'Declined':    { heading: 'Verification Declined', body: 'We were unable to verify your identity. Please contact support if you have questions.' },
  'In Review':   { heading: 'Under Review', body: 'Your verification is being reviewed by our team. We will notify you once it\'s complete.' },
  'In Progress': { heading: 'Verification In Progress', body: 'Your verification is still being processed. Please check back shortly.' },
  'Abandoned':   { heading: 'Verification Incomplete', body: 'It looks like you didn\'t finish the verification. You can start again from your account.' },
  'Expired':     { heading: 'Verification Expired', body: 'Your verification session has expired. Please start a new one.' },
  'Not Started': { heading: 'Not Started', body: 'Your verification hasn\'t started yet.' },
}

export default function KycComplete() {
  const [kyc, setKyc] = useState<{ status: KycStatus } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStatus = async () => {
      const session = await fetchAuthSession()
      const token = session.tokens?.accessToken?.toString()

      const { data } = await axios.get(
        `${API_BASE}/accounts/kyc/status`,
        {
          headers: {
            'X-Project': 'e2e-hmac',
            Authorization: `Bearer ${token}`
          }
        }
      )

      setKyc(data.kyc)
      setLoading(false)
    }

    // Poll briefly — webhook may arrive just after the redirect
    let attempts = 0
    const poll = async () => {
      await fetchStatus()
      attempts++
      if (attempts < 3) setTimeout(poll, 2000)
    }

    poll().catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <main>
        <h1>Checking your verification result...</h1>
      </main>
    )
  }

  if (!kyc) {
    return (
      <main>
        <h1>Verification Submitted</h1>
        <p>We received your submission. You will be notified once verification is complete.</p>
      </main>
    )
  }

  const msg = STATUS_MESSAGES[kyc.status] ?? { heading: kyc.status, body: 'Your verification status has been updated.' }

  return (
    <main>
      <h1>{msg.heading}</h1>
      <p>{msg.body}</p>
    </main>
  )
}
