import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { updateItem } from '../../../utils/db'
import axios from 'axios'

export default class KycSessionHandler {
  async execute(event: any, context: Context) {
    const userId = event.requestContext?.authorizer?.userId

    if (!userId) {
      return response({
        statusCode: 401,
        headers: null,
        bodyObject: { message: 'User ID not found in authorization context' }
      })
    }

    const workflowId = process.env.DIDIT_WORKFLOW_ID
    const apiKey = process.env.DIDIT_API_KEY
    const callbackUrl = process.env.DIDIT_CALLBACK_URL

    if (!workflowId || !apiKey || !callbackUrl) {
      console.error('Missing Didit environment variables')
      return response({
        statusCode: 500,
        headers: null,
        bodyObject: { message: 'KYC service not configured' }
      })
    }

    const diditResponse = await axios.post(
      'https://verification.didit.me/v3/session/',
      {
        workflow_id: workflowId,
        callback: callbackUrl,
        vendor_data: userId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        }
      }
    )

    const { session_id, verification_url } = diditResponse.data

    await updateItem({
      tableName: 'v2CustomerTable',
      key: { id: userId, sk: 'USERPROFILE' },
      updateExpression: 'SET kyc = :kycData',
      attributeNames: undefined,
      attributeValues: {
        ':kycData': {
          status: 'Not Started',
          sessionId: session_id,
          updatedAt: Date.now(),
        }
      }
    })

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { verification_url }
    })
  }
}
