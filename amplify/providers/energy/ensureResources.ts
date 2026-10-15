import { getTronBalance, getTronBandwidthPriceSun, getTronResources, type TronResources } from '../ledger/tatum/chains/tron'
import type { EnergyProvider, ResourceType } from './EnergyProvider'
import { TronSaveProvider } from './tronsave/tronsave'

// Tried in this order: a refusal moves on to the next one.
const PROVIDERS: EnergyProvider[] = [new TronSaveProvider()]

// Safety margin on top of the shortfall. State can shift between reading
// current resources and the order landing on-chain, and running out
// mid-broadcast burns TRX anyway without moving the tokens.
const MARGIN_PERCENT = 1

// Poll interval/timeout while waiting for a placed order to land on-chain.
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// In integers, so a round shortfall isn't pushed up by float error (100 × 1.01 > 101)
const withMargin = (amount: number) => Math.ceil(amount * (100 + MARGIN_PERCENT) / 100)

// What a tx can actually use. Energy shortfalls are topped up by burning TRX,
// but a Bandwidth pool is only used if it covers the whole tx on its own.
function availableOf(resource: ResourceType, resources: TronResources): number {
  return resource === 'ENERGY'
    ? resources.energyAvailable
    : Math.max(resources.freeBandwidthAvailable, resources.stakedBandwidthAvailable)
}

// The pool a rental adds to — rented Bandwidth lands in the staked pool.
function rentablePoolOf(resource: ResourceType, resources: TronResources): number {
  return resource === 'ENERGY' ? resources.energyAvailable : resources.stakedBandwidthAvailable
}

// Places the order with the first provider that takes it. A refusal means
// nothing was bought, so the next one is tried; a throw may leave an order
// behind, so it is never followed by another provider's.
async function rent(resource: ResourceType, receiver: string, shortfall: number) {
  const refusals: string[] = []
  for (const provider of PROVIDERS.filter((p) => p.resources.includes(resource))) {
    const amount = Math.max(withMargin(shortfall), provider.minimum(resource))
    const outcome = await provider.rent({ resource, receiver, amount })
    if (outcome.status === 'placed') {
      console.log(`DEBUG (ensureResources): ${provider.name} ${resource} order created for ${receiver}: short by ${shortfall}, renting ${amount}. orderId=${outcome.orderId}`)
      return { provider: provider.name, orderId: outcome.orderId }
    }
    refusals.push(`${provider.name}: ${outcome.reason}`)
  }
  throw new Error(`No provider can rent ${resource} for ${receiver} right now (${refusals.join('; ')})`)
}

/**
 * Makes sure `address` has at least `amountNeeded` of `resource` available,
 * renting the shortfall if needed. Does nothing if the address already has
 * enough (e.g. leftover from a still-active prior rental). Shared by
 * ensureEnergy and ensureBandwidth below.
 */
async function ensureResource(
  resource: ResourceType,
  address: string,
  amountNeeded: number,
  canPayWithoutRenting?: () => Promise<boolean>
): Promise<void> {
  const before = await getTronResources(address)
  const availableBefore = availableOf(resource, before)
  console.log(`DEBUG (ensureResources): ${address} has ${availableBefore} ${resource} available, needs ${amountNeeded}`)
  if (availableBefore >= amountNeeded) return
  if (await canPayWithoutRenting?.()) return

  const order = await rent(resource, address, amountNeeded - rentablePoolOf(resource, before))

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const after = await getTronResources(address)
    const availableAfter = availableOf(resource, after)
    if (availableAfter >= amountNeeded) {
      console.log(`DEBUG (ensureResources): ${order.provider} ${resource} order ${order.orderId} delivered for ${address}. now has ${availableAfter}`)
      return
    }
  }

  throw new Error(`${order.provider} order ${order.orderId} for ${address} did not deliver enough ${resource} within ${POLL_TIMEOUT_MS / 1000}s`)
}

export async function ensureEnergy(address: string, energyNeeded: number): Promise<void> {
  return ensureResource('ENERGY', address, energyNeeded)
}

/**
 * Makes sure `address` can pay for a signed transaction's byte size. Most
 * transfers fit in one of its Bandwidth pools; when neither does, burning TRX
 * is cheaper than a rental, so it only rents when the address can't afford
 * the burn (e.g. a customer address holding only USDT).
 */
export async function ensureBandwidth(address: string, bandwidthNeeded: number): Promise<void> {
  return ensureResource('BANDWIDTH', address, bandwidthNeeded, () => canBurnBandwidth(address, bandwidthNeeded))
}

async function canBurnBandwidth(address: string, bandwidthNeeded: number): Promise<boolean> {
  try {
    const [balanceTrx, priceSun] = await Promise.all([getTronBalance(address), getTronBandwidthPriceSun()])
    if (!priceSun) return false
    const burnSun = withMargin(bandwidthNeeded * priceSun)
    const canBurn = balanceTrx * 1_000_000 >= burnSun
    console.log(`DEBUG (ensureResources): ${address} holds ${balanceTrx} TRX, burning ${bandwidthNeeded} Bandwidth costs ~${(burnSun / 1_000_000).toFixed(6)} TRX — ${canBurn ? 'burning instead of renting' : 'must rent'}`)
    return canBurn
  } catch (err) {
    console.log(`DEBUG (ensureResources): could not check whether ${address} can burn for Bandwidth, renting instead`, err)
    return false
  }
}
