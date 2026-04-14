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

    const { front_image, back_image } = event.body

    if (!front_image) {
      return response({ statusCode: 400, headers: null, bodyObject: { message: 'front_image is required' } })
    }

    try {
      const result = await provider.verifyIdDocument(front_image, back_image)
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
