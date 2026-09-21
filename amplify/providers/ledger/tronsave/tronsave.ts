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
const RESOURCE_MARGIN = 1.25

type ResourceType = 'ENERGY' | 'BANDWIDTH'

// TronSave's documented minimum rental duration.
const DEFAULT_DURATION_SEC = 900

// TronSave accepts a named speed tier or an explicit SUN price.
type UnitPrice = 'FAST' | 'MEDIUM' | 'SLOW' | number

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

async function estimateResource(resourceType: ResourceType, receiver: string, amount: number, durationSec: number, unitPrice: UnitPrice) {
  const res = await tronsaveRequest('/v2/estimate-buy-resource', 'POST', {
    resourceType,
    resourceAmount: amount,
    durationSec,
    receiver,
    unitPrice,
  })
  return res.data
}

async function buyResource(resourceType: ResourceType, receiver: string, amount: number, durationSec: number, unitPrice: UnitPrice) {
  const res = await tronsaveRequest('/v2/buy-resource', 'POST', {
    resourceType,
    resourceAmount: amount,
    durationSec,
    receiver,
    unitPrice,
    options: { onlyCreateWhenFulfilled: true },
  })
  return res.data
}

function availableOf(resourceType: ResourceType, resources: Awaited<ReturnType<typeof getTronResources>>): number {
  return resourceType === 'ENERGY' ? resources.energyAvailable : resources.bandwidthAvailable
}

/**
 * Makes sure `address` has at least `amountNeeded` of `resourceType`
 * available, renting the delta from TronSave if needed. Does nothing if the
 * address already has enough (e.g. leftover from a still-active prior
 * rental). Shared by ensureEnergy and ensureBandwidth below.
 */
async function ensureResource(
  resourceType: ResourceType,
  address: string,
  amountNeeded: number,
  durationSec: number,
  unitPrice: UnitPrice
): Promise<void> {
  const before = await getTronResources(address)
  const availableBefore = availableOf(resourceType, before)
  console.log(`DEBUG (TronSaveProvider): ${address} has ${availableBefore} ${resourceType} available, needs ${amountNeeded}`)
  if (availableBefore >= amountNeeded) return

  const delta = amountNeeded - availableBefore
  let toRent = Math.ceil(delta * RESOURCE_MARGIN)

  let quote = await estimateResource(resourceType, address, toRent, durationSec, unitPrice)

  // TronSave enforces a minimum order size that varies by resource type (and
  // isn't guaranteed stable over time — energy-rental-test.ts measured ~64,000
  // for ENERGY, the real BANDWIDTH failure that prompted this measured 1000).
  // Never hardcode it: the quote itself reports minOrderAmount, so read and
  // adapt to that instead — same pattern already proven in that test script.
  if (quote.belowMinOrder || toRent < quote.minOrderAmount) {
    console.log(`DEBUG (TronSaveProvider): ${resourceType} order of ${toRent} for ${address} is below TronSave's minimum of ${quote.minOrderAmount} — raising the order`)
    toRent = quote.minOrderAmount
    quote = await estimateResource(resourceType, address, toRent, durationSec, unitPrice)
  }

  console.log(
    `DEBUG (TronSaveProvider): ${resourceType} quote for ${address} — short by ${delta}, renting ${toRent} (margin applied), ` +
    `unitPriceSun=${quote.unitPrice}, estimatedCostTrx=${(quote.estimateTrx / 1_000_000).toFixed(6)}, ` +
    `availableResource=${quote.availableResource}, minOrderAmount=${quote.minOrderAmount}`
  )
  if (quote.availableResource < toRent) {
    throw new Error(`TronSave cannot fill ${toRent} ${resourceType} for ${address} right now (only ${quote.availableResource} available)`)
  }

  const order = await buyResource(resourceType, address, toRent, durationSec, unitPrice)
  console.log(`DEBUG (TronSaveProvider): ${resourceType} order created for ${address}. orderId=${order.orderId}`)

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const after = await getTronResources(address)
    const availableAfter = availableOf(resourceType, after)
    if (availableAfter >= amountNeeded) {
      console.log(`DEBUG (TronSaveProvider): ${resourceType} order ${order.orderId} delivered for ${address}. now has ${availableAfter}`)
      return
    }
  }

  throw new Error(`TronSave order for ${address} did not deliver enough ${resourceType} within ${POLL_TIMEOUT_MS / 1000}s`)
}

export async function ensureEnergy(
  address: string,
  energyNeeded: number,
  durationSec = DEFAULT_DURATION_SEC,
  unitPrice: UnitPrice = DEFAULT_UNIT_PRICE
): Promise<void> {
  return ensureResource('ENERGY', address, energyNeeded, durationSec, unitPrice)
}

/**
 * Makes sure `address` has enough Bandwidth to cover a signed transaction's
 * byte size. Unlike Energy, most transfers fit inside the free daily
 * allowance every TRON account gets, so this is frequently a no-op — it only
 * rents when that free (plus any staked/delegated) Bandwidth is exhausted.
 */
export async function ensureBandwidth(
  address: string,
  bandwidthNeeded: number,
  durationSec = DEFAULT_DURATION_SEC,
  unitPrice: UnitPrice = DEFAULT_UNIT_PRICE
): Promise<void> {
  return ensureResource('BANDWIDTH', address, bandwidthNeeded, durationSec, unitPrice)
}
