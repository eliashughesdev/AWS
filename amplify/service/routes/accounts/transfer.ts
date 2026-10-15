import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { queryItemFromIndex, putItem, updateItem } from '../../../utils/db'
import { ProviderRegistry } from '../../../utils/AccountProvider'
import { ProviderName } from '../../../providers/ledger/ProviderName'
import { SYSTEM_MERCHANT_ID } from '../../../utils/systemMerchant'
import { callerUser } from '../../../utils/caller'
import { checkKyc } from '../../../utils/kycPolicy'

type Event = {
  requestContext?: { authorizer?: { userId?: string, role?: string, authType?: string, merchantId?: string } }
  body: {
    provider: string
    senderAccountNumber: string
    recipientAccountNumber: string
    amount: string
  }
}

export default class TransferFundsHandler {
  async execute(event: Event, context: Context) {
    const caller = callerUser(event)
    if (caller.error) return caller.error
    const { userId } = caller

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

    // A transfer moves only the ledger, so both accounts must share the merchant whose master
    // holds the coins and signs their withdrawals. The id is compared as stored, like
    // getMasterAccount does: `loudibly` (pre-rename) has its own master, apart from `internal-001`.
    // Answered as not found, before any other check, so the caller cannot tell that the account
    // exists under another merchant (D11)
    const merchantOf = (account: Record<string, any>) => account.merchantId ?? SYSTEM_MERCHANT_ID
    if (merchantOf(senderResult.res[0]) !== merchantOf(recipientResult.res[0])) {
      console.error(`ERROR: Transfer from merchant ${merchantOf(senderResult.res[0])} to merchant ${merchantOf(recipientResult.res[0])} refused`)
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

    // The sender's merchant's KYC policy for this currency (docs/public-api-plan.md D11)
    const kycRefusal = await checkKyc({ userId, merchantId: senderResult.res[0].merchantId, currency, operation: 'transfer' })
    if (kycRefusal) return kycRefusal

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
      // The ledger refused (Tatum answers 403 to a sender whose balance is short): nothing moved
      // and nothing was written. 100004 was answered here, which is no code: processError threw
      // and the caller got a bare 500
      return processError(100002, 'Failed to transfer funds')
    }
  }
}
