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
    // All four present and shaped, the amount a decimal above zero (schemas/accounts/transfer.json)
    const { provider, senderAccountNumber, recipientAccountNumber, amount } = event.body

    if (senderAccountNumber === recipientAccountNumber) return processError(100051)

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

    // The ledger currency each account holds (USDT_TRON, SOL…); a transfer stays within one. Only
    // chain names it: an account's currency field is its accounting currency (USD)
    const currencyOf = (account: Record<string, any>) => String(account.chain ?? '').toUpperCase()
    const currency = currencyOf(senderResult.res[0])
    if (!currency || currencyOf(recipientResult.res[0]) !== currency) {
      console.error(`ERROR: Transfer from a ${currency} account to a ${currencyOf(recipientResult.res[0])} account refused`)
      return processError(100052, currency || 'this currency')
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
