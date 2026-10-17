import { createHash, createHmac, timingSafeEqual } from 'crypto'
import type {
  Balance, CardAction, CardEvent, CardIssuer, CardOutcome, CardPayment, CardReveal, CardStatus, Cardholder,
  Company, IssueCardRequest, IssuedCard, Money, PaymentStatus, TopUpStatus,
} from '../CardIssuer'

// ecapz's API ("Card Bridge", api_2.3.0.yaml). Where the live API differs from that spec, this
// follows the live one: docs/card-issuing-plan.md, step 0's notes.

const REQUEST_TIMEOUT_MS = 10_000
// Issuing may wait on the card network; still well inside the API Lambda's 28 s
const ISSUE_TIMEOUT_MS = 20_000
// The card exists but the issuer has not finished making it
const NOT_READY = 100016
// How old a webhook's `t` may be; a retried delivery carries a fresh one
const WEBHOOK_TOLERANCE_S = 300
// The spec's Amount: at most 2 decimals, never 0
const AMOUNT = /^(?!0+(\.0{1,2})?$)\d+(\.\d{1,2})?$/

// Read lazily: loadConfig() fills these in from SSM after this module is imported
function setting(name: string): string | undefined {
  const value = process.env[name]
  if (!value) console.error(`CONFIG_ERROR (EcapzCardIssuer): ${name} is not set`)
  return value
}

function apiConfig() {
  const url = setting('ECAPZ_URL')
  const project = setting('ECAPZ_PROJECT')
  const secret = setting('ECAPZ_SECRET')
  if (!url || !project || !secret) return undefined
  if (!/^([0-9a-f]{2})+$/i.test(secret)) {
    console.error('CONFIG_ERROR (EcapzCardIssuer): ECAPZ_SECRET is not hex')
    return undefined
  }
  return { url: url.replace(/\/+$/, ''), project, secret }
}

// `Signature <ms>:<sha256 hex of the body>:<base64 HMAC-SHA256(hex-decoded secret, path + ms + body hash)>`
export function sign(secret: string, path: string, timestamp: string, rawBody: string): string {
  const bodyHash = createHash('sha256').update(rawBody).digest('hex')
  const signature = createHmac('sha256', Buffer.from(secret, 'hex')).update(path + timestamp + bodyHash).digest('base64')
  return `Signature ${timestamp}:${bodyHash}:${signature}`
}

// Hex HMAC-SHA256(secret, t + "." + raw body), the v1 of a webhook's X-Signature
export function webhookSignature(secret: string, t: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')
}

type Refused = { status: 'refused', code?: number, reason: string }
type Unknown = { status: 'unknown', reason: string }
type Reply = { status: 'ok', data: any } | Refused | Unknown

// Every call is a signed POST. Success is a 2xx with a JSON body: some answers have no
// `success` field. A refusal is a 4xx, or any answer below 500 with an `error_code`
async function call(path: string, body: object, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Reply> {
  const config = apiConfig()
  if (!config) return { status: 'refused', reason: 'ecapz is not configured' }

  const raw = JSON.stringify(body)
  let status: number
  let text: string
  try {
    const res = await fetch(config.url + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Project': config.project,
        Authorization: sign(config.secret, path, Date.now().toString(), raw),
      },
      body: raw,
      signal: AbortSignal.timeout(timeoutMs),
    })
    status = res.status
    text = await res.text()
  } catch (err) {
    return { status: 'unknown', reason: `${path}: no answer (${(err as Error).message})` }
  }

  let reply: any
  try {
    reply = JSON.parse(text)
  } catch {}
  const where = `${path} -> ${status}`
  if (typeof reply?.error_code === 'number' && status < 500) {
    return { status: 'refused', code: reply.error_code, reason: `${where}: ${reply.error_code} ${reply.message ?? ''}`.trim() }
  }
  if (status === 403) return { status: 'refused', reason: `${where}: signature refused` }
  if (status >= 400 && status < 500) return { status: 'refused', reason: `${where}: ${text.slice(0, 200)}` }
  if (status >= 200 && status < 300 && reply !== undefined) return { status: 'ok', data: reply?.res?.data }
  return { status: 'unknown', reason: `${where}: ${text.slice(0, 200)}` }
}

