import { putItem } from '../../utils/db';

export const handler = async (event: any) => {
    console.log('WebSocket Connect Event:', JSON.stringify(event));

    const connectionId = event.requestContext.connectionId;
    const queryParams = event.queryStringParameters || {};
    const userId = queryParams.userId;
    const paymentId = queryParams.paymentId;

    if (!userId || !paymentId) {
        console.error('Missing userId or paymentId in connection');
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'userId and paymentId are required' }),
        };
    }

    try {
        // Store connection in DynamoDB with TTL of 1 hour
        const ttl = Math.floor(Date.now() / 1000) + 3600;

        const result = await putItem(process.env.CONNECTIONS_TABLE_NAME, {
            connectionId,
            userId,
            paymentId,
            ttl,
            connectedAt: new Date().toISOString(),
        });

        if (!result.success) {
            throw new Error('Failed to store connection in database');
        }

        console.log(`Connection ${connectionId} stored for user ${userId}, payment ${paymentId}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Connected successfully' }),
        };
    } catch (error) {
        console.error('Error storing connection:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to connect' }),
        };
    }
};
