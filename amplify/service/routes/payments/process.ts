import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord } from '../../../utils/db'
import { processError } from '../../../errors/http'
import Evervault from '@evervault/sdk'

/**
 * Processes a payment using a saved payment method
 */
export default class ProcessPaymentHandler {
    async execute(event: any) {
        console.log('DEBUG: ProcessPaymentHandler execution started.');
        console.log('DEBUG: Incoming Event:', JSON.stringify(event));
        console.log('DEBUG: Event Body:', JSON.stringify(event.body));

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

            const encryptedCardData = paymentRecord.res[0].cardData;

            console.log('DEBUG: Retrieved encrypted card data for processing.');

            // Initialize Evervault
            const API_KEY = process.env.EVERVAULT_API_KEY || "define the evervault api key";
            const STRIPE_SECRET_KEY = process.env.STRIPE_API_KEY || "define stripe secret key";

            console.log('DEBUG: Initializing Evervault with API Key.');
            const evervault = new Evervault("app_322d8e2bc10b", API_KEY);
            console.log('DEBUG: Evervault initialized.');

            // Prepare the Stripe API request configuration (proxy object)
            const stripeRequest = {
                url: "https://api.stripe.com/v1/payment_intents",
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: {
                    amount: amount,
                    currency: currency,
                    "payment_method_data[type]": "card",
                    "payment_method_data[card][number]": "{{CARD_NUMBER}}",
                    "payment_method_data[card][exp_month]": "{{EXP_MONTH}}",
                    "payment_method_data[card][exp_year]": "{{EXP_YEAR}}",
                    "payment_method_data[card][cvc]": "{{CVC}}",
                    confirm: "true"
                }
            };

            console.log('DEBUG: Encrypting proxy request configuration...');

            // Encrypt the proxy request configuration
            const encryptedProxy = await evervault.encrypt(JSON.stringify(stripeRequest));
            console.log('DEBUG: Proxy request encrypted.');

            console.log('DEBUG: Running Evervault payment-proxy function...');

            const paymentResult = await evervault.run('payments', {
                proxy: encryptedProxy,
                card_data: encryptedCardData
            });

            console.log('DEBUG: Evervault function executed. Result:', JSON.stringify(paymentResult));

            if (!paymentResult || !paymentResult.id) {
                console.error('Payment processing failed:', paymentResult);
                return processError(100002, `Payment processing failed: ${JSON.stringify(paymentResult)}`);
            }

            console.log('DEBUG: Payment processed successfully. Transaction ID:', paymentResult.id);

            return response({
                statusCode: 200,
                headers: null,
                bodyObject: {
                    success: true,
                    res: {
                        transactionId: paymentResult.id,
                        status: paymentResult.status,
                    }
                }
            });

        } catch (err) {
            console.error('FATAL ERROR: Payment processing error:', err);
            return processError(100002, 'Failed to process payment');
        }
    }
}