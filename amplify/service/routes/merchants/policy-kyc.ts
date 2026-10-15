import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { updateItem } from '../../../utils/db'
import { getMerchant } from '../../../utils/merchant'
import { KYC_OPERATIONS, KYC_POLICY_SK, kycSwitchesFor, readKycPolicy, switchAttribute } from '../../../utils/kycPolicy'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: { merchantId: string, currency: string, withdraw?: boolean, transfer?: boolean, cardDeposit?: boolean }
}

/**
 * Switches KYC on or off for a merchant's withdrawals, transfers and card deposits in one
 * currency (staff only; docs/public-api-plan.md D11). Only the switches sent change, each its own
 * attribute, so two staff changing different ones do not overwrite each other. Answers the
 * currency's switches as they now stand, unset ones as required.
 */
export default class SetKycPolicyHandler {
  async execute(event: Event, context: Context) {
    const staffUserId = event.requestContext?.authorizer?.userId
    // The body was checked against schemas/merchants/policy/kyc.json
    const { merchantId, currency } = event.body

    const merchant = await getMerchant(merchantId)
    if (!merchant.success) return processError(100003)
    if (!merchant.res) return processError(100040)

    const changes = KYC_OPERATIONS.filter(op => typeof event.body[op] === 'boolean')
    const names = Object.fromEntries(changes.map((op, i) => [`#s${i}`, switchAttribute(currency, op)]))
    const values = Object.fromEntries(changes.map((op, i) => [`:s${i}`, event.body[op]]))

    const saved = await updateItem({
      tableName: 'v1MerchantTable',
      key: { id: merchantId, sk: KYC_POLICY_SK },
      updateExpression: `SET ${Object.keys(names).map((name, i) => `${name} = :s${i}`).join(', ')}, updatedAt = :now, updatedBy = :by`,
      attributeNames: names,
      attributeValues: { ...values, ':now': new Date().toISOString(), ':by': staffUserId ?? null },
    })
    if (!saved.success) return processError(100003)

    const changed = Object.fromEntries(changes.map(op => [op, event.body[op]]))
    console.log(`KYC_POLICY: ${merchantId} ${currency} ${JSON.stringify(changed)} by ${staffUserId}`)

    // Read back rather than merged here, so the answer is what a money route will now see
    let row
    try {
      row = await readKycPolicy(merchantId)
    } catch {
      return response({ statusCode: 200, headers: null, bodyObject: { success: true, merchantId, currency } })
    }
    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { success: true, merchantId, currency, kycRequired: kycSwitchesFor(row, currency) },
    })
  }
}
