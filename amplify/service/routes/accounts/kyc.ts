import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { updateItem } from '../../../utils/db'

export default class KycHandler {
	async execute(event: any, context: Context) {
		// Log the incoming request
		console.log('=== KYC Handler Invoked ===')
		console.log('Function Name:', context.functionName)
		console.log('Remaining Time (ms):', context.getRemainingTimeInMillis())

		console.log('Event:', JSON.stringify(event, null, 2))

		console.log('HTTP Method:', event.httpMethod || event.requestContext?.http?.method)
		console.log('Path:', event.path || event.requestContext?.http?.path)
		console.log('Headers:', JSON.stringify(event.headers, null, 2))

		if (event.body) {
			console.log('Request Body:', event.body)
			try {
				const parsedBody = JSON.parse(event.body)
				console.log('Parsed Body:', JSON.stringify(parsedBody, null, 2))

				const { inquiryId, status, fields } = parsedBody

				// const userId = event.requestContext?.authorizer?.userId
				const userId = "b7bf9d0a-ea7d-4f36-8ebd-c4bce0706911" // hardcoded for testing pourposes

				if (!userId) {
					return response({
						statusCode: 401,
						headers: null,
						bodyObject: { message: 'User ID not found in authorization context' }
					})
				}

				console.log(`Updating KYC status for user: ${userId}`)
				console.log(`InquiryId: ${inquiryId}, Status: ${status}`)

				// Update the user profile with KYC status
				const updateResult = await updateItem({
					tableName: 'v2CustomerTable',
					key: {
						id: userId,
						sk: 'USERPROFILE'
					},
					updateExpression: 'SET kyc_status = :status, kyc_inquiry_id = :inquiryId, kyc_updated_at = :timestamp',
					attributeNames: undefined,
					attributeValues: {
						':status': status,
						':inquiryId': inquiryId,
						':timestamp': Date.now()
					}
				})

				console.log('KYC status updated successfully:', updateResult)
			} catch (e) {
				console.log('Body is not valid JSON', e)
			}
		}

		if (event.requestContext?.authorizer) {
			console.log('User Identity:', JSON.stringify(event.requestContext.authorizer, null, 2))
		}

		try {
			console.log('=== KYC Handler Completed Successfully ===')

			return response({
				statusCode: 200,
				headers: null,
				bodyObject: { message: 'accounts/kyc', status: 'not implemented' },
			})
		} catch (error) {
			// Log errors
			console.error('=== KYC Handler Error ===')
			console.error('Error:', error)
			console.error('Error Stack:', error instanceof Error ? error.stack : 'No stack trace')

			return response({
				statusCode: 500,
				headers: null,
				bodyObject: {
					message: 'Internal server error',
					error: error instanceof Error ? error.message : 'Unknown error'
				},
			})
		}
	}
}