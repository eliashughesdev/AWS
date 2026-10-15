import { createHmac, randomUUID } from 'crypto'
import type { EnergyProvider, OrderState, RentOutcome, RentRequest } from '../EnergyProvider'

// Read lazily (not as module-level consts) — loadConfig() fills these in from
// SSM after this module has been imported. Without them CatFee refuses, so the
// next provider is tried.
function resolveConfig() {
  const { CATFEE_BASE_URL: base, CATFEE_API_KEY: key, CATFEE_API_SECRET: secret } = process.env
  if (!base || !key || !secret) return undefined
  return { base: base.replace(/\/+$/, ''), key, secret }
}

type Config = NonNullable<ReturnType<typeof resolveConfig>>

// The only duration CatFee rents for, and its smallest order
const DURATION = '1h'
const MINIMUM = 65_000

const REQUEST_TIMEOUT_MS = 10_000

// Business codes that mean CatFee did nothing: auth, IP, clock, rate limit,
// the address or quantity, and an empty balance. Every other nonzero code may
// hide an order (114 says so outright).
const REFUSAL_CODES = new Set([1, 2, 100, 101, 102, 106, 107, 108, 110, 201, 202])

// Order statuses that will never deliver
const FAILED_STATUSES = new Set([
  'INSUFFICIENT_BALANCE', 'QUANTITY_TOO_HIGH', 'QUANTITY_TOO_LOW', 'ADDRESS_NOT_ACTIVATED', 'INVALID_ADDRESS', 'DELEGATE_FAIL',
])

interface CatFeeOrder {
  id: string
  status?: string
  confirm_status?: string
  pay_amount_sun?: number
}

// 'order': CatFee answered with one. 'refused': it did nothing. 'unsure': it may have.
type Answer =
  | { kind: 'order', order: CatFeeOrder }
  | { kind: 'refused', reason: string }
  | { kind: 'unsure', reason: string }

// base64(HMAC-SHA256(secret, timestamp + method + requestPath)), the path with its query
export function sign(secret: string, timestamp: string, method: string, requestPath: string): string {
  return createHmac('sha256', secret).update(timestamp + method + requestPath).digest('base64')
}

// Business errors come back as HTTP 200 with a nonzero `code`
async function catfeeRequest(config: Config, method: 'GET' | 'POST', path: string, query?: Record<string, string>): Promise<Answer> {
  const requestPath = query ? `${path}?${new URLSearchParams(query)}` : path
  const timestamp = new Date().toISOString()
  let status: number
  let text: string
  try {
    const res = await fetch(`${config.base}${requestPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'CF-ACCESS-KEY': config.key,
        'CF-ACCESS-SIGN': sign(config.secret, timestamp, method, requestPath),
        'CF-ACCESS-TIMESTAMP': timestamp,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    status = res.status
    text = await res.text()
  } catch (err) {
    const cause = (err as any)?.cause?.code ?? (err as any)?.cause?.message
    return { kind: 'unsure', reason: `${method} ${path}: no answer (${(err as Error).message}${cause ? `: ${cause}` : ''})` }
  }

  const where = `${method} ${path} -> ${status}`
  if (status >= 400 && status < 500) return { kind: 'refused', reason: `${where}: ${text}` }
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    return { kind: 'unsure', reason: `${where}: ${text}` }
  }
  const ok = status >= 200 && status < 300
  if (ok && body?.code === 0 && body.data?.id) return { kind: 'order', order: body.data }
  const reason = `${where}: code ${body?.code} ${body?.msg ?? ''}`.trim()
  if (ok && REFUSAL_CODES.has(body?.code)) return { kind: 'refused', reason }
  return { kind: 'unsure', reason }
}

// Why an order will never deliver, or undefined while it still may
function failureOf(order: CatFeeOrder): string | undefined {
  if (order.status && FAILED_STATUSES.has(order.status)) return order.status
  if (order.confirm_status === 'DELEGATION_CONFIRMED_FAIL') return order.confirm_status
  return undefined
}

export class CatFeeProvider implements EnergyProvider {
  readonly name = 'CatFee'
  readonly resources: EnergyProvider['resources'] = ['ENERGY']
  readonly deliveryTimeoutMs = 60_000

  minimum(): number {
    return MINIMUM
  }

  async rent({ receiver, amount }: RentRequest): Promise<RentOutcome> {
    const config = resolveConfig()
    if (!config) return { status: 'refused', reason: 'CATFEE_BASE_URL, CATFEE_API_KEY or CATFEE_API_SECRET is not set' }

    // Sending the same client_order_id again returns the order it made, never a second one
    const query = { quantity: String(amount), receiver, duration: DURATION, client_order_id: randomUUID(), activate: 'false' }
    let answer = await catfeeRequest(config, 'POST', '/v1/order', query)
    if (answer.kind === 'unsure') {
      console.log(`DEBUG (CatFeeProvider): order ${query.client_order_id} for ${receiver} is unclear (${answer.reason}), sending it again`)
      answer = await catfeeRequest(config, 'POST', '/v1/order', query)
      // Only an order settles it now: a refusal of the resend says nothing about the first
      if (answer.kind !== 'order') throw new Error(`CatFee order ${query.client_order_id} for ${receiver} is unclear: ${answer.reason}`)
    }
    if (answer.kind === 'refused') return { status: 'refused', reason: answer.reason }

    const { order } = answer
    console.log(`DEBUG (CatFeeProvider): order ${order.id} (${query.client_order_id}) for ${receiver}: status=${order.status} confirm_status=${order.confirm_status} pay_amount_sun=${order.pay_amount_sun}`)
    const failure = failureOf(order)
    if (failure) return { status: 'refused', reason: `order ${order.id}: ${failure}` }
    return { status: 'placed', orderId: order.id, costSun: order.pay_amount_sun }
  }

  async orderState(orderId: string): Promise<OrderState> {
    const config = resolveConfig()
    if (!config) throw new Error('CatFee is not configured')
    const answer = await catfeeRequest(config, 'GET', `/v1/order/${encodeURIComponent(orderId)}`)
    if (answer.kind !== 'order') throw new Error(`CatFee could not read order ${orderId}: ${answer.reason}`)
    const failure = failureOf(answer.order)
    return failure ? { status: 'failed', reason: failure } : { status: 'pending' }
  }
}
