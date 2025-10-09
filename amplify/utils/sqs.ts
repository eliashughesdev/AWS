import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

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
