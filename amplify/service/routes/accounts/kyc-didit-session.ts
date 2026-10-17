import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { updateItem } from '../../../utils/db'
import { DiditKycProvider } from '../../../providers/kyc/DiditKycProvider'
import { callerUser } from '../../../utils/caller'

export default class KycDiditSessionHandler {
  async execute(event: any, context: Context) {
    const caller = callerUser(event)
    if (caller.error) return caller.error
    const { userId } = caller

    let provider: DiditKycProvider
    try {
      provider = DiditKycProvider.create()
    } catch (e: any) {
      console.error(e.message)
      return response({ statusCode: 500, headers: null, bodyObject: { message: 'KYC service not configured' } })
    }

    try {
      const { sessionId, verificationUrl } = await provider.createSession(userId)

      await updateItem({
        tableName: 'v2CustomerTable',
        key: { id: userId, sk: 'USERPROFILE' },
        updateExpression: 'SET kyc = :kycData',
        attributeNames: undefined,
        attributeValues: {
          ':kycData': { status: 'Not Started', sessionId, provider: 'didit', updatedAt: Date.now() }
        }
      })

      return response({ statusCode: 200, headers: null, bodyObject: { verification_url: verificationUrl } })
    } catch (e: any) {
      console.error('Didit session creation failed:', e.response?.data ?? e.message)
      return response({ statusCode: 500, headers: null, bodyObject: { message: 'Failed to create KYC session' } })
    }
  }
}
