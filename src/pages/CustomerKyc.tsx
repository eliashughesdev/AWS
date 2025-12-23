import { useEffect, useRef } from 'react'
import Persona from 'persona'
import axios from 'axios'
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

export default function CustomerKyc() {
  const clientRef = useRef<any>(null)

  useEffect(() => {
    if (clientRef.current) return
    const init = async () => {
      const user = await getCurrentUser();
      const session = await fetchAuthSession();
      console.log(user);
      console.log(user.userId);
      console.log(session)
      console.log(session.tokens?.idToken?.toString());
      const token = session.tokens?.accessToken?.toString();

      const client = new Persona.Client({
        templateId: 'itmpl_1sUZyGnyr37FxJVbcJioqM6x',
        referenceId: user.userId,
        environmentId: 'env_p6vqJA4rT688ztP3c6AHojQo',
        onReady: () => client.open(),
        onComplete: async ({ inquiryId, status, fields }: any) => {
          try {
            // const API_URL = process.env.API_URL
            await axios.post(`https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/kyc`,
              { inquiryId, status, fields },
              {
                headers: {
                  'X-Project': 'e2e-hmac',
                  Authorization: `Bearer ${token}`
                }
              })
            console.log('KYC result posted')
          } catch (e) {
            console.error('Failed posting KYC result', e)
          }
        },
        onCancel: () => console.log('Persona cancelled'),
        onError: (err: any) => console.error('Persona error', err),
      })

      clientRef.current = client
    }

    init().catch(err => console.error('Failed initializing KYC client', err))

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
