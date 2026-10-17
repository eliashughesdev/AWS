import { response } from '../../../utils/http'
import { queryItemFromIndex, transactWriteItems, updateItem } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'
import { fetchCryptoPrice } from '../../../utils/exchangeRate'
import { decimalsFor, isNativeCurrency } from '../../../utils/currencies'
import { getMasterAccount } from '../../../utils/masterAccount'
import { accountKeyRef } from '../../../utils/signing'
import { isValidAddressFor } from '../../../utils/addresses'
import { callerUser } from '../../../utils/caller'
import { checkKyc } from '../../../utils/kycPolicy'
import { newOperation, settleOperation } from '../../../utils/operations'

// Held back for the network fee of a native coin: the real one is only known
// after the broadcast, and the customer pays it. The same numbers as core's
// withdrawalFeeReserve, which NODA's Max leaves
const FEE_RESERVES: Record<string, number> = { TRON: 1, SOL: 0.000005 }

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

    // The merchant's KYC policy for this currency (docs/public-api-plan.md D11), before any debit
    const kycRefusal = await checkKyc({ userId, merchantId: accountRecord.merchantId, currency: accountChain, operation: 'withdraw' })
    if (kycRefusal) return kycRefusal

    // Rounded to what the chain carries, so DynamoDB, Tatum and the chain move the same amount (B21).
    // If a direct crypto amount is provided, skip the fiat conversion
    const decimals = decimalsFor(accountChain)
    let cryptoAmount: number
    let exchangeRate: number
    if (directCryptoAmount != null) {
      cryptoAmount = parseFloat(parseFloat(directCryptoAmount).toFixed(decimals))
      exchangeRate = 1
      console.log(`DEBUG: Direct crypto withdrawal — debiting ${cryptoAmount} ${accountChain}`)
    } else {
      console.log(`DEBUG: Fetching exchange rate ${accountChain}/${currency}`)
      exchangeRate = await fetchCryptoPrice(accountChain, currency)
      cryptoAmount = parseFloat((amount / exchangeRate).toFixed(decimals))
      console.log(`DEBUG: Exchange rate: 1 ${accountChain} = ${exchangeRate} ${currency} → debiting ${cryptoAmount} ${accountChain}`)
    }

    if (!(cryptoAmount > 0)) {
      console.error(`ERROR: ${directCryptoAmount ?? amount} rounds to 0 ${accountChain}`)
      return processError(100031, directCryptoAmount != null ? 'cryptoAmount' : 'amount')
    }

    // The balance must also cover the fee, which is debited once the chain reports it
    const reserve = FEE_RESERVES[accountChain.toUpperCase()] ?? 0
    const required = parseFloat((cryptoAmount + reserve).toFixed(decimals))

    const effectiveTransactionId = transactionId || `wdr_${Date.now()}`

    // The withdrawal's record (utils/operations.ts) and the debit, together or not at all: the
    // debit fails if the balance is short, the record if this transactionId was used before
    const deductResult = await transactWriteItems({
      puts: [{
        tableName: 'v2CustomerTable',
        item: newOperation({
          userId,
          opId: effectiveTransactionId,
          kind: 'withdrawal',
          accountNumber,
          currency: accountChain,
          amount: cryptoAmount,
          ...(directCryptoAmount == null ? { fiatAmount: amount, fiatCurrency: currency } : {}),
          destinationAddress,
        }),
        conditionExpression: 'attribute_not_exists(id)',
      }],
      updates: [{
        tableName: 'v1AccountBalanceTable',
        key: { id: vAccountId },
        updateExpression: 'SET #balance = #balance - :amount, #availableBalance = #availableBalance - :amount, #lastUpdated = :now',
        conditionExpression: '#availableBalance >= :required',
        attributeNames: {
          '#balance': 'balance',
          '#availableBalance': 'availableBalance',
          '#lastUpdated': 'lastUpdated',
        },
        attributeValues: {
          ':amount': cryptoAmount,
          ':required': required,
          ':now': new Date().toISOString(),
        },
      }],
    })

    if (!deductResult.success) {
      const [recordReason, debitReason] = deductResult.reasons ?? []
      if (debitReason === 'ConditionalCheckFailed') {
        console.error(`ERROR: Insufficient balance. vAccountId: ${vAccountId}, requested: ${cryptoAmount} ${accountChain} + ${reserve} for the fee`)
        return processError(100007)
      }
      if (recordReason === 'ConditionalCheckFailed') {
        console.error(`ERROR: Withdrawal ${effectiveTransactionId} already exists; nothing was debited`)
        return processError(100031, 'transactionId')
      }
      console.error('ERROR: Failed to deduct balance:', deductResult.error?.name)
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
      // Not sent, and never will be: the record says so whether or not the balance came back
      await settleOperation(userId, effectiveTransactionId, { status: 'failed', code: 100002 })
      if (!restored.success) {
        // Nothing was sent, but the balance stays short until someone credits it back
        console.error(`CRITICAL: Withdrawal ${effectiveTransactionId} was not queued and ${cryptoAmount} ${accountChain} could not be credited back to ${vAccountId}`, restored.error)
        return processError(100002, 'the withdrawal could not be started; nothing was sent, but the balance could not be restored yet')
      }
      return processError(100002, 'the withdrawal could not be started; nothing was sent and the balance was restored')
    }
  }
}
