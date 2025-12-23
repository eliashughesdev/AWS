import { useEffect, useRef } from 'react'
import Persona from 'persona'
import axios from 'axios'
// 1. Change the import
import CryptoJS from 'crypto-js'
import { customer } from '../../amplify/service/routes/e2e/credentials'
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

export default function CustomerKyc() {
  const clientRef = useRef<any>(null)

  useEffect(() => {
    if (clientRef.current) return
    const init = async () => {
      const user = await getCurrentUser();

      const generateHmacHeaders = (path: string, bodyObj: any) => {
        const timestamp = Date.now();
        const bodyStr = JSON.stringify(bodyObj);

        // 2. MD5 Body Hash using crypto-js
        const bodyHash = CryptoJS.MD5(bodyStr).toString();

        // 3. HMAC SHA256 using crypto-js
        const secretKey = CryptoJS.enc.Hex.parse(customer.key);
        const stringToSign = `${path}${timestamp}${bodyHash}`;

        const signature = CryptoJS.HmacSHA256(stringToSign, secretKey)
                            .toString(CryptoJS.enc.Base64);

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

            await axios.post(`https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/accounts/kyc`, body, { headers });
            console.log('KYC result posted successfully with Signature')
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
      <p>Verification will load automatically.</p>
    </main>
  )
}