// An answer without what was asked for is unknown: on a create, the thing may exist
function outcome<T>(reply: Reply, map: (data: any) => T | undefined): CardOutcome<T> {
  if (reply.status !== 'ok') return reply
  const value = map(reply.data)
  return value === undefined ? { status: 'unknown', reason: 'the answer lacks the expected data' } : { status: 'done', value }
}

const done = (reply: Reply): CardOutcome<void> => (reply.status === 'ok' ? { status: 'done', value: undefined } : reply)

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const idOf = (data: any) => text(data?.id)

// The spec answers a list as `data`; live, some come inside it (`data.cards`, `data.transactions`)
const listOf = (data: any, key: string): any[] | undefined =>
  Array.isArray(data) ? data : Array.isArray(data?.[key]) ? data[key] : undefined

// Every entry must map, or one card or payment would silently go missing
function mapAll<T>(items: any[] | undefined, map: (item: any) => T | undefined): T[] | undefined {
  const mapped = items?.map(map)
  return mapped?.every(item => item !== undefined) ? mapped as T[] : undefined
}

// Both lists: `/v2/cards/status` (pending, deleted) and the card state webhook (creating, creating_failed, expired)
const CARD_STATUSES = new Map<string, CardStatus>([
  ['creating', 'pending'], ['pending', 'pending'], ['creating_failed', 'failed'], ['active', 'active'],
  ['frozen', 'frozen'], ['blocked', 'blocked'], ['expired', 'expired'], ['deleted', 'deleted'],
])
const cardStatus = (value: unknown): CardStatus => CARD_STATUSES.get(String(value)) ?? 'unknown'

const PAYMENT_STATUSES = new Set<string>(['authorized', 'pending', 'completed', 'declined', 'canceled', 'failed'])
const paymentStatus = (value: unknown): PaymentStatus =>
  PAYMENT_STATUSES.has(String(value)) ? value as PaymentStatus : 'unknown'

// The webhook's seven stages, and the list's created/pending/completed/failed
const TOP_UP_STATUSES = new Map<string, TopUpStatus>([
  ['created', 'waiting'], ['in_progress', 'processing'], ['pending', 'processing'],
  ['readyForAllocation', 'processing'], ['allocating', 'processing'], ['readyForTransfer', 'processing'],
  ['transfering', 'processing'], ['completed', 'completed'], ['failed', 'failed'], ['refunded', 'refunded'],
])
const topUpStatus = (value: unknown): TopUpStatus => TOP_UP_STATUSES.get(String(value)) ?? 'unknown'

const moneyOf = (amount: unknown, currency: unknown): Money | undefined =>
  text(amount) ? { amount: amount as string, currency: text(currency) } : undefined

// Live "10.2028"; the spec writes a date-time
function expiryOf(value: unknown): IssuedCard['expiry'] {
  if (typeof value !== 'string') return undefined
  const monthYear = /^(\d{1,2})\.(\d{4})$/.exec(value)
  if (monthYear) return { month: Number(monthYear[1]), year: Number(monthYear[2]) }
  const date = new Date(value)
  return isNaN(date.getTime()) ? undefined : { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() }
}

function cardOf(card: any): IssuedCard | undefined {
  const id = text(card?.card_id)
  if (!id) return undefined
  // Live "4579"; the spec writes "**** **** **** 4421"
  const digits = String(card.masked_number ?? card.card_last4 ?? '').replace(/\D/g, '')
  return {
    id,
    cardAccountId: text(card.account_id),
    cardholderId: text(card.card_owner?.owner_id),
    name: text(card.name),
    last4: digits.length >= 4 ? digits.slice(-4) : undefined,
    network: text(card.payment_system)?.toLowerCase(),
    type: card.card_type === 'physical' ? 'physical' : 'virtual',
    status: cardStatus(card.status),
    expiry: expiryOf(card.expired_at),
  }
}

// A row of `/v2/cards/transactions`, or a card transaction webhook, whose card details sit in `transaction`
function paymentOf(row: any): CardPayment | undefined {
  const id = text(row?.id)
  const amount = moneyOf(row?.amount, row?.currency)
  if (!id || !amount) return undefined
  const detail = row.transaction ?? {}
  const merchant = text(detail.merchant_name) || text(detail.merchant_country) || text(detail.mcc)
    ? { name: text(detail.merchant_name), country: text(detail.merchant_country), mcc: text(detail.mcc) }
    : undefined
  return {
    id,
    cardId: text(row.card_id) ?? text(detail.card_id),
    cardAccountId: text(row.account_id),
    last4: text(detail.card_last4),
    type: text(detail.transaction_type) ?? text(row.transaction_type),
    status: paymentStatus(row.status),
    amount,
    settled: moneyOf(row.settlement_amount, row.settlement_currency),
    fee: moneyOf(row.fee_amount, row.fee_currency),
    merchant,
    declineReason: text(detail.decline_reason),
    at: text(detail.transaction_at) ?? text(row.created_at),
  }
}

