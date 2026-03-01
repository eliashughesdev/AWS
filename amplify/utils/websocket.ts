import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import { queryItemFromIndex, deleteItem } from './db'

interface WebSocketMessage {
  type: string
  data: any
}

/**
 * Sends a message to a WebSocket connection
 */
export const sendWebSocketMessage = async (
  apiEndpoint: string,
  connectionId: string,
  message: WebSocketMessage
): Promise<{ success: boolean; error?: any }> => {
  try {
    const client = new ApiGatewayManagementApiClient({
      endpoint: apiEndpoint,
      region: process.env.AWS_REGION || 'us-east-2',
    })

    await client.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(message)),
    }))

    console.log(`Message sent to connection ${connectionId}:`, message)
    return { success: true }
  } catch (error: any) {
    console.error(`Failed to send message to connection ${connectionId}:`, error)

    // If connection is gone (410), we should clean it up
    if (error.statusCode === 410) {
      console.log(`Connection ${connectionId} is stale, will be cleaned up`)
    }

    return { success: false, error }
  }
}

/**
 * Removes a WebSocket connection from the table
 */
export const removeConnection = async (
  tableName: string,
  connectionId: string
): Promise<{ success: boolean }> => {
  try {
    const result = await deleteItem(tableName, { connectionId })

    if (!result.success) {
      throw new Error('Failed to delete connection from database')
    }

    console.log(`Connection ${connectionId} removed from table`)
    return { success: true }
  } catch (error) {
    console.error(`Failed to remove connection ${connectionId}:`, error)
    return { success: false }
  }
}

/**
 * Notifies a user about payment processing result via WebSocket
 * @param transactionId - The transaction ID used by frontend to connect WebSocket (for lookup)
 * @param userId - The user ID
 * @param result - The payment result to send
 * @param paymentId - Optional payment method ID to include in the response
 */
export const notifyPaymentResult = async (
  transactionId: string,
  userId: string,
  result: {
    success: boolean
    status?: string
    error?: string
    paymentTransactionId?: string
    authenticationUrl?: string
    paymentIntentId?: string
    clientSecret?: string
  },
  paymentId?: string
): Promise<{ success: boolean }> => {
  try {
    const tableName = process.env.CONNECTIONS_TABLE_NAME
    if (!tableName) {
      console.error('CONNECTIONS_TABLE_NAME environment variable not set')
      return { success: false }
    }

    // Query connections by userId
    const queryResult = await queryItemFromIndex({
      tableName,
      indexName: 'UserIdIndex',
      keyConditionExpression: 'userId = :userId',
      attributeNames: undefined,
      attributeValues: {
        ':userId': userId,
      },
    })

    if (!queryResult.success || !queryResult.res || queryResult.res.length === 0) {
      console.log(`No active WebSocket connections found for user ${userId}`)
      console.log('DEBUG: Query result:', JSON.stringify(queryResult))
      return { success: false }
    }

    console.log(`DEBUG: Found ${queryResult.res.length} connections for user ${userId}`)
    console.log(`DEBUG: Looking for transactionId: "${transactionId}" (type: ${typeof transactionId})`)
    console.log('DEBUG: Connections found:', JSON.stringify(queryResult.res.map((c: any) => ({
      connectionId: c.connectionId,
      paymentId: c.paymentId,
      paymentIdType: typeof c.paymentId,
      userId: c.userId
    }))))

    // Filter connections for this specific transaction
    // WebSocket connections are stored with paymentId field, which holds the transactionId from frontend
    const connections = queryResult.res.filter((conn: any) => conn.paymentId === transactionId)

    if (connections.length === 0) {
      console.log(`No WebSocket connections found for transactionId ${transactionId}`)
      console.log(`DEBUG: Available paymentIds in connections: ${queryResult.res.map((c: any) => c.paymentId).join(', ')}`)
      return { success: false }
    }

    // Extract WebSocket API endpoint from environment or construct it
    // The WebSocket API endpoint needs to be passed via environment variable
    const wsApiId = process.env.WEBSOCKET_API_ID
    const region = process.env.AWS_REGION || 'us-east-2'
    const stage = process.env.WEBSOCKET_STAGE || 'v1'

    if (!wsApiId) {
      console.error('WEBSOCKET_API_ID environment variable not set')
      return { success: false }
    }

    const apiEndpoint = `https://${wsApiId}.execute-api.${region}.amazonaws.com/${stage}`

    // Send message to all matching connections
    let sentCount = 0
    for (const connection of connections) {
      const sendResult = await sendWebSocketMessage(
        apiEndpoint,
        connection.connectionId,
        {
          type: 'PAYMENT_RESULT',
          data: {
            transactionId,
            paymentId: paymentId || transactionId,
            userId,
            timestamp: new Date().toISOString(),
            ...result,
          },
        }
      )

      if (sendResult.success) {
        sentCount++
        // Clean up the connection after sending the message
        await removeConnection(tableName, connection.connectionId)
      } else if (sendResult.error?.statusCode === 410) {
        // Connection is stale, clean it up
        await removeConnection(tableName, connection.connectionId)
      }
    }

    console.log(`Payment result notification sent to ${sentCount}/${connections.length} connections`)
    return { success: sentCount > 0 }
  } catch (error) {
    console.error('Error notifying payment result:', error)
    return { success: false }
  }
}
