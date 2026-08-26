import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { queryItemFromIndex, putItem, updateItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
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

    const userId = event.requestContext?.authorizer?.userId
    if (senderResult.res[0].id !== userId) {
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

      const createdAt = new Date().toISOString()
      const txId = result.reference
      const currency = senderResult.res[0].chain ?? senderResult.res[0].currency ?? ''

      const parsedAmount = parseFloat(amount)

      await Promise.all([
        putItem('v1TransactionLogsTable', {
          id: senderVAccountId,
          sk: `TX#${createdAt}#${txId}`,
          txId,
          type: 'TRANSFER_SENT',
          amount: parsedAmount,
          currency,
          to: recipientAccountNumber,
          createdAt,
        }),
        putItem('v1TransactionLogsTable', {
          id: recipientVAccountId,
          sk: `TX#${createdAt}#${txId}`,
          txId,
          type: 'TRANSFER_RECEIVED',
          amount: parsedAmount,
          currency,
          from: senderAccountNumber,
          createdAt,
        }),
        updateItem({
          tableName: 'v1AccountBalanceTable',
          key: { id: senderVAccountId },
          updateExpression: 'SET #balance = #balance - :amount, #availableBalance = #availableBalance - :amount, #lastUpdated = :now',
          attributeNames: { '#balance': 'balance', '#availableBalance': 'availableBalance', '#lastUpdated': 'lastUpdated' },
          attributeValues: { ':amount': parsedAmount, ':now': createdAt },
        }),
        updateItem({
          tableName: 'v1AccountBalanceTable',
          key: { id: recipientVAccountId },
          updateExpression: 'SET #balance = #balance + :amount, #availableBalance = #availableBalance + :amount, #lastUpdated = :now',
          attributeNames: { '#balance': 'balance', '#availableBalance': 'availableBalance', '#lastUpdated': 'lastUpdated' },
          attributeValues: { ':amount': parsedAmount, ':now': createdAt },
        }),
      ])

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
