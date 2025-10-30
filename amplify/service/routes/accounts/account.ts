import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { putItem } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ProviderName'

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

		// After user is created in the database one should
		// 1- generate a Virtual account
		// 2- generate a deposit address so that the user can send moneny to the VA
		try {
			const vaProvider = ProviderRegistry.getProvider(event.provider as ProviderName)
			const userId = data.id;
			const currency = data.currency
			// xpub here is a dummy one because i don't know where the real one is
			// i assume you have created some because i saw afew transactions on the
			// team dashboard.
			const { xpub } = await vaProvider.getXpub(data.currency)

			// create VA
			const { accountId } = await vaProvider.createVaAccount({ userId, currency, xpub })
			// assign a deposit address to the VA
			const { address } = await vaProvider.generateDepositAddress(accountId)

			return response({
				statusCode: 200,
				headers: null,
				bodyObject: {
					success: true,
					res: {
						data: {
							id: data.id,
							vAccountId: accountId,
							depositAddress: address
						}
					}
				}
			});

		} catch (err) {
			console.error('VA creation error:', err)
			return processError(100002, 'Failed to create virtual account')
			// at this point maybe we want to delete the created user from the database
		}
	}
}