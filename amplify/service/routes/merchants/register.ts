import type { Context } from 'aws-lambda'
import { randomBytes } from 'crypto'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { transactWriteItems } from '../../../utils/db'
import { networkFor } from '../../../utils/currencies'
import { provisionMerchantMaster } from '../../../utils/merchantMaster'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: { name: string, currencies?: string[], accountingCurrency?: string }
}

// Provisioning must finish well inside the Lambda timeout: a timed-out
// response would lose the API key, which is only ever returned here.
const PROVISIONING_BUDGET_MS = 20_000

/**
 * Registers a merchant and creates its API key. The merchant id doubles as the
 * key's X-Project, so every signed request identifies its merchant. The
 * secret is only returned here — it can't be retrieved again.
 *
 * Optionally provisions the requested currencies (master + fee VA each). One
 * that fails or runs out of time doesn't fail the registration; retry it with
 * /merchants/masters/provision, which resumes where it stopped.
 */
export default class MerchantRegisterHandler {
  async execute(event: Event, context: Context) {
    const staffUserId = event.requestContext?.authorizer?.userId
    const name = typeof event.body.name === 'string' ? event.body.name.trim() : ''
    if (!name) return processError(100031, 'name')

    const currencies = event.body.currencies ?? []
    if (!Array.isArray(currencies) || currencies.some(c => !networkFor(c))) return processError(100031, 'currencies')
    const accountingCurrency = event.body.accountingCurrency?.trim() || 'USD'

    const merchantId = `mrc_${randomBytes(8).toString('hex')}`
    const apiKey = randomBytes(32).toString('hex')
    const now = new Date().toISOString()

    const written = await transactWriteItems({
      puts: [
        {
          tableName: 'v1MerchantTable',
          item: { id: merchantId, sk: 'PROFILE', name, status: 'active', accountingCurrency, createdBy: staffUserId, createdAt: now },
          conditionExpression: 'attribute_not_exists(id)',
        },
        {
          tableName: 'v1UserKeysTable',
          item: { id: merchantId, type: 'hmac', key: apiKey, createdAt: now },
          conditionExpression: 'attribute_not_exists(id)',
        },
      ],
    })
    if (!written.success) return processError(100003)

    console.log(`MERCHANT_REGISTER: merchantId=${merchantId} by=${staffUserId}`)

    const provisioned = await this.provision(merchantId, [...new Set(currencies)], accountingCurrency)

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { success: true, merchantId, apiKey, currencies: provisioned },
    })
  }

  private async provision(merchantId: string, currencies: string[], accountingCurrency: string) {
    const outOfTime = new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), PROVISIONING_BUDGET_MS))
    const results = await Promise.all(currencies.map(currency => Promise.race([
      provisionMerchantMaster(merchantId, currency, accountingCurrency)
        .then(master => ({ status: 'ready', depositAddress: master.depositAddress }))
        .catch(err => {
          console.error(`MERCHANT_REGISTER: provisioning ${currency} for ${merchantId} failed`, err)
          return { status: 'failed' }
        }),
      outOfTime.then(status => ({ status })),
    ])))
    return Object.fromEntries(currencies.map((currency, i) => [currency, results[i]]))
  }
}
