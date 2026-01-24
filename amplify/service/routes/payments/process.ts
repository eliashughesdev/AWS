import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { queryRecord } from '../../../utils/db'
import { processError } from '../../../errors/http'
import Evervault from '@evervault/sdk'

/**
 * Processes a payment with 3DS authentication in a single step
 */
export default class ProcessPaymentHandler {
    async execute(event: any) {
        console.log('DEBUG: ProcessPaymentHandler execution started.');
        console.log('DEBUG: Incoming Event:', JSON.stringify(event));
        console.log('DEBUG: Event Body:', JSON.stringify(event.body));

        const { paymentId, userId, amount, currency, returnUrl } = event.body;

        console.log('DEBUG: Processing payment for userId:', userId, 'paymentId:', paymentId, 'amount:', amount, 'currency:', currency);

        if (!paymentId || !userId || !amount || !currency || !returnUrl) {
            return processError(100029, 'Missing paymentId, userId, amount, currency, or returnUrl');
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
            const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "define stripe secret key";

            console.log('DEBUG: Initializing Evervault with API Key.');
            const evervault = new Evervault("app_322d8e2bc10b", API_KEY);
            console.log('DEBUG: Evervault initialized.');

            // Create PaymentIntent with card data directly (includes 3DS)
            const stripeRequest = {
                url: "https://api.stripe.com/v1/payment_intents",
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                // body: {
                //     amount: amount.toString(),
                //     currency: currency,
                //     "payment_method_data[type]": "card",
                //     "payment_method_data[card][number]": "{{CARD_NUMBER}}",
                //     "payment_method_data[card][exp_month]": "{{EXP_MONTH}}",
                //     "payment_method_data[card][exp_year]": "{{EXP_YEAR}}",
                //     "payment_method_data[card][cvc]": "{{CVC}}",
                //     // Enable 3DS
                //     "payment_method_options[card][request_three_d_secure]": "automatic",
                //     return_url: returnUrl,
                //     confirm: "true",
                //     capture_method: "automatic"
                // }
                body: {
                    amount: amount.toString(),
                    currency: currency,
                    payment_method: "pm_card_threeDSecure2Required",
                    // Enable 3DS
                    "payment_method_options[card][request_three_d_secure]": "automatic",
                    return_url: returnUrl,
                    confirm: "true",
                    capture_method: "automatic"
                }
            };

            console.log('DEBUG: Encrypting proxy request configuration...');

            // Encrypt the proxy request configuration
            const encryptedProxy = await evervault.encrypt(JSON.stringify(stripeRequest));
            console.log('DEBUG: Proxy request encrypted.');

            console.log('DEBUG: Running Evervault payment-proxy function...');

            const paymentResult = await evervault.run('payment-proxy', {
                proxy: encryptedProxy,
                card_data: encryptedCardData
            });

            console.log('DEBUG: Evervault function executed. Result:', JSON.stringify(paymentResult));

            if (!paymentResult || !paymentResult.id) {
                console.error('Payment processing failed:', paymentResult);
                return processError(100002, `Payment processing failed: ${JSON.stringify(paymentResult)}`);
            }

            console.log('DEBUG: PaymentIntent created:', paymentResult.id);
            console.log('DEBUG: PaymentIntent status:', paymentResult.status);

            // Check if 3DS authentication is required
            if (paymentResult.status === 'requires_action' &&
                paymentResult.next_action?.type === 'redirect_to_url') {

                console.log('DEBUG: 3DS authentication required');
                // 3DS authentication required - return redirect URL
                return response({
                    statusCode: 200,
                    headers: null,
                    bodyObject: {
                        success: true,
                        requiresAction: true,
                        res: {
                            paymentIntentId: paymentResult.id,
                            authenticationUrl: paymentResult.next_action.redirect_to_url.url,
                            clientSecret: paymentResult.client_secret,
                            status: paymentResult.status
                        }
                    }
                });
            } else if (paymentResult.status === 'succeeded') {
                console.log('DEBUG: Payment succeeded without 3DS');
                return response({
                    statusCode: 200,
                    headers: null,
                    bodyObject: {
                        success: true,
                        requiresAction: false,
                        res: {
                            transactionId: paymentResult.id,
                            status: paymentResult.status,
                            amount: paymentResult.amount,
                            currency: paymentResult.currency
                        }
                    }
                });
            } else if (paymentResult.status === 'requires_payment_method') {
                console.log('DEBUG: Payment failed - card declined');
                // Card was declined
                return response({
                    statusCode: 200,
                    headers: null,
                    bodyObject: {
                        success: false,
                        res: {
                            error: 'Card declined',
                            status: paymentResult.status
                        }
                    }
                });
            } else {
                console.log('DEBUG: Unexpected payment status:', paymentResult.status);
                // Other status
                return response({
                    statusCode: 200,
                    headers: null,
                    bodyObject: {
                        success: false,
                        res: {
                            error: `Unexpected payment status: ${paymentResult.status}`,
                            status: paymentResult.status
                        }
                    }
                });
            }

        } catch (err) {
            console.error('FATAL ERROR: Payment processing error:', err);
            return processError(100002, 'Failed to process payment');
        }
    }
}