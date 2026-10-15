import type { EnergyProvider, RentOutcome, RentRequest } from '../EnergyProvider'

// Read lazily (not as module-level consts) — loadConfig() refreshes these from
// SSM/Secrets Manager at request time, after this module has already been
// imported at cold start.
function resolveBase(): string {
  const base = process.env.TRONSAVE_BASE_URL
  if (!base) throw new Error('Missing required env var: TRONSAVE_BASE_URL')
  return base
}

function resolveApiKey(): string {
  const key = process.env.TRONSAVE_API_KEY
  if (!key) throw new Error('Missing required env var: TRONSAVE_API_KEY')
  return key
}

function resolveAuthHeader(): string {
  return process.env.TRONSAVE_AUTH_HEADER || 'apikey'
}

// TronSave's documented minimum rental duration.
const DURATION_SEC = 900

// TronSave accepts a named speed tier or an explicit SUN price.
const UNIT_PRICE = 'MEDIUM'

const REQUEST_TIMEOUT_MS = 10_000

async function tronsaveRequest(path: string, method: 'GET' | 'POST', body?: unknown) {
  const res = await fetch(`${resolveBase()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', [resolveAuthHeader()]: resolveApiKey() },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`TronSave ${method} ${path} -> ${res.status}: ${text}`)
  return JSON.parse(text)
}

export class TronSaveProvider implements EnergyProvider {
  readonly name = 'TronSave'
  readonly resources: EnergyProvider['resources'] = ['ENERGY', 'BANDWIDTH']
  readonly deliveryTimeoutMs = 120_000

  minimum(): number {
    return 0
  }

  async rent({ resource, receiver, amount }: RentRequest): Promise<RentOutcome> {
    const order = { resourceType: resource, resourceAmount: amount, durationSec: DURATION_SEC, receiver, unitPrice: UNIT_PRICE }

    // A quote buys nothing, so one that fails is a refusal
    let quote
    try {
      ({ data: quote } = await tronsaveRequest('/v2/estimate-buy-resource', 'POST', order))
    } catch (err) {
      return { status: 'refused', reason: `no quote: ${(err as Error).message}` }
    }
    console.log(
      `DEBUG (TronSaveProvider): ${resource} quote for ${receiver} — renting ${amount}, ` +
      `unitPriceSun=${quote.unitPrice}, estimatedCostTrx=${(quote.estimateTrx / 1_000_000).toFixed(6)}, ` +
      `availableResource=${quote.availableResource}`
    )
    if (quote.availableResource < amount) {
      return { status: 'refused', reason: `only ${quote.availableResource} ${resource} available` }
    }

    // No second order while an identical one is unfinished
    const options = { onlyCreateWhenFulfilled: true, preventDuplicateIncompleteOrders: true }
    const { data } = await tronsaveRequest('/v2/buy-resource', 'POST', { ...order, options })
    // The answer has only the orderId, so the cost is the quote's
    return { status: 'placed', orderId: data.orderId, costSun: quote.estimateTrx }
  }
}
