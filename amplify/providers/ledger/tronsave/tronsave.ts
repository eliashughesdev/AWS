import { getTronResources } from '../tatum/chains/tron'

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

// Safety margin on top of the shortfall we ask TronSave for. State can shift
// between reading current resources and the order landing on-chain, and
// running out mid-broadcast burns TRX anyway without moving the tokens.
const ENERGY_MARGIN = 1.25

// TronSave's documented minimum rental duration.
const DEFAULT_DURATION_SEC = 900

// TronSave accepts a named speed tier or an explicit SUN price.
type UnitPrice = 'FAST' | 'MEDIUM' | 'SLOW' | number

// MEDIUM is cheaper than FAST and is TronSave's own default. Callers can pass
// FAST if MEDIUM's fill latency turns out to be a problem for that flow.
const DEFAULT_UNIT_PRICE: UnitPrice = 'MEDIUM'

// Poll interval/timeout while waiting for a filled order to land on-chain.
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function tronsaveRequest(path: string, method: 'GET' | 'POST', body?: unknown) {
  const res = await fetch(`${resolveBase()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', [resolveAuthHeader()]: resolveApiKey() },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`TronSave ${method} ${path} -> ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function estimateEnergy(receiver: string, amount: number, durationSec: number, unitPrice: UnitPrice) {
  const res = await tronsaveRequest('/v2/estimate-buy-resource', 'POST', {
    resourceType: 'ENERGY',
    resourceAmount: amount,
    durationSec,
    receiver,
    unitPrice,
  })
  return res.data
}

async function buyEnergy(receiver: string, amount: number, durationSec: number, unitPrice: UnitPrice) {
  const res = await tronsaveRequest('/v2/buy-resource', 'POST', {
    resourceType: 'ENERGY',
    resourceAmount: amount,
    durationSec,
    receiver,
    unitPrice,
    options: { onlyCreateWhenFulfilled: true },
  })
  return res.data
}

/**
 * Makes sure `address` has at least `energyNeeded` energy available, renting
 * the delta from TronSave if needed. does nothing if the address already has
 * enough (e.g. leftover from a still-active prior rental).
 */
export async function ensureEnergy(
  address: string,
  energyNeeded: number,
  durationSec = DEFAULT_DURATION_SEC,
  unitPrice: UnitPrice = DEFAULT_UNIT_PRICE
): Promise<void> {
  const before = await getTronResources(address)
  console.log(`DEBUG (TronSaveProvider): ${address} has ${before.energyAvailable} energy available, needs ${energyNeeded}`)
  if (before.energyAvailable >= energyNeeded) return

  const delta = energyNeeded - before.energyAvailable
  let toRent = Math.ceil(delta * ENERGY_MARGIN)

  const quote = await estimateEnergy(address, toRent, durationSec, unitPrice)
  if (quote.availableResource < toRent) {
    throw new Error(`TronSave cannot fill ${toRent} energy for ${address} right now (only ${quote.availableResource} available)`)
  }

  const order = await buyEnergy(address, toRent, durationSec, unitPrice)
  console.log(`DEBUG (TronSaveProvider): order created for ${address}. orderId=${order.orderId}`)

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const after = await getTronResources(address)
    if (after.energyAvailable >= energyNeeded) return
  }

  throw new Error(`TronSave order for ${address} did not deliver enough energy within ${POLL_TIMEOUT_MS / 1000}s`)
}
