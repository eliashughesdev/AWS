import { getTronBalance, getTronBandwidthPriceSun, getTronResources, type TronResources } from '../ledger/tatum/chains/tron'
import { CatFeeProvider } from './catfee/catfee'
import type { EnergyProvider, ResourceType } from './EnergyProvider'
import { TronSaveProvider } from './tronsave/tronsave'

const PROVIDERS: EnergyProvider[] = [new CatFeeProvider(), new TronSaveProvider()]

// The order they are tried in when TRON_ENERGY_PROVIDERS is unset
const DEFAULT_ORDER = 'catfee,tronsave'

// Safety margin on top of the shortfall. State can shift between reading
// current resources and the order landing on-chain, and running out
// mid-broadcast burns TRX anyway without moving the tokens.
const MARGIN_PERCENT = 1

// Poll interval while waiting for a placed order to land on-chain. How long
// to wait is each provider's deliveryTimeoutMs.
const POLL_INTERVAL_MS = 2000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

// The providers that rent `resource`, in TRON_ENERGY_PROVIDERS order. Read on
// each call, since loadConfig() refreshes it; a name it doesn't know is skipped.
function providersFor(resource: ResourceType): EnergyProvider[] {
  const names = (process.env.TRON_ENERGY_PROVIDERS?.trim() || DEFAULT_ORDER).split(',').map((n) => n.trim().toLowerCase()).filter(Boolean)
  const chosen: EnergyProvider[] = []
  for (const name of names) {
    const provider = PROVIDERS.find((p) => p.name.toLowerCase() === name)
    if (!provider) console.error(`CONFIG_ERROR (ensureResources): TRON_ENERGY_PROVIDERS names an unknown provider "${name}"`)
    else if (!chosen.includes(provider)) chosen.push(provider)
  }
  return chosen.filter((p) => p.resources.includes(resource))
}

// Reads the address until the order shows on chain. Ends early when the
// provider says the order failed; throws when the provider's time runs out,
// since the order may still deliver.
async function waitForDelivery(provider: EnergyProvider, orderId: string, resource: ResourceType, address: string, amountNeeded: number) {
  const deadline = Date.now() + provider.deliveryTimeoutMs
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const available = availableOf(resource, await getTronResources(address))
    if (available >= amountNeeded) return { delivered: true as const, available }
    try {
      const state = await provider.orderState?.(orderId)
      if (state?.status === 'failed') return { delivered: false as const, reason: `order ${orderId} failed: ${state.reason}` }
    } catch (err) {
      // Not knowing is not a failure: keep reading the chain
      console.log(`DEBUG (ensureResources): could not read ${provider.name} order ${orderId}`, err)
    }
  }
  throw new Error(`${provider.name} order ${orderId} for ${address} did not deliver enough ${resource} within ${provider.deliveryTimeoutMs / 1000}s`)
}

// Rents from the first provider that delivers. A refusal, or an order its
// provider says failed, moves on to the next one; a throw or a wait that runs
// out may leave an order behind, so it is never followed by another provider's.
async function rentAndWait(resource: ResourceType, address: string, amountNeeded: number, shortfall: number) {
  const providers = providersFor(resource)
  const reasons: string[] = []
  for (const [i, provider] of providers.entries()) {
    const amount = Math.max(withMargin(shortfall), provider.minimum(resource))
    const outcome = await provider.rent({ resource, receiver: address, amount })
    let reason: string
    if (outcome.status === 'placed') {
      console.log(`DEBUG (ensureResources): ${provider.name} ${resource} order created for ${address}: short by ${shortfall}, renting ${amount}. orderId=${outcome.orderId}`)
      const delivery = await waitForDelivery(provider, outcome.orderId, resource, address, amountNeeded)
      if (delivery.delivered) {
        console.log(`ENERGY_RENTED provider=${provider.name} resource=${resource} amount=${amount} costSun=${outcome.costSun ?? 'unknown'} address=${address} orderId=${outcome.orderId} available=${delivery.available}`)
        return
      }
      reason = delivery.reason
    } else {
      reason = outcome.reason
    }
    reasons.push(`${provider.name}: ${reason}`)
    const next = providers[i + 1]
    if (next) console.log(`ENERGY_FALLBACK from=${provider.name} to=${next.name} resource=${resource} address=${address} reason=${reason}`)
  }
  throw new Error(`No provider can rent ${resource} for ${address} right now (${reasons.join('; ')})`)
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

  await rentAndWait(resource, address, amountNeeded, amountNeeded - rentablePoolOf(resource, before))
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
