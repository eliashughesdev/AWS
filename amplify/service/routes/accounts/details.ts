import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { getRecord } from '../../../utils/db'
import { processError } from '../../../errors/http'

export default class DetailsHandler {
	async execute(event: any, context: Context) {
		// todo ensure that customer have enough right to get this account
		const customer = await getRecord('v2CustomerTable', event.body.account_id)
		if (!customer.success || !customer.res) return processError(100001)

		const fees = await getRecord('v1FeesTable', customer.res?.fees)
		if (!fees.success || !fees.res) return processError(100007)

		const balance = await getRecord('v1AccountBalanceTable', event.body.account_id)
		if (!balance.success || !balance.res) return processError(100008)

		const res = { ...customer.res, ...balance.res }
		res.fees = { ...fees.res }

		delete res.providerId

		return response({
			statusCode: 200,
			headers: null,
			bodyObject: {
				success: true,
				res: {
					data: { ...res }
				}
			}
		})
	}
}