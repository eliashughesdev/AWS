import type { Context } from 'aws-lambda'
import { randomBytes } from 'crypto'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { transactWriteItems } from '../../../utils/db'
import { NETWORKS } from '../../../utils/currencies'
import { provisionMerchantMaster } from '../../../utils/merchantMaster'
import { createSeed } from '../../../utils/hdSigner'

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
 *
 * Also creates the merchant's seeds, one per network, for its customers'
 * derived addresses. One that fails or runs out of time doesn't fail the
 * registration either; scripts/setup/create-merchant-seeds.sh finishes it.
 */
export default class MerchantRegisterHandler {
  async execute(event: Event, context: Context) {
    const staffUserId = event.requestContext?.authorizer?.userId
    // The body was checked against schemas/merchants/register.json
    const name = event.body.name.trim()
    const currencies = event.body.currencies ?? []
    const accountingCurrency = event.body.accountingCurrency ?? 'USD'

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

    const outOfTime = new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), PROVISIONING_BUDGET_MS))
    // Seeds first: a derived master needs its network's seed
    const seeds = await this.seeds(merchantId, outOfTime)
    const provisioned = await this.provision(merchantId, [...new Set(currencies)], accountingCurrency, outOfTime)

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { success: true, merchantId, apiKey, currencies: provisioned, seeds },
    })
  }

  // Every network, whatever currencies the merchant starts with
  private async seeds(merchantId: string, outOfTime: Promise<'pending'>) {
    const results = await Promise.all(NETWORKS.map(network => Promise.race([
      createSeed(merchantId, network)
        .then(() => 'ready')
        .catch(err => {
          console.error(`MERCHANT_REGISTER: ${network} seed for ${merchantId} failed: ${err.message}`)
          return 'failed'
        }),
      outOfTime,
    ])))
    return Object.fromEntries(NETWORKS.map((network, i) => [network, results[i]]))
  }

  private async provision(merchantId: string, currencies: string[], accountingCurrency: string, outOfTime: Promise<'pending'>) {
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
