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
    queue?: string

}

const handleIncomingTransaction = async (body: IncomingBlockchainTransactionRequest) => {
    try {
        console.log('Received webhook request:', JSON.stringify(body))
        // Send message to SQS queue
        const SQS_QUEUE_URL = process.env.WEBHOOK_QUEUE_URL || "https://sqs.us-east-2.amazonaws.com/129364817855/v1-webhook-queue"
        console.log('webhook queue url: ', SQS_QUEUE_URL)
        console.log('trying to write to the queue')
        body.queue = "v1-webhook-queue"
        const result = await sendToQueue(SQS_QUEUE_URL, body)
        result.success ? console.log(`Successfully queued transaction ${body} for processing`) : console.error('Failed to queue transaction:', result.e)
    } catch (e) {
        console.error('Error processing incoming blockchain transaction webhook:', e)
    }
}

export const accountTransactions = async (event: any, context: Context) => {
    const body: IncomingBlockchainTransactionRequest = event.body
    try {
        await handleIncomingTransaction(body)

    } catch (e) {
        console.error('Error processing incoming blockchain transaction webhook:', e);
        return;
    }
    // documented this out becaue according to Tatum docs, the webhook request does not include a status field
    // return statuses[event.body.data.status](event.body)
}