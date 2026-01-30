import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { PaymentProcessorRegistry, PaymentProviderType } from '../../../utils/PaymentProviders'

/**
 * Processes a payment with 3DS authentication in a single step
 */
export default class ProcessPaymentHandler {
    async execute(event: any) {
        console.log('DEBUG: ProcessPaymentHandler execution started.');
        console.log('DEBUG: Incoming Event:', JSON.stringify(event));
        console.log('DEBUG: Event Body:', JSON.stringify(event.body));

        const { paymentId, userId, amount, currency, provider = 'stripe', ...additionalParams } = event.body;

        console.log('DEBUG: Processing payment for userId:', userId, 'paymentId:', paymentId, 'amount:', amount, 'currency:', currency, 'provider:', provider);

        if (!paymentId || !userId || !amount || !currency) {
            return processError(100029, 'Missing required parameters: paymentId, userId, amount, or currency');
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
                return processError(100004, 'Payment method not found');
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
            console.log('DEBUG: Environment variables for payment processor:', process.env.CLOVER_PUBLIC_KEY)
            console.log('DEBUG: Payment processor configuration built.', JSON.stringify(processorConfig));

            // Get payment processor from registry
            console.log('DEBUG: Initializing payment processor for provider:', provider);
            const paymentProcessor = PaymentProcessorRegistry.getProcessor(
                provider as PaymentProviderType,
                processorConfig
            );

            if (!paymentProcessor) {
                console.error(`Failed to initialize payment processor for provider: ${provider}`);
                return processError(100031, `Failed to initialize payment processor for provider: ${provider}`);
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
                return response({
                    statusCode: 200,
                    headers: null,
                    bodyObject: {
                        success: false,
                        res: {
                            error: paymentResult.error,
                            status: paymentResult.status,
                            metadata: paymentResult.metadata
                        }
                    }
                });
            }

            // Check if additional action is required (e.g., 3DS)
            if (paymentResult.status === 'requires_action') {
                console.log('DEBUG: Additional action required');
                return response({
                    statusCode: 200,
                    headers: null,
                    bodyObject: {
                        success: true,
                        requiresAction: true,
                        res: {
                            transactionId: paymentResult.transactionId,
                            status: paymentResult.status,
                            ...paymentResult.metadata
                        }
                    }
                });
            } else if (paymentResult.status === 'succeeded') {
                // Payment succeeded
                console.log('DEBUG: Payment succeeded');
                return response({
                    statusCode: 200,
                    headers: null,
                    bodyObject: {
                        success: true,
                        requiresAction: false,
                        res: {
                            transactionId: paymentResult.transactionId,
                            status: paymentResult.status,
                            ...paymentResult.metadata
                        }
                    }
                });
            } else {
                // Other status (declined, error, etc.)
                console.log('DEBUG: Payment status:', paymentResult.status);
                return response({
                    statusCode: 200,
                    headers: null,
                    bodyObject: {
                        success: false,
                        res: {
                            error: paymentResult.error || 'Unknown payment status',
                            status: paymentResult.status,
                            ...paymentResult.metadata
                        }
                    }
                });
            }

        } catch (err: any) {
            console.error('FATAL ERROR: Payment processing error:', err);
            console.error('Error stack:', err.stack);
            return processError(100002, 'Failed to process payment');
        }
    }
}