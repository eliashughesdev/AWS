import { Context } from 'aws-lambda'

const statuses: any = {
	authorized: (body: any) => console.log('authorized. status logic'),
	canceled: (body: any) => console.log('canceled. status logic'),
	declined: (body: any) => console.log('declined. status logic'),
	completed: (body: any) => console.log('completed. status logic'),
}

interface IncomingBlockchainTransactionRequest {
	date: number
	amount: string
	currency: string
	subscriptionType: string
	accountId: string
	reference?: string // the reference of the transaction in the virtual account
	txId?: string
	blockHash?: string // the hash of the block, might not be present every time
	blockHeight: number
	from?: string  // might not be present every time; not present for UTXO-based blockchains
	to: string  // the blockchain address of the recipient
	index?: number  // for UTXO-based blockchains (BCH, BTC, DOGE, LTC), this is the index of the output in the transaction

}

const handleIncomingTransaction = (body: IncomingBlockchainTransactionRequest) => {
	console.log('✨ Incoming Blockchain Transaction Event Received');
	console.log(`Subscription Type: ${body.subscriptionType}`);
	console.log(`Virtual Account ID: ${body.accountId}`);
	console.log(`Amount: ${body.amount} ${body.currency}`);
	console.log(`Blockchain TX ID: ${body.txId || 'N/A'}`);
	console.log(`Timestamp: ${new Date(body.date).toISOString()}`);
}


export const accountTransactions = async (event: any, context: Context) => {
	const body: IncomingBlockchainTransactionRequest = event.body
	try {
		handleIncomingTransaction(body)

	} catch (e) {
		console.error('Error processing incoming blockchain transaction webhook:', e);
		return;
	}
	// documented this out becaue according to Tatum docs, the webhook request does not include a status field
	// return statuses[event.body.data.status](event.body)
}