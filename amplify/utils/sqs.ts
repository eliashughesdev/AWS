import { SQSClient, SendMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs'

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-2' })

export const sendToQueue = async (queueUrl: string, message: object) => {
  try {
    const result = await sqsClient.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message)
    }))

    console.log('Message sent to queue:', result.MessageId)
    return { success: true, res: result }
  } catch (error) {
    console.error('Error sending message to queue:', error)
    return { success: false, e: error }
  }
}

// Resolves a queue's URL from its name at runtime — avoids a cross-stack CDK
// reference (which creates a circular dependency) and a hardcoded account-id URL.
export const getQueueUrl = async (queueName: string): Promise<string | null> => {
  try {
    const res = await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }))
    return res.QueueUrl ?? null
  } catch (error) {
    console.error(`Error resolving queue URL for ${queueName}:`, error)
    return null
  }
}
