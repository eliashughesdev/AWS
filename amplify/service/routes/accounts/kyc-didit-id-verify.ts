import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { DiditKycProvider } from '../../../providers/kyc/DiditKycProvider'

export default class KycDiditIdVerifyHandler {
  async execute(event: any, context: Context) {
    let provider: DiditKycProvider
    try {
      provider = DiditKycProvider.create()
    } catch (e: any) {
      console.error(e.message)
      return response({ statusCode: 500, headers: null, bodyObject: { message: 'KYC service not configured' } })
    }

    // The body was checked against schemas/accounts/kyc/didit/id-verify.json
    const { front_image: frontImage, back_image: backImage } = event.body

    try {
      const result = await provider.verifyIdDocument(frontImage, backImage)
      return response({ statusCode: 200, headers: null, bodyObject: result })
    } catch (e: any) {
      console.error('Didit id-verification failed:', e.response?.data ?? e.message)
      return response({
        statusCode: e.response?.status ?? 500,
        headers: null,
        bodyObject: { message: e.response?.data?.detail ?? 'ID verification failed' }
      })
    }
  }
}
