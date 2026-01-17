import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord } from '../../../utils/db'
import { processError } from '../../../errors/http'
import { StripePaymentProcessor } from '../../../providers/payment/StripePaymentProcessor'
import { PaymentParams } from '../../../providers/payment/PaymentProcessor'

/**
 * Processes a payment using a saved payment method
 */
export default class ProcessPaymentHandler {
    async execute(event: any) {
        console.log('DEBUG: ProcessPaymentHandler execution started.');
        console.log('DEBUG: Incoming Event:', JSON.stringify(event));
        console.log('DEBUG: Event Body:', JSON.stringify(event.body));

        // if (!event.body || typeof event.body !== 'object') {
        //     console.log('DEBUG: Invalid body type or missing body');
        //     return processError(100029, 'Invalid request body');
        // }

        const { paymentId, userId, amount, currency } = event.body;

        console.log('DEBUG: Processing payment for userId:', userId, 'paymentId:', paymentId, 'amount:', amount, 'currency:', currency);

        if (!paymentId || !userId || !amount || !currency) {
            return processError(100029, 'Missing paymentId, userId, amount, or currency');
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

            const cardData = paymentRecord.res[0].cardData;

            console.log('DEBUG: Retrieved card data for processing. Card data keys:', Object.keys(cardData));
            console.log("++++++++++++++++++++++++++++++++", process.env.STRIPE_API_KEY!)

            // Process the payment using Stripe via Evervault relay
            const stripeProcessor = new StripePaymentProcessor(
                process.env.STRIPE_API_KEY!,
                'api-stripe-com-app-322d8e2bc10b.relay.evervault.app'
            );

            const paymentParams: PaymentParams = {
                amount: amount,
                currency: currency,
                cardData: cardData,
                userId: userId,
            };

            const paymentResult = await stripeProcessor.processPayment(paymentParams);

            if (!paymentResult.success) {
                console.error('Payment processing failed:', paymentResult.error);
                return processError(100002, `Payment processing failed: ${paymentResult.error}`);
            }

            console.log('DEBUG: Payment processed successfully. Transaction ID:', paymentResult.transactionId);

            return response({
                statusCode: 200,
                headers: null,
                bodyObject: {
                    success: true,
                    res: {
                        transactionId: paymentResult.transactionId,
                    }
                }
            });

        } catch (err) {
            console.error('FATAL ERROR: Payment processing error:', err);
            return processError(100002, 'Failed to process payment');
        }
    }
}