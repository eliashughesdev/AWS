import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'

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
			} catch (e) {
				console.log('Body is not valid JSON')
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