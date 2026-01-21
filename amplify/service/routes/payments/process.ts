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

            const cardData = paymentRecord.res[0].cardData;

            console.log('DEBUG: Retrieved card data for processing.');

            // Initialize Evervault
            const API_KEY = process.env.EVERVAULT_API_KEY || "define the evervault api key";
            console.log('DEBUG: Initializing Evervault with API Key.');
            const evervault = new Evervault("app_322d8e2bc10b", API_KEY);
            console.log('DEBUG: Evervault initialized.');
            console.log('DEBUG: Running Evervault payment function...');

            // Call the Evervault function
            const paymentResult = await evervault.run('payments', {
                cardData: cardData,
                amount: amount,
                currency: currency,
                userId: userId,
            });
            console.log('DEBUG: Evervault function executed. Result:', JSON.stringify(paymentResult));

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