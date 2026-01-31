import { queryRecord } from '../../../utils/db'
import { PaymentProcessorRegistry, PaymentProviderType } from '../../../utils/PaymentProviders'

/**
 * Processes a payment with 3DS authentication in a single step
 */
export const handlePayment = async (message: any): Promise<boolean> => {
    console.log('DEBUG: ProcessPaymentHandler execution started.');
    console.log('DEBUG: Incoming Message:', JSON.stringify(message));

    const { paymentId, userId, amount, currency, provider = 'stripe', ...additionalParams } = message;

    console.log('DEBUG: Processing payment for userId:', userId, 'paymentId:', paymentId, 'amount:', amount, 'currency:', currency, 'provider:', provider);

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

        // Get payment processor from registry
        console.log('DEBUG: Initializing payment processor for provider:', provider);
        const paymentProcessor = PaymentProcessorRegistry.getProcessor(
            provider as PaymentProviderType,
            processorConfig
        );

        if (!paymentProcessor) {
            console.error(`Failed to initialize payment processor for provider: ${provider}`);
            return false;
        }

        // Process the payment
        console.log('DEBUG: Calling payment processor...');
        const paymentResult = await paymentProcessor.processPayment({
            amount: amount,
            currency: currency,
            cardData: encryptedCardData,
            userId: userId,
            metadata: {
                ...additionalParams
            }
        });

        console.log('DEBUG: Payment processor result:', JSON.stringify(paymentResult));

        // Handle the payment result
        if (!paymentResult.success) {
            console.error('Payment processing failed:', paymentResult.error);
            return false;
        }

        if (paymentResult.status === 'succeeded') {
            // Payment succeeded
            console.log('DEBUG: Payment succeeded');
            return true;
        } else {
            // Other status (declined, error, etc.)
            console.log('DEBUG: Payment status:', paymentResult.status);
            return false;
        }

    } catch (err: any) {
        console.error('FATAL ERROR: Payment processing error:', err);
        console.error('Error stack:', err.stack);
        return false;
    }
}
