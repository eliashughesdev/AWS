import { queryRecord } from '../../../utils/db'
import { PaymentProviderType } from '../../../utils/PaymentProviders'
import { PaymentOrchestrator } from '../../../utils/PaymentOrchestrator'
import { notifyPaymentResult } from '../../../utils/websocket'
import { lookupBin, getProviderByCountry } from '../../../utils/binLookup'

/**
 * Processes a payment with 3DS authentication in a single step
 */
export const handlePayment = async (message: any): Promise<boolean> => {
    console.log('DEBUG: ProcessPaymentHandler execution started.');
    console.log('DEBUG: Incoming Message:', JSON.stringify(message));

    const { paymentId, transactionId, userId, amount, currency, provider = 'stripe', ...additionalParams } = message;

    // transactionId is used for WebSocket lookup (what frontend uses to connect)
    // paymentId is used to look up the saved payment method
    const wsTransactionId = transactionId || paymentId;

    console.log('DEBUG: Processing payment for userId:', userId, 'paymentId:', paymentId, 'transactionId:', wsTransactionId, 'amount:', amount, 'currency:', currency, 'provider:', provider);

    if (!paymentId || !userId || !amount || !currency) {
        console.log('DEBUG: Missing required parameters');
        return false;
    }

    try {
        // Retrieve the saved payment method
        console.log('DEBUG: Querying for payment record...');
        const paymentRecord = await queryRecord('v2CustomerTable', 'id = :id AND sk = :sk', {
            ':id': userId,
            ':sk': `PAYMENT#${paymentId}`,
        });

        console.log('DEBUG: Query successful:', paymentRecord.success, 'Records found:', paymentRecord.res ? paymentRecord.res.length : 0);

        if (!paymentRecord.success || !paymentRecord.res || paymentRecord.res.length === 0) {
            console.log('DEBUG: Payment method not found');

            await notifyPaymentResult(wsTransactionId, userId, {
                success: false,
                status: 'failed',
                error: 'Payment method not found',
            }, paymentId);

            return false;
        }

        const encryptedCardData = paymentRecord.res[0].cardData;

        console.log('DEBUG: Retrieved encrypted card data for processing.');

        // Build configuration for payment processor
        const processorConfig = {
            evervaultAppId: "app_322d8e2bc10b",
            evervaultApiKey: process.env.EVERVAULT_API_KEY || "",
            stripeApiKey: process.env.STRIPE_API_KEY,
            cloverPrivateToken: process.env.CLOVER_PRIVATE_TOKEN,
            cloverPublicKey: process.env.CLOVER_PUBLIC_KEY
        };
        console.log('DEBUG: Payment processor configuration built.', JSON.stringify(processorConfig));

        // Determine provider based on BIN lookup (US/CA → Clover, otherwise → Stripe)
        let resolvedProvider = provider;
        const bin = additionalParams.bin;

        if (bin) {
            console.log('DEBUG: Performing BIN lookup for:', bin);
            const binResult = await lookupBin(bin, {
                appId: processorConfig.evervaultAppId,
                apiKey: processorConfig.evervaultApiKey,
            });
            console.log('DEBUG: BIN lookup completed:', JSON.stringify(binResult));

            if (binResult?.country) {
                resolvedProvider = getProviderByCountry(binResult.country);
                console.log(`DEBUG: BIN country: ${binResult.country}, resolved provider: ${resolvedProvider}`);
            } else {
                console.log('DEBUG: BIN lookup failed or no country, using default provider:', provider);
            }
        } else {
            console.log('DEBUG: No BIN provided, using default provider:', provider);
        }

        // Process the payment with failover support
        console.log('DEBUG: Processing payment with failover, primary provider:', resolvedProvider);
        const paymentResult = await PaymentOrchestrator.processWithFailover(
            resolvedProvider as PaymentProviderType,
            {
                amount: amount,
                currency: currency,
                cardData: encryptedCardData,
                userId: userId,
                metadata: {
                    ...additionalParams
                }
            },
            processorConfig
        );

        console.log('DEBUG: Payment processor result:', JSON.stringify(paymentResult));

        // Handle the payment result
        if (!paymentResult.success) {
            console.error('Payment processing failed:', paymentResult.error);

            // Notify via WebSocket about the failure
            await notifyPaymentResult(wsTransactionId, userId, {
                success: false,
                status: 'failed',
                error: paymentResult.error || 'Payment processing failed',
            }, paymentId);

            return false;
        }

        if (paymentResult.status === 'requires_action') {
            // 3DS authentication required — send redirect URL to client
            console.log('DEBUG: 3DS authentication required');

            await notifyPaymentResult(wsTransactionId, userId, {
                success: true,
                status: 'requires_action',
                authenticationUrl: paymentResult.metadata?.authenticationUrl,
                paymentIntentId: paymentResult.metadata?.paymentIntentId,
                clientSecret: paymentResult.metadata?.clientSecret,
            }, paymentId);

            return true;
        } else if (paymentResult.status === 'succeeded') {
            // Payment succeeded
            console.log('DEBUG: Payment succeeded');

            // Notify via WebSocket
            await notifyPaymentResult(wsTransactionId, userId, {
                success: true,
                status: 'succeeded',
                paymentTransactionId: paymentResult.transactionId,
            }, paymentId);

            return true;
        } else {
            // Other status (declined, error, etc.)
            console.log('DEBUG: Payment status:', paymentResult.status);

            // Notify via WebSocket
            await notifyPaymentResult(wsTransactionId, userId, {
                success: false,
                status: paymentResult.status,
                error: paymentResult.error || 'Payment failed',
            }, paymentId);

            return false;
        }

    } catch (err: any) {
        console.error('FATAL ERROR: Payment processing error:', err);
        console.error('Error stack:', err.stack);

        // Notify via WebSocket about the error
        try {
            await notifyPaymentResult(wsTransactionId, userId, {
                success: false,
                error: 'Payment processing error',
            }, paymentId);
        } catch (notifyErr) {
            console.error('Failed to send error notification:', notifyErr);
        }

        return false;
    }
}
