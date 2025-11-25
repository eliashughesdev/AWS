const headers = {
	'Content-Type': 'application/json',
}

const sendRequest = async (url: string, body: any) => new Promise(resolve => {
	fetch(url, { method: 'post', body: JSON.stringify(body), headers })
		.then(res => {
			console.log(res)
			resolve({ success: true, res })
		})
		.catch(e => {
			console.log(e)
			resolve({ success: false, e })
			// todo catch logic
		})
})

export const handler = async (event: any) => {
	console.log('sqs webhook handler: ', JSON.stringify(event))
	for (const record of event.Records) {
		// todo delete message from queue
		const body = JSON.parse(record.body)
		 console.log(`Received body is ${JSON.stringify(body)}`);
		delete body.webhook_url
		await sendRequest(url, { ...body })
	}
}