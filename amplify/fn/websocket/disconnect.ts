import { deleteItem } from '../../utils/db'

export const handler = async (event: any) => {
  console.log('WebSocket disconnect:', event.requestContext?.connectionId)

  const connectionId = event.requestContext.connectionId

  try {
    const result = await deleteItem(process.env.CONNECTIONS_TABLE_NAME, {
      connectionId,
    })

    if (!result.success) {
      throw new Error('Failed to delete connection from database')
    }

    console.log(`Connection ${connectionId} removed`)

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Disconnected successfully' }),
    }
  } catch (error) {
    console.error('Error removing connection:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to disconnect' }),
    }
  }
}
