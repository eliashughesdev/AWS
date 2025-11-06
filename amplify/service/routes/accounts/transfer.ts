import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ProviderName'

type Event = {
  body: {
    provider: string
    senderAccountId: string
    recipientAccountId: string
    amount: string
  }
}

export default class TransferFundsHandler {
  async execute(event: Event, context: Context) {
    const { provider, senderAccountId, recipientAccountId, amount } = event.body

    if (!provider || !senderAccountId || !recipientAccountId || !amount) {
      return processError(100029, 'Missing required parameters')
    }

    try {
      const vaProvider = ProviderRegistry.getProvider(provider as ProviderName)
      const result = await vaProvider.transferFunds({ senderAccountId, recipientAccountId, amount})

      	return response({
			statusCode: 200,
			headers: null,
			bodyObject: {
				success: true,
				res: {
					data: {
						transactionId: result.reference,
					}
				}
			}
		})
    } catch (err) {
      console.error('Funds transfer error:', err)
      return processError(100004, 'Failed to transfer funds')
    }
  }
}
