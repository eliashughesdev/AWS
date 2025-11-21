import { Context } from 'aws-lambda'
import { getRecord, updateItem } from '../../../../utils/db'

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

const handleIncomingTransaction = async (body: IncomingBlockchainTransactionRequest) => {
	const vAccountId = body.accountId;
	const amountToAdd = parseFloat(body.amount);

	console.log('--- Incoming Blockchain Transaction Event Received ---');
	console.log(body)
	console.log('----------------------------------------------------');

	const BALANCE_TABLE_NAME = 'v1AccountBalanceTable';
	try {
		const currentBalanceResult = await getRecord(BALANCE_TABLE_NAME, vAccountId);

		if (!currentBalanceResult.success || !currentBalanceResult.res) {
			console.error(`DB_ERROR: Balance record not found for vAccountId: ${vAccountId}. Cannot update balance.`);
			return;
		}

		const currentBalance = parseFloat(currentBalanceResult.res.balance || '0');
		const newBalance = currentBalance + amountToAdd;

		console.log(`Balance Calculation: Current ${currentBalance.toFixed(2)} + Incoming ${amountToAdd.toFixed(2)} = New ${newBalance.toFixed(2)}`);

		const updateResult = await updateItem({
			tableName: BALANCE_TABLE_NAME,
			key: { id: vAccountId },

			updateExpression: 'SET #balance = :newBalance, #lastUpdated = :now',

			attributeNames: {
				'#balance': 'balance',
				'#lastUpdated': 'lastUpdated',
			},

			attributeValues: {
				':newBalance': newBalance,
				':now': new Date().toISOString(),
			},
		});

		if (updateResult.success) {
			console.log(`SUCCESS: Balance for ${vAccountId} updated to ${newBalance.toFixed(2)} ${body.currency}`);
		} else {
			console.error('DB_ERROR: Failed to update balance document:', updateResult);
		}

	} catch (e) {
		console.error(`CRITICAL_ERROR: Failed to process balance update for TX ${body.txId}.`, e);
	}
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