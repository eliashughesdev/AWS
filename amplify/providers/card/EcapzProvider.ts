import axios from 'axios'
import * as crypto from 'crypto'

export interface EcapzOwnerProfile {
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
}

export interface EcapzCard {
  card_id: string
  masked_number: string
  status: string
  currency: string
  card_type: string
  [key: string]: any
}

export interface EcapzIssueCardParams {
  ownerId?: string
  accountId?: string
  companyId: string
  profile: EcapzOwnerProfile
  cardName: string
  onStep?: (step: 'owner' | 'account' | 'card', id: string) => Promise<void>
}

export interface EcapzIssueCardResult {
  ownerId: string
  accountId: string
  cardId: string
  card: EcapzCard
}

// Card Bridge's documented scheme hashes the body with SHA256, but Loudibly's own
// inbound authorizer (and every e2e test) uses MD5 for the identical header shape —
// unverified against a live ECAPZ call. Flip this if signed requests come back 403.
const BODY_HASH_ALGO = 'sha256'

export class EcapzProvider {
  private baseUrl()    { return process.env.ECAPZ_BASE_URL || 'https://api.cards.ecapz.com' }
  private projectId()  { return process.env.ECAPZ_PROJECT_ID }
  private hmacSecret() { return process.env.ECAPZ_HMAC_SECRET }
  private webhookUrl() { return process.env.ECAPZ_WEBHOOK_URL }

  private signHeaders(path: string, body: object): Record<string, string> {
    const bodyHash = crypto.createHash(BODY_HASH_ALGO).update(JSON.stringify(body)).digest('hex')
    const timestamp = Date.now()
    const signature = crypto
      .createHmac('sha256', Buffer.from(this.hmacSecret()!, 'hex'))
      .update(`${path}${timestamp}${bodyHash}`)
      .digest('base64')

    return {
      'Content-Type': 'application/json',
      'X-Project': this.projectId()!,
      'Authorization': `Signature ${timestamp}:${bodyHash}:${signature}`,
    }
  }

  private async _post<T = any>(path: string, body: object): Promise<T> {
    const url = `${this.baseUrl()}${path}`
    console.log(`DEBUG (EcapzProvider): POST ${path}`)
    console.log(`DEBUG (EcapzProvider): Payload: ${JSON.stringify(body)}`)

    try {
      const res = await axios.post(url, body, { headers: this.signHeaders(path, body) })
      console.log(`DEBUG (EcapzProvider): Response status: ${res.status}`)
      return res.data?.res?.data as T
    } catch (error) {
      console.error(`ERROR (EcapzProvider): POST ${path} failed.`, error)
      throw error
    }
  }

  private async _createOwner(companyId: string, profile: EcapzOwnerProfile): Promise<string> {
    const data = await this._post<{ id: string }>('/v2/cards/owner', {
      company_id: companyId,
      first_name: profile.firstName,
      last_name: profile.lastName,
      email: profile.email,
      phone_number: profile.phoneNumber,
    })
    if (!data?.id) throw new Error('EcapzProvider: /v2/cards/owner did not return an id')
    return data.id
  }

  private async _createAccount(companyId: string, ownerId: string): Promise<string> {
    const webhookUrl = this.webhookUrl()
    if (!webhookUrl) throw new Error('EcapzProvider: ECAPZ_WEBHOOK_URL is not configured')

    const data = await this._post<{ id: string }>('/v2/accounts/account', {
      company_id: companyId,
      owner_id: ownerId,
      account_name: 'Loudibly card account',
      webhook_url: webhookUrl,
    })
    if (!data?.id) throw new Error('EcapzProvider: /v2/accounts/account did not return an id')
    return data.id
  }

  private async _issueCard(companyId: string, accountId: string, ownerId: string, cardName: string): Promise<string> {
    const data = await this._post<{ id: string }>('/v2/cards/virtual', {
      company_id: companyId,
      account_id: accountId,
      owner_id: ownerId,
      name: cardName,
    })
    if (!data?.id) throw new Error('EcapzProvider: /v2/cards/virtual did not return an id')
    return data.id
  }

  /**
   * error_code 100016 means the provider hasn't finished syncing the card yet —
   * per the Card Bridge spec, wait briefly and retry once.
   */
  private async _getCardDetails(companyId: string, cardId: string, retried = false): Promise<EcapzCard> {
    try {
      const data = await this._post<EcapzCard>('/v2/cards/details', { company_id: companyId, card_id: cardId })
      if (!data) throw new Error('EcapzProvider: /v2/cards/details returned no data')
      return data
    } catch (error: any) {
      if (!retried && error?.response?.data?.error_code === 100016) {
        console.log('DEBUG (EcapzProvider): card details not synced yet (100016), retrying once...')
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return this._getCardDetails(companyId, cardId, true)
      }
      throw error
    }
  }

  /**
   * Issues a virtual card, creating the owner/account first if not already known.
   * Callers pass back `ownerId`/`accountId` from a prior partial attempt to make
   * retries idempotent — Card Bridge has no idempotency keys of its own, so a
   * naive retry would otherwise create duplicate owners/accounts.
   *
   * `onStep` is invoked immediately after each sub-step succeeds so the caller can
   * persist progress — a Lambda timeout mid-sequence kills execution with no
   * catchable error, so checkpoints must be written as they happen, not recovered
   * from a thrown error afterward.
   */
  async issueCard(params: EcapzIssueCardParams): Promise<EcapzIssueCardResult> {
    console.log(`DEBUG (EcapzProvider): issueCard started. companyId=${params.companyId}, hasOwnerId=${!!params.ownerId}, hasAccountId=${!!params.accountId}`)

    let ownerId = params.ownerId
    if (!ownerId) {
      ownerId = await this._createOwner(params.companyId, params.profile)
      await params.onStep?.('owner', ownerId)
      console.log(`DEBUG (EcapzProvider): owner created. ownerId=${ownerId}`)
    }

    let accountId = params.accountId
    if (!accountId) {
      accountId = await this._createAccount(params.companyId, ownerId)
      await params.onStep?.('account', accountId)
      console.log(`DEBUG (EcapzProvider): account created. accountId=${accountId}`)
    }

    const cardId = await this._issueCard(params.companyId, accountId, ownerId, params.cardName)
    await params.onStep?.('card', cardId)
    console.log(`DEBUG (EcapzProvider): card issued. cardId=${cardId}`)

    const card = await this._getCardDetails(params.companyId, cardId)
    console.log(`DEBUG (EcapzProvider): issueCard completed. cardId=${cardId}`)

    return { ownerId, accountId, cardId, card }
  }
}
