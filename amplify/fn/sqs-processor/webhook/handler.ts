import { handleBalanceUpdate } from "./balanceUpdateHandler"

// const headers = {
// 	'Content-Type': 'application/json',
// }

// const sendRequest = async (url: string, body: any) => new Promise(resolve => {
// 	fetch(url, { method: 'post', body: JSON.stringify(body), headers })
// 		.then(res => {
// 			console.log(res)
// 			resolve({ success: true, res })
// 		})
// 		.catch(e => {
// 			console.log(e)
// 			resolve({ success: false, e })
// 			// todo catch logic
// 		})
// })

type QueueHandler = (body: any) => Promise<boolean>;

const queueHandlers: Record<string, QueueHandler> = {
  'v1-webhook-queue': handleBalanceUpdate,
};

const routeMessage = async (recordBody: string) => {
	try {
		const body = JSON.parse(recordBody);
		const queueName = body.queue;

		if (!queueName) {
			console.warn('ROUTER: No queue name specified in message body. Message:', recordBody);
			return;
		}

		console.log(`ROUTER: Processing message for queue: ${queueName}`);

		const handler = queueHandlers[queueName];

		if (handler) {
			await handler(body);
		} else {
			console.warn(`ROUTER: No handler registered for queue: ${queueName}. Available queues: ${Object.keys(queueHandlers).join(', ')}`);
		}
	} catch (e) {
		console.error('ROUTER_ERROR: Failed to parse or route message:', e);
		console.error('Raw message body:', recordBody);
	}
}

export const handler = async (event: any) => {
	console.log('sqs webhook handler: ', JSON.stringify(event))
	for (const record of event.Records) {
		// todo delete message from queue
		const body = JSON.parse(record.body)
		console.log(`Received body is ${JSON.stringify(body)}`);
		// delete body.webhook_url
		// await sendRequest(url, { ...body })
		await routeMessage(record.body);
	}
}