import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ProviderName'

type Event = {
  body: {
    provider: string
    userId: string
    currency: string
    xpub: string
  }
}

export default class CreateVAHandler {
  async execute(event: Event, context: Context) {
    const { provider, userId, currency, xpub } = event.body

    if (!provider || !userId || !currency) {
      return processError(100029, 'Missing required parameters')
    }

    try {
      const vaProvider = ProviderRegistry.getProvider(provider as ProviderName)
      const result = await vaProvider.createVaAccount({ userId, currency, xpub})

      	return response({
			statusCode: 200,
			headers: null,
			bodyObject: {
				success: true,
				res: {
					data: {
						id: result.accountId,
					}
				}
			}
		})
    } catch (err) {
      console.error('VA creation error:', err)
      return processError(100002, 'Failed to create virtual account')
    }
  }
}
