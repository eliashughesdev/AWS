import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'

export default class KycHandler {
	async execute(event: any, context: Context) {
		return response({
			statusCode: 200,
			headers: null,
			bodyObject: { message: 'accounts/kyc', status: 'not implemented' },
		})
	}
}