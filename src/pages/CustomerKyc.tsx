import { useEffect } from 'react'
import axios from 'axios'
import { fetchAuthSession } from 'aws-amplify/auth'
import { API_BASE } from '../config'

export default function CustomerKyc() {
  useEffect(() => {
    const init = async () => {
      const session = await fetchAuthSession()
      const token = session.tokens?.accessToken?.toString()

      const { data } = await axios.post(
        `${API_BASE}/accounts/kyc/didit/session`,
        {},
        {
          headers: {
            'X-Project': 'e2e-hmac',
            Authorization: `Bearer ${token}`
          }
        }
      )

      if (data.verification_url) {
        window.location.href = data.verification_url
      }
    }

    init().catch(err => console.error('Failed starting KYC session', err))
  }, [])

  return (
    <main>
      <h1>Customer KYC</h1>
      <p>Redirecting to identity verification...</p>
    </main>
  )
}
