import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { queryItemFromIndex } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'

type Event = {
  body: {
    provider: string
    senderAccountNumber: string
    recipientAccountNumber: string
    amount: string
  }
}

export default class TransferFundsHandler {
  async execute(event: Event, context: Context) {
    const { provider, senderAccountNumber, recipientAccountNumber, amount } = event.body

    if (!provider || !senderAccountNumber || !recipientAccountNumber || !amount) {
      return processError(100029, 'Missing required parameters')
    }

    // Look up sender account to get its Tatum vAccountId
    const senderResult = await queryItemFromIndex({
      tableName: 'v2CustomerTable',
      indexName: 'v1v2CustomerTableToAccountId',
      keyConditionExpression: '#sk = :accountNumber',
      attributeNames: { '#sk': 'sk' },
      attributeValues: { ':accountNumber': `ACCOUNT#${senderAccountNumber}` },
    })

    if (!senderResult.success || !senderResult.res || senderResult.res.length === 0) {
      console.error(`ERROR: Sender account not found: ${senderAccountNumber}`)
      return processError(100001)
    }

    // Look up recipient account to get its Tatum vAccountId
    const recipientResult = await queryItemFromIndex({
      tableName: 'v2CustomerTable',
      indexName: 'v1v2CustomerTableToAccountId',
      keyConditionExpression: '#sk = :accountNumber',
      attributeNames: { '#sk': 'sk' },
      attributeValues: { ':accountNumber': `ACCOUNT#${recipientAccountNumber}` },
    })

    if (!recipientResult.success || !recipientResult.res || recipientResult.res.length === 0) {
      console.error(`ERROR: Recipient account not found: ${recipientAccountNumber}`)
      return processError(100001)
    }

    const senderVAccountId = senderResult.res[0].vAccountId
    const recipientVAccountId = recipientResult.res[0].vAccountId

    try {
      const vaProvider = ProviderRegistry.getProvider(provider as ProviderName)
      const result = await vaProvider.transferFunds({
        senderAccountId: senderVAccountId,
        recipientAccountId: recipientVAccountId,
        amount,
      })

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
