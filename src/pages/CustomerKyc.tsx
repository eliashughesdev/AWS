import { useEffect, useRef } from 'react'
import Persona from 'persona'
import axios from 'axios'
import crypto from 'crypto'
import { customer } from '../../amplify/service/routes/e2e/credentials'
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
      // const token = session.tokens?.idToken?.toString();

      const generateHmacHeaders = (path: string, bodyObj: any) => {
        const timestamp = Date.now();
        const bodyHash = crypto.createHash('md5').update(JSON.stringify(bodyObj)).digest('hex')
        const signature = crypto
          .createHmac('sha256', Buffer.from(customer.key, 'hex'))
          .update(`${path}${timestamp}${bodyHash}`)
          .digest('base64')

        return {
          'X-Project': 'e2e-hmac',
          'Authorization': `Signature ${timestamp}:${bodyHash}:${signature}`,
          'Content-Type': 'application/json'
        };
      };

      const client = new Persona.Client({
        templateId: 'itmpl_1sUZyGnyr37FxJVbcJioqM6x',
        referenceId: user.userId,
        environmentId: 'env_p6vqJA4rT688ztP3c6AHojQo',
        onReady: () => client.open(),
        onComplete: async ({ inquiryId, status, fields }: any) => {
          try {
            const path = '/v1/accounts/kyc';
            const body = { inquiryId, status, fields };
            const headers = generateHmacHeaders(path, body);
            console.log(headers)

            await axios.post(`https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/kyc`, body, { headers });
            // const API_URL = process.env.API_URL
            // await axios.post(`https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/kyc`,
            //   { inquiryId, status, fields },
            //   {
            //     headers: {
            //       Authorization: `Bearer ${token}`
            //     }
            //   }
            // )
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
