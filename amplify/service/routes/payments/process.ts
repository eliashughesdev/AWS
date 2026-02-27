import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { sendToQueue } from '../../../utils/sqs'

/**
 * Queues a payment for async processing
 */
export default class ProcessPaymentHandler {
    async execute(event: any) {
        console.log('DEBUG: ProcessPaymentHandler execution started.');
        console.log('DEBUG: Incoming Event:', JSON.stringify(event));
        console.log('DEBUG: Event Body:', JSON.stringify(event.body));

        const { paymentId, cardData, userId, amount, currency, provider = 'stripe', transactionId, offSession, ...additionalParams } = event.body;

        // guestMode: card data arrives inline (widget flow), no saved paymentId
        const guestMode = paymentId ? false : true;
        const effectiveTransactionId = transactionId || paymentId || `txn_${Date.now()}`;
        const effectivePaymentId = paymentId ? paymentId : `WIDGET#${effectiveTransactionId}`;

        console.log('DEBUG: Queueing payment for userId:', userId, 'paymentId:', effectivePaymentId, 'transactionId:', effectiveTransactionId, 'amount:', amount, 'currency:', currency, 'provider:', provider, 'guestMode:', guestMode);

        // Validate required parameters — need either a saved paymentId or inline cardData
        if (!paymentId && !cardData) {
            return processError(100029, 'Missing required parameters: provide paymentId or cardData');
        }
        if (!userId || !amount || !currency) {
            return processError(100029, 'Missing required parameters: userId, amount, or currency');
        }

        try {
            // Prepare message for queue
            // transactionId is used for WebSocket correlation (what frontend uses to connect)
            // paymentId is used to look up the saved payment method (or a synthetic WIDGET# key for guest payments)
            const queueMessage: Record<string, any> = {
                queue: 'v1-payment-processing-queue',
                paymentId: effectivePaymentId,
                transactionId: effectiveTransactionId,
                userId,
                amount,
                currency,
                provider,
                offSession: offSession || false,
                guestMode,
                timestamp: Date.now(),
                ...additionalParams,
            };

            if (guestMode && cardData) {
                queueMessage.cardData = cardData;
            }

            // Send to SQS queue
            console.log('DEBUG: Sending payment job to SQS queue:', process.env.PAYMENT_PROCESSING_QUEUE_URL);
            const queue_url = process.env.PAYMENT_PROCESSING_QUEUE_URL || "https://sqs.us-east-2.amazonaws.com/129364817855/v1-payment-processing-queue"
            const result = await sendToQueue(queue_url, queueMessage)
            console.log('DEBUG: Payment job queued successfully. Job ID:', result.res?.MessageId);

            if (result.success){
                const jobId = result.res?.MessageId;
                return response({
                    statusCode: 200,
                    headers: null,
                    bodyObject: {
                        success: true,
                        jobId: jobId,
                        status: 'queued',
                        message: 'Payment is being processed',
                        res: {
                            jobId: jobId,
                            paymentId: effectivePaymentId,
                            status: 'queued'
                        }
                    }
                });
            }

        } catch (err: any) {
            console.error('FATAL ERROR: Failed to queue payment:', err);
            console.error('Error stack:', err.stack);
            return processError(100002, 'Failed to queue payment for processing');
        }
    }
}