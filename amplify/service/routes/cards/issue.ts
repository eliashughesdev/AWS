import type { Context } from 'aws-lambda'
import crypto from 'crypto'
import { response } from '../../../utils/http'
import { processError } from '../../../errors/http'
import { queryRecord, putItem, updateItem } from '../../../utils/db'
import { EcapzProvider } from '../../../providers/card/EcapzProvider'

type Event = {
  body: {
    first_name: string
    last_name: string
    email: string
    phone_number: string
    card_name: string
  }
  requestContext: { authorizer?: { userId?: string } }
}

export default class CardsIssueHandler {
  async execute(event: Event, context: Context) {
    const userId = event.requestContext?.authorizer?.userId

    if (!userId) {
      return response({
        statusCode: 401,
        headers: null,
        bodyObject: { message: 'User ID not found in authorization context' }
      })
    }

    const companyId = process.env.ECAPZ_COMPANY_ID
    if (!companyId) {
      console.error('ERROR (CardsIssueHandler): ECAPZ_COMPANY_ID is not configured')
      return processError(200002)
    }

    // Resume from a prior partial attempt if one exists — Card Bridge has no
    // idempotency keys of its own, so retrying without this would create a
    // duplicate owner/account on Card Bridge's side.
    const existing = await queryRecord(
      'v2CustomerTable',
      'id = :id AND begins_with(sk, :prefix)',
      { ':id': userId, ':prefix': 'ACCOUNT#' }
    )
    const existingItem = (existing.res ?? []).find((item: any) => item.provider === 'ecapz')

    const sk = existingItem?.sk ?? `ACCOUNT#ecapz${crypto.randomUUID().replaceAll('-', '')}`

    if (!existingItem) {
      const seedResult = await putItem('v2CustomerTable', {
        id: userId,
        sk,
        provider: 'ecapz',
        accountNo: sk.replace('ACCOUNT#', ''),
        ecapzCompanyId: companyId,
        status: 'pending',
        created_at: Date.now(),
      })
      if (!seedResult.success) {
        console.error('ERROR (CardsIssueHandler): failed to seed ecapz account record', seedResult.error)
        return processError(200001)
      }
    }

    const onStep = async (step: 'owner' | 'account' | 'card', id: string) => {
      const field = step === 'owner' ? 'ecapzOwnerId' : step === 'account' ? 'ecapzAccountId' : 'ecapzCardId'
      await updateItem({
        tableName: 'v2CustomerTable',
        key: { id: userId, sk },
        updateExpression: 'SET #f = :v, updated_at = :u',
        attributeNames: { '#f': field },
        attributeValues: { ':v': id, ':u': Date.now() },
      })
    }

    try {
      const provider = new EcapzProvider()
      const result = await provider.issueCard({
        ownerId: existingItem?.ecapzOwnerId,
        accountId: existingItem?.ecapzAccountId,
        companyId,
        profile: {
          firstName: event.body.first_name,
          lastName: event.body.last_name,
          email: event.body.email,
          phoneNumber: event.body.phone_number,
        },
        cardName: event.body.card_name,
        onStep,
      })

      await updateItem({
        tableName: 'v2CustomerTable',
        key: { id: userId, sk },
        updateExpression: 'SET #s = :s, updated_at = :u',
        attributeNames: { '#s': 'status' },
        attributeValues: { ':s': 'active', ':u': Date.now() },
      })

      return response({
        statusCode: 200,
        headers: null,
        bodyObject: { success: true, res: { data: result.card } }
      })
    } catch (error) {
      console.error('ERROR (CardsIssueHandler): card issuance failed.', error)
      return processError(200001)
    }
  }
}
