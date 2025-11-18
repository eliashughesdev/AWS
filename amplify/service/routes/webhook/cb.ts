import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { getRecord } from '../../../utils/db'
import { accountTransactions } from './tatum/accountTransactions'

const checkIp = async (event: any) => {
	let ips = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For']
	ips = ips.split(',')
	const record = await getRecord('v1WebhookIPWhitelistTable', ips[0])
	if (!record || !record.success || !record.res) return { success: false }
	return { success: true, provider_code: record.res.provider_code }
}

const processResponse = (code: number, body: any) => response({
	statusCode: code,
	headers: null,
	bodyObject: body
})

const providerCodes: any = {
	tatum: async (event: any, context: Context) => {
		// todo check signature, keep secret in ssm
		const types: any = {
			accountTransactions: async () => await accountTransactions(event, context),
		}

		if (event.queryStringParameters && event.queryStringParameters.type) {
			const res = types[event.queryStringParameters.type]()
		} else {
			console.log('tatum. no callback type in the request params')
		}

		return processResponse(200, { message: 'received' })
	}
}

export default class WebhookHandler {
	async execute(event: any, context: Context) {
		// const checkIpResult = await checkIp(event)
		// if (!checkIpResult.success) return processResponse(403, 'you are not allowed to access this endpoint')
		// if (providerCodes.hasOwnProperty(checkIpResult.provider_code)) {
			// return providerCodes[checkIpResult.provider_code](event, context)
		return providerCodes['tatum'](event, context) // just to test the webhook works correclty when all checks pass
		// }
		// return processResponse(403, 'no cb route')
	}
}