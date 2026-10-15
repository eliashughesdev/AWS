import { response } from '../../../utils/http'
import { queryItemFromIndex, updateItem } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'
import { fetchCryptoPrice } from '../../../utils/exchangeRate'
import { isNativeCurrency } from '../../../utils/currencies'
import { getMasterAccount } from '../../../utils/masterAccount'
import { accountKeyRef } from '../../../utils/signing'
import { isValidAddressFor } from '../../../utils/addresses'
import { callerUser } from '../../../utils/caller'

/**
 * Queues a crypto withdrawal for async processing.
 * Atomically deducts the balance before queuing — rolls back on payout failure.
 */
export default class WithdrawHandler {
  async execute(event: any) {
    console.log('DEBUG: WithdrawHandler execution started.')

    const caller = callerUser(event)
    if (caller.error) return caller.error
    const { userId } = caller
    // Exactly one of amount and cryptoAmount, above zero, and a destination (schemas/accounts/withdraw.json)
    const { accountNumber, currency, amount, cryptoAmount: directCryptoAmount, destinationAddress, transactionId } = event.body

    // Look up account via GSI to verify it exists
    const account = await queryItemFromIndex({
      tableName: 'v2CustomerTable',
      indexName: 'v1v2CustomerTableToAccountId',
      keyConditionExpression: '#sk = :accountNumber',
      attributeNames: {
        '#sk': 'sk',
      },
      attributeValues: {
        ':accountNumber': `ACCOUNT#${accountNumber}`,
      }
    })

    if (!account.success || !account.res || account.res.length === 0) {
      console.error(`ERROR: Account not found for accountNumber: ${accountNumber}`)
      return processError(100001)
    }

    const accountRecord = account.res[0]

    if (accountRecord.id !== userId) {
      console.error(`ERROR: Account ${accountNumber} does not belong to user ${userId}`)
      return processError(100005)
    }

    const accountChain = accountRecord.chain  // e.g. 'BTC', 'SOL', 'ETH', 'TRON'
    const vAccountId = accountRecord.vAccountId

    if (!accountChain) {
      console.error(`ERROR: Account ${accountNumber} is not a crypto account`)
      return processError(100006)
    }

    if (!accountKeyRef(accountRecord)) {
      console.error(`ERROR: Account ${accountNumber} has no signing key — cannot withdraw`)
      return processError(100006)
    }

    // Token withdrawals (e.g. USDT_TRON) are signed from the master account,
    // not this address — only allowed once a master is actually configured
    // for this currency. Native currencies withdraw from their own address
    // as before and need no master at all.
    if (!isNativeCurrency(accountChain)) {
      const master = await getMasterAccount(accountRecord.merchantId, accountChain)
      if (!master) {
        console.error(`ERROR: No ${accountChain} master for merchant ${accountRecord.merchantId ?? '(none)'} — withdrawals unsupported`)
        return processError(100009)
      }
    }

    // Before anything is debited: an address on another network, or a cut paste, would otherwise
    // fail in the queue processor after the balance was taken
    if (!isValidAddressFor(accountChain, destinationAddress)) {
      console.error(`ERROR: Destination is not a ${accountChain} address`)
      return processError(100048)
    }

    // If a direct crypto amount is provided, skip the fiat conversion
    let cryptoAmount: number
    let exchangeRate: number
    if (directCryptoAmount != null) {
      cryptoAmount = parseFloat(parseFloat(directCryptoAmount).toFixed(8))
      exchangeRate = 1
      console.log(`DEBUG: Direct crypto withdrawal — debiting ${cryptoAmount} ${accountChain}`)
    } else {
      console.log(`DEBUG: Fetching exchange rate ${accountChain}/${currency}`)
      exchangeRate = await fetchCryptoPrice(accountChain, currency)
      cryptoAmount = parseFloat((amount / exchangeRate).toFixed(8))
      console.log(`DEBUG: Exchange rate: 1 ${accountChain} = ${exchangeRate} ${currency} → debiting ${cryptoAmount} ${accountChain}`)
    }

    const effectiveTransactionId = transactionId || `wdr_${Date.now()}`

    // Atomically deduct balance — fails if insufficient funds
    const deductResult = await updateItem({
      tableName: 'v1AccountBalanceTable',
      key: { id: vAccountId },
      updateExpression: 'SET #balance = #balance - :amount, #availableBalance = #availableBalance - :amount, #lastUpdated = :now',
      conditionExpression: '#availableBalance >= :amount',
      attributeNames: {
        '#balance': 'balance',
        '#availableBalance': 'availableBalance',
        '#lastUpdated': 'lastUpdated',
      },
      attributeValues: {
        ':amount': cryptoAmount,
        ':now': new Date().toISOString(),
      },
    })

    if (!deductResult.success) {
      if (deductResult.error?.name === 'ConditionalCheckFailedException') {
        console.error(`ERROR: Insufficient balance. vAccountId: ${vAccountId}, requested: ${cryptoAmount} ${accountChain}`)
        return processError(100007)
      }
      console.error('ERROR: Failed to deduct balance:', deductResult.error)
      return processError(100002, 'the withdrawal could not be started; nothing was debited')
    }

    console.log(`DEBUG: Balance deducted. vAccountId: ${vAccountId}, cryptoAmount: ${cryptoAmount} ${accountChain}`)

    try {
      const queueMessage = {
        queue: 'v1-withdrawal-processing-queue',
        transactionId: effectiveTransactionId,
        userId,
        vAccountId,
        merchantId: accountRecord.merchantId,
        chain: accountChain,
        cryptoAmount,
        destinationAddress,
        exchangeRate,
        originalAmount: amount,
        originalCurrency: currency,
        timestamp: Date.now(),
      }

      const queueUrl = process.env.WITHDRAWAL_QUEUE_URL || ''
      console.log('DEBUG: Sending withdrawal job to SQS queue:', queueUrl)
      const result = await sendToQueue(queueUrl, queueMessage)

      if (result.success) {
        const jobId = result.res?.MessageId
        console.log('DEBUG: Withdrawal job queued successfully. Job ID:', jobId)
        return response({
          statusCode: 200,
          headers: null,
          bodyObject: {
            success: true,
            jobId,
            transactionId: effectiveTransactionId,
            status: 'queued',
            message: 'Withdrawal is being processed',
            res: {
              jobId,
              transactionId: effectiveTransactionId,
              status: 'queued',
              cryptoAmount,
              cryptoCurrency: accountChain,
              exchangeRate,
            }
          }
        })
      }

      throw new Error('SQS send returned no success')
    } catch (err: any) {
      // Balance was deducted but queuing failed — credit back both amounts the debit took
      console.error('ERROR: Failed to queue withdrawal, rolling back balance deduction:', err)
      const restored = await updateItem({
        tableName: 'v1AccountBalanceTable',
        key: { id: vAccountId },
        updateExpression: 'SET #balance = #balance + :amount, #availableBalance = #availableBalance + :amount, #lastUpdated = :now',
        attributeNames: {
          '#balance': 'balance',
          '#availableBalance': 'availableBalance',
          '#lastUpdated': 'lastUpdated',
        },
        attributeValues: {
          ':amount': cryptoAmount,
          ':now': new Date().toISOString(),
        },
      })
      if (!restored.success) {
        // Nothing was sent, but the balance stays short until someone credits it back
        console.error(`CRITICAL: Withdrawal ${effectiveTransactionId} was not queued and ${cryptoAmount} ${accountChain} could not be credited back to ${vAccountId}`, restored.error)
        return processError(100002, 'the withdrawal could not be started; nothing was sent, but the balance could not be restored yet')
      }
      return processError(100002, 'the withdrawal could not be started; nothing was sent and the balance was restored')
    }
  }
}
