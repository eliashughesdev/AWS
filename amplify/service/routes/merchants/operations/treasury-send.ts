import type { Context } from 'aws-lambda'
import { randomBytes } from 'crypto'

import { response } from '../../../../utils/http'
import { processError } from '../../../../errors/http'
import { putItem, queryRecord } from '../../../../utils/db'
import { isNativeCurrency, networkFor } from '../../../../utils/currencies'
import { getMember, getMembership, getMerchant, listMembers } from '../../../../utils/merchant'
import { getMasterAccount } from '../../../../utils/masterAccount'
import { isValidTronAddress } from '../../../../providers/ledger/tatum/chains/tron'
import { ProviderRegistry } from '../../../../utils/AccountProvider'
import { ProviderName } from '../../../../providers/ledger/ProviderName'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: { currency: string, amount: number, destinationAddress: string }
}

const TABLE = 'v1MerchantTable'
const DAY_MS = 24 * 60 * 60 * 1000
const REQUEST_TTL_MS = 2 * DAY_MS
// Every send that has or may still move money counts toward the rolling threshold
const COUNTED_STATUSES = ['PENDING', 'APPROVED', 'EXECUTING', 'COMPLETED', 'UNCERTAIN']

/**
 * Asks to send a merchant's collected fees to an external address. Only
 * records the request: it executes once enough of the merchant's approvers
 * agree. The merchant comes from the caller's membership, never the body. If
 * this send plus the last 24h of sends in the currency reaches the policy
 * threshold, every approver except the initiator must approve; otherwise one.
 * The approver list and required count are fixed now, so later team changes
 * don't alter a request in flight.
 */
export default class CreateTreasurySendHandler {
  async execute(event: Event, context: Context) {
    const userId = event.requestContext?.authorizer?.userId ?? ''

    const membership = await getMembership(userId)
    if (!membership.success) return processError(100003)
    if (!membership.res) return processError(100042)
    const merchantId: string = membership.res.merchantId

    const member = await getMember(merchantId, userId)
    if (!member.success) return processError(100003)
    if (member.res?.status !== 'active') return processError(100042)
    if (!member.res.roles?.includes('initiator')) return processError(100043)

    const merchant = await getMerchant(merchantId)
    if (!merchant.success) return processError(100003)
    if (merchant.res?.status !== 'active') return processError(100040)

    // The body's shape was checked against schemas/merchants/operations/treasury-send.json;
    // what the values mean is checked here
    const currency = event.body.currency.toUpperCase()
    const { amount, destinationAddress } = event.body
    if (!networkFor(currency) || isNativeCurrency(currency)) return processError(100045)
    if (!isValidTronAddress(destinationAddress)) return processError(100048)

    const policy = await queryRecord(TABLE, 'id = :id AND sk = :sk', { ':id': merchantId, ':sk': 'POLICY#TREASURY_SEND' })
    if (!policy.success) return processError(100003)
    const threshold = Number(policy.res?.[0]?.thresholds?.[currency])
    if (!threshold) return processError(100044)

    const [master, feeVaRow] = await Promise.all([
      getMasterAccount(merchantId, currency),
      queryRecord(TABLE, 'id = :id AND sk = :sk', { ':id': merchantId, ':sk': `FEEVA#${currency}` }),
    ])
    const feeVaId: string | undefined = feeVaRow.res?.[0]?.vAccountId
    if (!master || !feeVaId) return processError(100045)

    try {
      const { availableBalance } = await ProviderRegistry.getProvider(ProviderName.Tatum).getVaBalance(feeVaId)
      if (availableBalance < amount) return processError(100046)
    } catch (err) {
      console.error(`TREASURY_SEND: could not read fee VA ${feeVaId} balance`, err)
      return processError(100003)
    }

    const members = await listMembers(merchantId)
    if (!members.success) return processError(100003)
    const approvers: string[] = members.res
      .filter(m => m.status === 'active' && m.roles?.includes('approver') && m.userId !== userId)
      .map(m => m.userId)
    if (!approvers.length) return processError(100047)

    const now = Date.now()
    const recent = await queryRecord(TABLE, 'id = :id AND sk BETWEEN :from AND :to', {
      ':id': merchantId,
      ':from': `REQ#req_${now - DAY_MS}`,
      ':to': `REQ#req_${now}~`,
    })
    if (!recent.success) return processError(100003)
    const recentTotal = (recent.res ?? [])
      .filter(r => r.currency === currency && COUNTED_STATUSES.includes(r.status))
      .reduce((sum, r) => sum + Number(r.amount), 0)
    const requiredCount = recentTotal + amount >= threshold ? approvers.length : 1

    // Starts with the epoch-ms timestamp, so REQ# rows sort by creation time
    const requestId = `req_${now}_${randomBytes(6).toString('hex')}`
    const expiresAt = new Date(now + REQUEST_TTL_MS).toISOString()
    const saved = await putItem(TABLE, {
      id: merchantId,
      sk: `REQ#${requestId}`,
      requestId,
      merchantId,
      type: 'TREASURY_SEND',
      currency,
      amount,
      destinationAddress,
      initiatorId: userId,
      approvers,
      requiredCount,
      votes: {},
      approvalCount: 0,
      status: 'PENDING',
      expiresAt,
      createdAt: new Date(now).toISOString(),
    }, 'attribute_not_exists(sk)')
    if (!saved.success) return processError(100003)

    console.log(`TREASURY_SEND: ${requestId} by ${userId} for ${merchantId}: ${amount} ${currency} -> ${destinationAddress}, needs ${requiredCount}/${approvers.length} (24h total ${recentTotal + amount}, threshold ${threshold})`)

    return response({
      statusCode: 201,
      headers: null,
      bodyObject: { success: true, requestId, status: 'PENDING', requiredCount, approvers: approvers.length, expiresAt },
    })
  }
}
