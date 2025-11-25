import { Context } from 'aws-lambda'
import { getRecord, updateItem } from '../../../../utils/db'
import { sendToQueue } from '../../../../utils/sqs'

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
    // const vAccountId = body.accountId;
    // const amountToAdd = parseFloat(body.amount);
    // const txId = body.txId; // Using txId for better error context

    // console.log(`--- Processing Incoming TX [${txId}] for Account [${vAccountId}] ---`);
    // console.log('Incoming Payload:', body);
    // console.log(`Amount to Add: ${amountToAdd.toFixed(2)} ${body.currency}`);

    // const BALANCE_TABLE_NAME = 'v1AccountBalanceTable';

    // try {
    //     console.log(`DB_READ: Fetching current balance for ${vAccountId} from ${BALANCE_TABLE_NAME}...`);
    //     const currentBalanceResult = await getRecord(BALANCE_TABLE_NAME, vAccountId);

    //     if (!currentBalanceResult.success || !currentBalanceResult.res) {
    //         console.error(`DB_ERROR: Balance record not found for vAccountId: ${vAccountId}. Cannot update balance. Read result:`, currentBalanceResult);
    //         // Optionally throw here if absence of record is unexpected and critical
    //         return;
    //     }

    //     console.log('DB_READ_SUCCESS: Retrieved record:', currentBalanceResult.res);

    //     const currentBalance = parseFloat(currentBalanceResult.res.balance || '0');
    //     const newBalance = currentBalance + amountToAdd;

    //     console.log(`BALANCE_CALC: Current ${currentBalance.toFixed(2)} + Incoming ${amountToAdd.toFixed(2)} = New ${newBalance.toFixed(2)}`);

    //     // Prepare and log update parameters
    //     const updateParams = {
    //         tableName: BALANCE_TABLE_NAME,
    //         key: { id: vAccountId },
    //         updateExpression: 'SET #balance = :newBalance, #lastUpdated = :now',
    //         attributeNames: {
    //             '#balance': 'balance',
    //             '#lastUpdated': 'lastUpdated',
    //         },
    //         attributeValues: {
    //             ':newBalance': newBalance,
    //             ':now': new Date().toISOString(),
    //         },
    //     };

    //     console.log('DB_WRITE: Preparing to update balance with parameters:', updateParams);

    //     const updateResult = await updateItem(updateParams);

    //     if (updateResult.success) {
    //         console.log(`TX_SUCCESS: Balance for ${vAccountId} successfully updated to ${newBalance.toFixed(2)} ${body.currency}. TX: ${txId}`);
    //     } else {
    //         console.error(`DB_ERROR: Failed to update balance document for ${vAccountId} and TX ${txId}. Update result:`, updateResult);
    //     }

    // } catch (e) {
    //     // Logging the full error object 'e' provides the most detail
    //     console.error(`CRITICAL_ERROR: Failed to process balance update for TX ${txId} (Account ${vAccountId}). Exception caught:`, e);
    // }

    // console.log(`--- Finished Processing TX [${txId}] ---`);

    try {
        console.log('Received webhook request:', JSON.stringify(body))
        // Send message to SQS queue
        const result = await sendToQueue("https://sqs.us-east-2.amazonaws.com/129364817855/v1-webhook-queue", body)

        result.success ? console.log(`Successfully queued transaction ${body} for processing`) : console.error('Failed to queue transaction:', result.e)
    } catch (e) {
        console.error('Error processing incoming blockchain transaction webhook:', e)
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