import { handleBalanceUpdate } from './balanceUpdateHandler'
import { handlePayment } from './paymentHandler'
import { handleWithdrawal } from './withdrawalHandler'
import { handleAccountBackfill } from './accountBackfillHandler'
import { handleSweep } from './sweepHandler'
import { loadConfig } from '../../../utils/config'

// const headers = {
//  'Content-Type': 'application/json',
// }

// const sendRequest = async (url: string, body: any) => new Promise(resolve => {
// fetch(url, { method: 'post', body: JSON.stringify(body), headers })
//    .then(res => {
//      console.log(res)
//      resolve({ success: true, res })
//    })
//    .catch(e => {
//      console.log(e)
//      resolve({ success: false, e })
//      // todo catch logic
//    })
// })

type QueueHandler = (body: any) => Promise<boolean>

const queueHandlers: Record<string, QueueHandler> = {
  'v1-webhook-queue': handleBalanceUpdate,
  'v1-payment-processing-queue': handlePayment,
  'v1-withdrawal-processing-queue': handleWithdrawal,
  'v1-account-backfill-queue': handleAccountBackfill,
  'v1-sweep-queue': handleSweep
}

// The queue a record was delivered from. Routing uses this, not the `queue`
// field in the body, which is whatever the sender wrote.
const sourceQueue = (record: any): string => String(record.eventSourceARN ?? '').split(':').pop() ?? ''

const routeMessage = async (record: any) => {
  try {
    const queueName = sourceQueue(record)
    const handler = queueHandlers[queueName]

    if (!handler) {
      console.warn(`ROUTER: No handler registered for queue: ${queueName}. Available queues: ${Object.keys(queueHandlers).join(', ')}`)
      return
    }

    const body = JSON.parse(record.body)

    if (body.queue && body.queue !== queueName) {
      console.error(`ROUTER: Rejected a message from ${queueName} that names ${body.queue}`)
      return
    }

    console.log(`ROUTER: Processing message for queue: ${queueName}`)
    await handler(body)
  } catch (e) {
    console.error('ROUTER_ERROR: Failed to parse or route message:', e)
    console.error('Raw message body:', record.body)
  }
}

export const handler = async (event: any) => {
  await loadConfig()
  console.log('sqs webhook handler: ', JSON.stringify(event))
  for (const record of event.Records) {
    // todo delete message from queue
    const body = JSON.parse(record.body)
    console.log(`Received body is ${JSON.stringify(body)}`)
    // delete body.webhook_url
    // await sendRequest(url, { ...body })
    await routeMessage(record)
  }
}
