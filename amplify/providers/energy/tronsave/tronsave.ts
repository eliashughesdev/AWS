import { isTronAccountActive } from '../../ledger/tatum/chains/tron'
import type { EnergyProvider, RentOutcome, RentRequest, ResourceType } from '../EnergyProvider'

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

// The smallest order it takes (measured on Nile, energy-rental-plan step 4).
// A smaller one is answered 500 "resourceAmount must be greater than 64000".
const MINIMUM: Record<ResourceType, number> = { ENERGY: 64_000, BANDWIDTH: 1_000 }

const REQUEST_TIMEOUT_MS = 10_000

// Activation is only in the legacy v0 API: a status per address, then a request
// that answers no order id, paid from the internal balance
const ACTIVATION_SUN = 1_500_000
const INACTIVE = 0
const ACTIVE = 2
const ACTIVATION_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 2000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

// Activates a receiver that was never activated, then reads the chain until it
// shows. A refusal when nothing was bought; a throw once an activation may have been.
async function activate(receiver: string, onActivated: (sun: number) => Promise<void>): Promise<RentOutcome | undefined> {
  let status: unknown
  try {
    [status] = await tronsaveRequest('/v0/helper/is-active-address-check', 'POST', { addresses: [receiver] })
  } catch (err) {
    return { status: 'refused', reason: `no activation check: ${(err as Error).message}` }
  }
  if (status === ACTIVE) return undefined
  if (status !== INACTIVE) return { status: 'refused', reason: `activation check answered ${status} for ${receiver}` }

  const { message } = await tronsaveRequest('/v0/helper/multi-active-address', 'POST', { addresses: [receiver] })
  console.log(`DEBUG (TronSaveProvider): activating ${receiver}: ${message}`)
  await onActivated(ACTIVATION_SUN)

  const deadline = Date.now() + ACTIVATION_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    if (await isTronAccountActive(receiver)) return undefined
  }
  throw new Error(`TronSave's activation of ${receiver} did not show on chain within ${ACTIVATION_TIMEOUT_MS / 1000}s`)
}

export class TronSaveProvider implements EnergyProvider {
  readonly name = 'TronSave'
  readonly resources: EnergyProvider['resources'] = ['ENERGY', 'BANDWIDTH']
  readonly deliveryTimeoutMs = 120_000
  readonly activationSun = ACTIVATION_SUN

  minimum(resource: ResourceType): number {
    return MINIMUM[resource]
  }

  async rent({ resource, receiver, amount, onActivated }: RentRequest): Promise<RentOutcome> {
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
    // After the quote, so a provider with too little to rent pays for no activation
    if (onActivated) {
      const refusal = await activate(receiver, onActivated)
      if (refusal) return refusal
    }

    // No second order while an identical one is unfinished
    const options = { onlyCreateWhenFulfilled: true, preventDuplicateIncompleteOrders: true }
    const { data } = await tronsaveRequest('/v2/buy-resource', 'POST', { ...order, options })
    // The answer has only the orderId, so the cost is the quote's
    return { status: 'placed', orderId: data.orderId, costSun: quote.estimateTrx }
  }
}
