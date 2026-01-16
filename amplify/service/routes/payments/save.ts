import type { Context } from 'aws-lambda'
import { response } from '../../../utils/http'
import { transactWriteItems } from '../../../utils/db'
import { processError } from '../../../errors/http'

/**
 * Saves payment card data
 */
export default class SavePaymentHandler {
    async execute(event: any, context: Context) {
        console.log('DEBUG: SavePaymentHandler execution started.');
        console.log('DEBUG: Incoming Event:', JSON.stringify(event));
        console.log('DEBUG: Event Body:', JSON.stringify(event.body));

        const { cardData, userId } = event.body;

        if (!cardData || !userId) {
            return processError(100029, 'Missing cardData or userId');
        }

        const paymentId = crypto.randomUUID();
        const paymentRecord: Record<string, any> = {
            id: userId,
            sk: `PAYMENT#${paymentId}`,
            cardData: cardData,
            created_at: Date.now(),
            updated_at: Date.now(),
        };

        console.log('DEBUG: Payment Record:', JSON.stringify(paymentRecord));

        try {
            const itemsToTransact = [
                { tableName: 'v2CustomerTable', item: paymentRecord },
            ];

            console.log('DEBUG: Attempting to save payment record...');

            const transactionResult = await transactWriteItems({ puts: itemsToTransact });

            if (!transactionResult.success || !transactionResult.res) {
                console.log('Failed to save payment record');
                return processError(100003);
            }

            console.log('DEBUG: Payment save successful.');
            return response({
                statusCode: 200,
                headers: null,
                bodyObject: {
                    success: true,
                    res: {
                        paymentId: paymentId
                    }
                }
            });

        } catch (err) {
            console.error('FATAL ERROR: Payment save error:', err);
            return processError(100002, 'Failed to save payment');
        }
    }
}