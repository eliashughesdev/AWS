import { queryRecord, updateItem } from '../../../utils/db'
import { PaymentProviderType } from '../../../utils/PaymentProviders'
import { PaymentOrchestrator, AttemptLogEntry } from '../../../utils/PaymentOrchestrator'
import { notifyPaymentResult } from '../../../utils/websocket'
import { lookupBin, getProviderByCountry } from '../../../utils/binLookup'
import {
  generatePaymentOrderId,
  createOrderLog,
  logAttempt,
  updateOrderStatus,
  PaymentLogStatus,
} from '../../../utils/paymentLogger'

/**
 * Processes a payment with 3DS authentication in a single step
 */
export const handlePayment = async (message: any): Promise<boolean> => {
  console.log('DEBUG: ProcessPaymentHandler execution started.')
  console.log('DEBUG: Incoming Message:', JSON.stringify(message))

  const { paymentId, transactionId, userId, amount, currency, provider = 'stripe', guestMode, ...additionalParams } = message

  // transactionId is used for WebSocket lookup (what frontend uses to connect)
  // paymentId is used to look up the saved payment method (or a synthetic WIDGET# key for guest payments)
  const wsTransactionId = transactionId || paymentId

  console.log('DEBUG: Processing payment for userId:', userId, 'paymentId:', paymentId, 'transactionId:', wsTransactionId, 'amount:', amount, 'currency:', currency, 'provider:', provider, 'guestMode:', guestMode)

  if (!paymentId || !userId || !amount || !currency) {
    console.log('DEBUG: Missing required parameters')
    return false
  }

  // Generate server-side payment order ID for transaction logging
  const paymentOrderId = generatePaymentOrderId()

  // Resolve card data and stored credentials based on mode
  let encryptedCardData: any
  let storedCredentials: Record<string, any> | undefined

  if (guestMode) {
    // Widget/guest path — card data arrives inline, already encrypted by Evervault relay.
    // No DB lookup and no credentials to persist.
    console.log('DEBUG: Guest mode — using inline card data, skipping DB lookup.')
    encryptedCardData = additionalParams.cardData
    storedCredentials = undefined

    if (!encryptedCardData) {
      console.log('DEBUG: Guest mode but no cardData provided')
      await notifyPaymentResult(wsTransactionId, userId, {
        success: false,
        status: 'failed',
        error: 'No card data provided',
      }, paymentId)
      return false
    }
  } else {
    // Saved-card path — retrieve encrypted card data and stored credentials from DynamoDB
    console.log('DEBUG: Querying for payment record...')
    const paymentRecord = await queryRecord('v2CustomerTable', 'id = :id AND sk = :sk', {
      ':id': userId,
      ':sk': `PAYMENT#${paymentId}`,
    })

    console.log('DEBUG: Query successful:', paymentRecord.success, 'Records found:', paymentRecord.res ? paymentRecord.res.length : 0)

    if (!paymentRecord.success || !paymentRecord.res || paymentRecord.res.length === 0) {
      console.log('DEBUG: Payment method not found')
      await notifyPaymentResult(wsTransactionId, userId, {
        success: false,
        status: 'failed',
        error: 'Payment method not found',
      }, paymentId)
      return false
    }

    encryptedCardData = paymentRecord.res[0].cardData

    const credentialsKey = `${provider}Credentials`
    storedCredentials = paymentRecord.res[0][credentialsKey] as Record<string, any> | undefined
  }

  console.log('DEBUG: Card data ready for processing. guestMode:', guestMode)
  if (storedCredentials) {
    console.log(`DEBUG: Stored credentials found for provider ${provider}`)
  }

  try {
    // Build configuration for payment processor
    const processorConfig = {
      evervaultAppId: 'app_322d8e2bc10b',
      evervaultApiKey: process.env.EVERVAULT_API_KEY || '',
      stripeApiKey: process.env.STRIPE_API_KEY,
      cloverPrivateToken: process.env.CLOVER_PRIVATE_TOKEN,
      cloverPublicKey: process.env.CLOVER_PUBLIC_KEY
    }
    console.log('DEBUG: Payment processor configuration built.', JSON.stringify(processorConfig))

    // Determine provider based on BIN lookup (US/CA → Clover, otherwise → Stripe)
    let resolvedProvider = provider
    const bin = additionalParams.bin

    if (bin) {
      console.log('DEBUG: Performing BIN lookup for:', bin)
      const binResult = await lookupBin(bin, {
        appId: processorConfig.evervaultAppId,
        apiKey: processorConfig.evervaultApiKey,
      })
      console.log('DEBUG: BIN lookup completed:', JSON.stringify(binResult))

      if (binResult?.country) {
        resolvedProvider = getProviderByCountry(binResult.country)
        console.log(`DEBUG: BIN country: ${binResult.country}, resolved provider: ${resolvedProvider}`)
      } else {
        console.log('DEBUG: BIN lookup failed or no country, using default provider:', provider)
      }
    } else {
      console.log('DEBUG: No BIN provided, using default provider:', provider)
    }

    // Create the ORDER#META log record
    try {
      await createOrderLog({
        paymentOrderId,
        userId,
        clientTransactionId: wsTransactionId,
        paymentId,
        primaryProvider: resolvedProvider,
        amount,
        currency,
      })
    } catch (logErr) {
      console.error('Failed to create order log:', logErr)
    }

    // Per-attempt logging callback for the orchestrator
    const onAttempt = async (entry: AttemptLogEntry) => {
      const mapStatus = (result: any): PaymentLogStatus => {
        if (result.success && result.status === 'requires_action') return 'requires_action'
        if (result.success && result.status === 'succeeded') return 'succeeded'
        if (!result.success && result.status === 'declined') return 'declined'
        if (!result.success && result.retryable) return 'error'
        if (!result.success) return 'failed'
        return 'processing'
      }

      await logAttempt({
        paymentOrderId,
        userId,
        attemptNumber: entry.attemptNumber,
        provider: entry.provider,
        status: mapStatus(entry.result),
        providerRef: entry.result.transactionId || entry.result.metadata?.paymentIntentId || '',
        amount,
        currency,
        errorMessage: entry.result.error,
        retryable: entry.result.retryable,
        providerMetadata: entry.result.metadata,
      })
    }

    // Process the payment with failover support
    console.log('DEBUG: Processing payment with failover, primary provider:', resolvedProvider)
    const offSession = !!additionalParams.offSession
    const paymentResult = await PaymentOrchestrator.processWithFailover(
      resolvedProvider as PaymentProviderType,
      {
        amount,
        currency,
        cardData: encryptedCardData,
        userId,
        offSession,
        storedCredentials,
        metadata: {
          ...additionalParams
        }
      },
      processorConfig,
      onAttempt
    )

    console.log('DEBUG: Payment processor result:', JSON.stringify(paymentResult))

    // Persist credentials returned by the processor under the provider-specific key.
    // Only for saved-card payments — guest/widget payments must never write to DynamoDB.
    const credentialsToSave = paymentResult.metadata?.credentialsToSave as Record<string, any> | undefined
    const actualProvider = paymentResult.metadata?.provider || resolvedProvider
    const actualCredentialsKey = `${actualProvider}Credentials`
    if (credentialsToSave && !storedCredentials && !guestMode) {
      try {
        await updateItem({
          tableName: 'v2CustomerTable',
          key: { id: userId, sk: `PAYMENT#${paymentId}` },
          updateExpression: 'SET #credKey = :creds, updated_at = :ts',
          attributeNames: { '#credKey': actualCredentialsKey },
          attributeValues: {
            ':creds': credentialsToSave,
            ':ts': Date.now(),
          }
        })
        console.log(`DEBUG: ${actualProvider} credentials saved to DynamoDB`)
      } catch (saveErr) {
        console.error('Failed to save credentials to DynamoDB:', saveErr)
      }
    }

    // Determine final status for the order log
    const finalStatus: PaymentLogStatus =
            paymentResult.success && paymentResult.status === 'requires_action'
              ? 'requires_action'
              : paymentResult.success && paymentResult.status === 'succeeded'
                ? 'succeeded'
                : !paymentResult.success && paymentResult.status === 'declined'
                    ? 'declined'
                    : paymentResult.success ? 'succeeded' : 'failed'

    // Update the ORDER#META with the final outcome
    try {
      await updateOrderStatus({
        paymentOrderId,
        finalStatus,
        finalProvider: paymentResult.metadata?.provider,
        providerRef: paymentResult.transactionId || paymentResult.metadata?.paymentIntentId || '',
        totalAttempts: paymentResult.metadata?.attempts || 0,
      })
    } catch (logErr) {
      console.error('Failed to update order status:', logErr)
    }

    // Handle the payment result
    if (!paymentResult.success) {
      console.error('Payment processing failed:', paymentResult.error)

      await notifyPaymentResult(wsTransactionId, userId, {
        success: false,
        status: 'failed',
        error: paymentResult.error || 'Payment processing failed',
      }, paymentId)

      return false
    }

    if (paymentResult.status === 'requires_action') {
      // 3DS authentication required — send redirect URL to client
      console.log('DEBUG: 3DS authentication required')

      await notifyPaymentResult(wsTransactionId, userId, {
        success: true,
        status: 'requires_action',
        authenticationUrl: paymentResult.metadata?.authenticationUrl,
        paymentIntentId: paymentResult.metadata?.paymentIntentId,
        clientSecret: paymentResult.metadata?.clientSecret,
      }, paymentId)

      return true
    } else if (paymentResult.status === 'succeeded') {
      console.log('DEBUG: Payment succeeded')

      await notifyPaymentResult(wsTransactionId, userId, {
        success: true,
        status: 'succeeded',
        paymentTransactionId: paymentResult.transactionId,
      }, paymentId)

      return true
    } else {
      console.log('DEBUG: Payment status:', paymentResult.status)

      await notifyPaymentResult(wsTransactionId, userId, {
        success: false,
        status: paymentResult.status,
        error: paymentResult.error || 'Payment failed',
      }, paymentId)

      return false
    }
  } catch (err: any) {
    console.error('FATAL ERROR: Payment processing error:', err)
    console.error('Error stack:', err.stack)

    try {
      await updateOrderStatus({
        paymentOrderId,
        finalStatus: 'error',
        totalAttempts: 0,
      })
    } catch (logErr) {
      console.error('Failed to log fatal error to transaction logs:', logErr)
    }

    try {
      await notifyPaymentResult(wsTransactionId, userId, {
        success: false,
        error: 'Payment processing error',
      }, paymentId)
    } catch (notifyErr) {
      console.error('Failed to send error notification:', notifyErr)
    }

    return false
  }
}
