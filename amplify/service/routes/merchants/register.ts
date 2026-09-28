import type { Context } from 'aws-lambda'
import { randomBytes } from 'crypto'

import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { transactWriteItems } from '../../../utils/db'

type Event = {
  requestContext?: { authorizer?: { userId?: string } }
  body: { name: string }
}

/**
 * Registers a merchant and mints its API key. The merchant id doubles as the
 * key's X-Project, so every signed request identifies its merchant. The
 * secret is only returned here — it can't be retrieved again.
 */
export default class MerchantRegisterHandler {
  async execute(event: Event, context: Context) {
    const staffUserId = event.requestContext?.authorizer?.userId
    const name = typeof event.body.name === 'string' ? event.body.name.trim() : ''
    if (!name) return processError(100031, 'name')

    const merchantId = `mrc_${randomBytes(8).toString('hex')}`
    const apiKey = randomBytes(32).toString('hex')
    const now = new Date().toISOString()

    const written = await transactWriteItems({
      puts: [
        {
          tableName: 'v1MerchantTable',
          item: { id: merchantId, sk: 'PROFILE', name, status: 'active', createdBy: staffUserId, createdAt: now },
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

    return response({
      statusCode: 200,
      headers: null,
      bodyObject: { success: true, merchantId, apiKey },
    })
  }
}
