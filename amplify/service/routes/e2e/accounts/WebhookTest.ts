import crypto from 'crypto'
import { customer } from '../credentials'

const path = '/v1/webhook'
console.log('path: ', path)

const body = JSON.stringify({
    accountId: "6920e38e435cca6970f70798",
    subscriptionId: "6920e5ae8afce1c974a6bd81",
    subscriptionType: "ACCOUNT_INCOMING_BLOCKCHAIN_TRANSACTION",
    amount: "2000",
    reference: "39210c02-71c1-4b39-91da-6412e0dac52d",
    currency: "TRON",
    txId: "6c605b3eb96362d05acc6bc69da886acfc0b9f6bd442f7eb456a1b274a9b2502",
    blockHeight: 59920701,
    blockHash: "000000000392513df825b2239ed1f85f4782b3e3da68dbfc5bbe4feab61dab6d",
    from: "TVF2Mp9QY7FEGTnr3DBpFLobA6jguHyMvi",
    to: "TTj4WfY4SEug1A6fc3HCKrUvXeeiMVrMKU",
    date: 1763764542139,
    index: null
});

const bodyHash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex')
console.log('bodyHash', bodyHash)

const timestamp = Date.now()
console.log('timestamp', timestamp)

console.log('stringToSign: ', `${path}${timestamp}${bodyHash}`)

// create signature
const signature = crypto
    .createHmac('sha256', Buffer.from(customer.key, 'hex'))
    .update(`${path}${timestamp}${bodyHash}`)
    .digest('base64')
console.log('signature: ', signature)

const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Project': 'e2e-hmac',
    'Authorization': `Signature ${timestamp}:${bodyHash}:${signature}`
}

const url = 'https://siao2sha29.execute-api.us-east-2.amazonaws.com/v1/webhook?type=accountTransactions'
fetch(url, { method: 'POST', body, headers })
    .then(res => res.json())
    .then(data => { console.log(data) })
    .catch(err => console.log(err))

// {
//   success: true,
//   res: { data: { id: '0198d8c8-6144-73ef-97b0-5eb24ec125f2' } }
// }