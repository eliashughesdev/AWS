import { useEffect, useRef } from 'react'
import Persona from 'persona'
import axios from 'axios'

export default function CustomerKyc() {
  const clientRef = useRef<any>(null)

  useEffect(() => {
    if (clientRef.current) return

    const client = new Persona.Client({
      templateId: 'itmpl_1sUZyGnyr37FxJVbcJioqM6x',
      environmentId: 'env_p6vqJA4rT688ztP3c6AHojQo',
      onReady: () => client.open(),
      onComplete: async ({ inquiryId, status, fields }: any) => {
        try {
          await axios.post('/v1/accounts/kyc', { inquiryId, status, fields })
          console.log('KYC result posted')
        } catch (e) {
          console.error('Failed posting KYC result', e)
        }
      },
      onCancel: () => console.log('Persona cancelled'),
      onError: (err: any) => console.error('Persona error', err),
    })

    clientRef.current = client

    return () => {
      if (clientRef.current) {
        clientRef.current.cancel(false)
        clientRef.current = null
      }
    }
  }, [])

  return (
    <main>
      <h1>Customer KYC</h1>
      <p>Verifcation will load automatically.</p>
    </main>
  )
}