const balanceOf = (data: any): Balance | undefined =>
  text(data?.available_balance) ? { available: data.available_balance, currency: text(data.currency) } : undefined

const CARD_ACTIONS: Record<CardAction, string> = { freeze: '/v2/cards/freeze', unfreeze: '/v2/cards/unfreeze', block: '/v2/cards/block' }

export class EcapzCardIssuer implements CardIssuer {
  async getCompany(companyId: string): Promise<CardOutcome<Company>> {
    return outcome(await call('/v2/companies/get-company', { company_id: companyId }), data =>
      idOf(data) ? { id: data.id, name: text(data.name), active: data.status === 'active' } : undefined)
  }

  async setWebhookSecret(companyId: string): Promise<CardOutcome<void>> {
    const secret = setting('ECAPZ_WEBHOOK_SECRET')
    if (!secret) return { status: 'refused', reason: 'ECAPZ_WEBHOOK_SECRET is not set' }
    return done(await call('/v2/companies/update-company', { company_id: companyId, webhook_secret: secret }))
  }

  async corporateBalance(companyId: string): Promise<CardOutcome<Balance>> {
    return outcome(await call('/v2/companies/balance', { company_id: companyId }), balanceOf)
  }

  async createCardholder(companyId: string, holder: Cardholder): Promise<CardOutcome<string>> {
    return outcome(await call('/v2/cards/owner', {
      company_id: companyId,
      first_name: holder.firstName,
      last_name: holder.lastName,
      email: holder.email,
      phone_number: holder.phone,
      external_id: holder.reference,
    }), idOf)
  }

  async findCardholder(companyId: string, reference: string): Promise<CardOutcome<string | null>> {
    return outcome(await call('/v2/cards/list-owners', { company_id: companyId }), data => {
      const owners = listOf(data, 'owners')
      return owners && (owners.find(o => o?.external_id === reference && o.status !== 'inactive')?.id ?? null)
    })
  }

  async createCardAccount(companyId: string, reference: string): Promise<CardOutcome<string>> {
    const webhookUrl = setting('ECAPZ_WEBHOOK_URL')
    if (!webhookUrl) return { status: 'refused', reason: 'ECAPZ_WEBHOOK_URL is not set' }
    return outcome(await call('/v2/accounts/account', { company_id: companyId, account_name: reference, webhook_url: webhookUrl }), idOf)
  }

  // An account keeps no reference of ours but its name
  async findCardAccount(companyId: string, reference: string): Promise<CardOutcome<string | null>> {
    return outcome(await call('/v2/accounts', { company_id: companyId }), data => {
      const accounts = listOf(data, 'accounts')
      return accounts && (accounts.find(a => a?.name === reference && a.status === 'active')?.id ?? null)
    })
  }

  async cardAccountBalance(companyId: string, cardAccountId: string): Promise<CardOutcome<Balance>> {
    return outcome(await call('/v2/accounts/balance', { company_id: companyId, account_id: cardAccountId }), balanceOf)
  }

  load(companyId: string, cardAccountId: string, amount: string): Promise<CardOutcome<void>> {
    return this.move('/v2/accounts/deposit', companyId, cardAccountId, amount)
  }

  unload(companyId: string, cardAccountId: string, amount: string): Promise<CardOutcome<void>> {
    return this.move('/v2/accounts/withdraw', companyId, cardAccountId, amount)
  }

  private async move(path: string, companyId: string, cardAccountId: string, amount: string): Promise<CardOutcome<void>> {
    if (!AMOUNT.test(amount)) return { status: 'refused', reason: `${amount} is not an amount above 0 with at most 2 decimals` }
    return done(await call(path, { company_id: companyId, account_id: cardAccountId, amount }))
  }

