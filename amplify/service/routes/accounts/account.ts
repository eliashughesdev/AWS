import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { putItem } from '../../../utils/db'
import { processError } from '../../../errors/http'

/**
 * Creates new account (internal)
 */
export default class AccountHandler {
	async execute(event: any, context: Context) {
		// todo check if enough rights
		const data: any = {
			id: crypto.randomUUID(),
			created_at: Date.now(),
			currency: 'USD',
			deleted_at: null,
			fees: 'default',
			name: event.body.account_name,
			providerId: 'default',
			status: 'active',
			updated_at: Date.now(),
		}
		const result = await putItem('v1CustomerTable', data)
		if (!result.success || !result.res) return processError(100003)

		return response({
			statusCode: 200,
			headers: null,
			bodyObject: {
				success: true,
				res: {
					data: {
						id: data.id,
					}
				}
			}
		})
	}
}