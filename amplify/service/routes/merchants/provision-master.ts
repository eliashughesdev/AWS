import type { Context } from 'aws-lambda'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { getMerchant } from '../../../utils/merchant'
import { provisionMerchantMaster } from '../../../utils/merchantMaster'

type Event = {
  body: { merchantId: string, currency: string }
}

/**
 * Provisions a merchant's master for a currency (master + fee VA), or
 * finishes one whose provisioning was interrupted
 */
export default class ProvisionMerchantMasterHandler {
  async execute(event: Event, context: Context) {
    // The body was checked against schemas/merchants/masters/provision.json
    const { merchantId, currency } = event.body

    const merchant = await getMerchant(merchantId)
    if (!merchant.success) return processError(100003)
    if (merchant.res?.status !== 'active') return processError(100040)

    try {
      const master = await provisionMerchantMaster(merchantId, currency, merchant.res.accountingCurrency ?? 'USD')
      return response({
        statusCode: 200,
        headers: null,
        bodyObject: { success: true, merchantId, currency, status: 'ready', depositAddress: master.depositAddress },
      })
    } catch (err) {
      console.error(`MERCHANT_MASTER: provisioning ${currency} for ${merchantId} failed`, err)
      return processError(100041)
    }
  }
}
