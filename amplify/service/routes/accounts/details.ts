import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { getRecord, queryItemFromIndex } from '../../../utils/db'
import { processError } from '../../../errors/http'

export default class DetailsHandler {
	async execute(event: any, context: Context) {
		// todo ensure that customer have enough right to get this account
		// const cstomer = await getRecord('v2CustomerTable', event.body.account_id)
		// const account = await byindes('v2CustomerTable', event.body.account_id)
		const account = await queryItemFromIndex({
			tableName: 'v2CustomerTable',
			indexName: 'v1v2CustomerTableToAccountId',
			keyConditionExpression: '#sk = :accountNumber',
			attributeNames: {
				'#sk': 'sk',
			},
			attributeValues: {
				':accountNumber': event.body.account_id,
			}
		});
		if (!account.success || !account.res) return processError(100001)

		console.log('DEBUG: Retrieved Account Record:', JSON.stringify(account.res));

		// const fees = await getRecord('v1FeesTable', account.res?.fees)
		// if (!fees.success || !fees.res) return processError(100007)

		// const balance = await getRecord('v1AccountBalanceTable', event.body.account_id)
		// if (!balance.success || !balance.res) return processError(100008)

		// const res = { ...account.res, ...balance.res }
		// const res = { ...account.res, ...balance.res }
		// res.fees = { ...fees.res }

		// delete res.providerId

		return response({
			statusCode: 200,
			headers: null,
			bodyObject: {
				success: true,
				res: {
					// data: { ...res }
					data: { "OK": "OK" }
				}
			}
		})
	}
}