  async issueCard(companyId: string, request: IssueCardRequest): Promise<CardOutcome<string>> {
    return outcome(await call('/v2/cards/card', {
      company_id: companyId,
      card_bin_id: request.binId,
      account_id: request.cardAccountId,
      owner_id: request.cardholderId,
      name: request.name,
      card_type: 'virtual',
    }, ISSUE_TIMEOUT_MS), idOf)
  }

  async listCards(companyId: string, cardAccountId: string): Promise<CardOutcome<IssuedCard[]>> {
    return outcome(await call('/v2/cards', { company_id: companyId, account_id: cardAccountId }), data =>
      mapAll(listOf(data, 'cards'), cardOf))
  }

  async cardDetails(companyId: string, cardId: string): Promise<CardOutcome<IssuedCard> | { status: 'not-ready' }> {
    const reply = await call('/v2/cards/details', { company_id: companyId, card_id: cardId })
    if (reply.status === 'refused' && reply.code === NOT_READY) return { status: 'not-ready' }
    return outcome(reply, cardOf)
  }

  async changeCard(companyId: string, cardId: string, action: CardAction): Promise<CardOutcome<void>> {
    return done(await call(CARD_ACTIONS[action], { company_id: companyId, card_id: cardId }))
  }

  async cardPayments(companyId: string, cardId: string): Promise<CardOutcome<CardPayment[]>> {
    return outcome(await call('/v2/cards/transactions', { company_id: companyId, card_id: cardId }), data =>
      mapAll(listOf(data, 'transactions'), paymentOf))
  }

  async revealCard(companyId: string, cardId: string): Promise<CardOutcome<CardReveal>> {
    return outcome(await call('/v2/cards/widget', { company_id: companyId, card_id: cardId }), data =>
      text(data?.widget_url) && text(data.widget_token)
        ? { url: data.widget_url, token: data.widget_token, expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : undefined }
        : undefined)
  }

  // X-Signature: t=<unix s>,v1=<hex>; only sent once the company has a webhook secret
  verifyWebhook(rawBody: string | undefined, signature: string | undefined, now = Date.now()): boolean {
    const secret = setting('ECAPZ_WEBHOOK_SECRET')
    if (!secret || typeof rawBody !== 'string' || !signature) return false
    const parts = signature.split(',').map(part => part.trim().split('='))
    const t = parts.find(([key]) => key === 't')?.[1]
    if (!t || !/^\d+$/.test(t) || Math.abs(now / 1000 - Number(t)) > WEBHOOK_TOLERANCE_S) return false
    const expected = Buffer.from(webhookSignature(secret, t, rawBody))
    return parts.some(([key, value]) => {
      if (key !== 'v1' || !value) return false
      const received = Buffer.from(value)
      return received.length === expected.length && timingSafeEqual(received, expected)
    })
  }

  // No event name is sent: the kind shows in the fields
  parseWebhook(body: unknown): CardEvent {
    const event = body as any
    if (!event || typeof event !== 'object') return { kind: 'unrecognized' }
    const companyId = text(event.company_id)

    if (event.transaction && typeof event.transaction === 'object') {
      const payment = paymentOf(event)
      return payment ? { kind: 'payment', companyId, payment } : { kind: 'unrecognized' }
    }
    if ('payment_address' in event) {
      const id = text(event.id)
      return id
        ? {
            kind: 'top-up',
            companyId,
            id,
            status: topUpStatus(event.status),
            address: text(event.payment_address),
            currency: text(event.currency),
            amount: text(event.amount),
            fee: moneyOf(event.fee_amount, event.fee_currency),
            credited: moneyOf(event.settlement_amount, event.settlement_currency),
            txHash: text(event.hash),
          }
        : { kind: 'unrecognized' }
    }
    if ('transaction_type' in event) {
      const id = text(event.id)
      const amount = moneyOf(event.amount, event.currency)
      return id && amount
        ? {
            kind: 'balance-movement',
            companyId,
            id,
            cardAccountId: text(event.account_id),
            // May be empty for a movement of no known kind
            type: typeof event.transaction_type === 'string' ? event.transaction_type : '',
            amount,
            fee: moneyOf(event.fee_amount, event.fee_currency),
            at: text(event.created_at),
          }
        : { kind: 'unrecognized' }
    }
    const cardId = text(event.card_id)
    if (cardId && text(event.status)) {
      return { kind: 'card-state', companyId, cardId, cardAccountId: text(event.account_id), status: cardStatus(event.status) }
    }
    return { kind: 'unrecognized' }
  }
}
