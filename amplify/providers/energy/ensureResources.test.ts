import { getTronBalance, getTronBandwidthPriceSun, getTronResources, type TronResources } from '../ledger/tatum/chains/tron'
import { CatFeeProvider } from './catfee/catfee'
import { ensureBandwidth, ensureEnergy } from './ensureResources'
import { TronSaveProvider } from './tronsave/tronsave'

jest.mock('../ledger/tatum/chains/tron', () => ({ getTronResources: jest.fn(), getTronBalance: jest.fn(), getTronBandwidthPriceSun: jest.fn() }))

// Both vendors' APIs are stubbed: what is tested is the order they are tried
// in, and what moves on to the next one (energy-rental-plan step 2, D3)
const catfee = {
  rent: jest.spyOn(CatFeeProvider.prototype, 'rent'),
  orderState: jest.spyOn(CatFeeProvider.prototype, 'orderState'),
  minimum: jest.spyOn(CatFeeProvider.prototype, 'minimum'),
}
const tronsave = {
  rent: jest.spyOn(TronSaveProvider.prototype, 'rent'),
  minimum: jest.spyOn(TronSaveProvider.prototype, 'minimum'),
}
const log = jest.spyOn(console, 'log')
const logError = jest.spyOn(console, 'error')
const logged = (prefix: string) => log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith(prefix))

const resources = (r: Partial<TronResources>): TronResources =>
  ({ energyLimit: 0, energyAvailable: 0, freeBandwidthAvailable: 0, stakedBandwidthAvailable: 0, ...r })

// What the address reads: the first answer before the order, the rest while waiting
const reads = (...answers: Partial<TronResources>[]) => {
  answers.forEach((a) => (getTronResources as jest.Mock).mockResolvedValueOnce(resources(a)))
  ;(getTronResources as jest.Mock).mockResolvedValue(resources(answers[answers.length - 1]))
}

beforeEach(() => {
  jest.useFakeTimers()
  delete process.env.TRON_ENERGY_PROVIDERS
  ;(getTronResources as jest.Mock).mockReset()
  Object.values({ ...catfee, ...tronsave }).forEach((spy) => spy.mockReset())
  catfee.rent.mockResolvedValue({ status: 'placed', orderId: 'cf-1', costSun: 1_820_000 })
  catfee.orderState.mockResolvedValue({ status: 'pending' })
  catfee.minimum.mockReturnValue(0)
  tronsave.rent.mockResolvedValue({ status: 'placed', orderId: 'ts-1', costSun: 4_220_320 })
  tronsave.minimum.mockReturnValue(0)
  ;(getTronBalance as jest.Mock).mockResolvedValue(0)
  ;(getTronBandwidthPriceSun as jest.Mock).mockResolvedValue(1000)
})

afterEach(() => jest.useRealTimers())

// Starts a call and lets its polls run, `ms` of them
async function settle(call: Promise<void>, ms = 2000) {
  const result = call.then(() => 'resolved', (err: Error) => err)
  await jest.advanceTimersByTimeAsync(ms)
  return result
}

describe('ensureEnergy', () => {
  it('orders nothing when the address already has enough', async () => {
    reads({ energyAvailable: 64_285 })
    await ensureEnergy('TSender', 64_285)
    expect(catfee.rent).not.toHaveBeenCalled()
    expect(tronsave.rent).not.toHaveBeenCalled()
  })

  it.each([
    [10_000, 64_285, 54_828], // 54,285 × 1.01 = 54,827.85
    [0, 100, 101], // not 102: 100 × 1.01 is 101.00000000000001 in floats
  ])('orders the shortfall plus 1%%, rounded up (has %d, needs %d)', async (has, needs, ordered) => {
    reads({ energyAvailable: has }, { energyAvailable: needs })
    expect(await settle(ensureEnergy('TSender', needs))).toBe('resolved')
    expect(catfee.rent).toHaveBeenCalledWith({ resource: 'ENERGY', receiver: 'TSender', amount: ordered })
  })

  it('raises the order to the provider\'s minimum', async () => {
    catfee.minimum.mockReturnValue(65_000)
    reads({ energyAvailable: 64_185 }, { energyAvailable: 129_185 })
    expect(await settle(ensureEnergy('TSender', 64_285))).toBe('resolved')
    expect(catfee.minimum).toHaveBeenCalledWith('ENERGY')
    expect(catfee.rent).toHaveBeenCalledWith(expect.objectContaining({ amount: 65_000 }))
  })

  it('rents from CatFee first, resolves once the energy arrives, and logs the rental', async () => {
    reads({ energyAvailable: 0 }, { energyAvailable: 0 }, { energyAvailable: 0 }, { energyAvailable: 65_000 })
    expect(await settle(ensureEnergy('TSender', 64_285), 6000)).toBe('resolved')
    expect(getTronResources).toHaveBeenCalledTimes(4)
    expect(tronsave.rent).not.toHaveBeenCalled()
    expect(logged('ENERGY_RENTED')).toEqual([
      'ENERGY_RENTED provider=CatFee resource=ENERGY amount=64928 costSun=1820000 address=TSender orderId=cf-1 available=65000',
    ])
  })

  it('tries the providers in TRON_ENERGY_PROVIDERS order', async () => {
    process.env.TRON_ENERGY_PROVIDERS = ' TronSave , catfee'
    reads({ energyAvailable: 0 }, { energyAvailable: 64_285 })
    expect(await settle(ensureEnergy('TSender', 64_285))).toBe('resolved')
    expect(tronsave.rent).toHaveBeenCalled()
    expect(catfee.rent).not.toHaveBeenCalled()
  })

  it('skips a name it does not know, logging CONFIG_ERROR', async () => {
    process.env.TRON_ENERGY_PROVIDERS = 'catfe,tronsave'
    reads({ energyAvailable: 0 }, { energyAvailable: 64_285 })
    expect(await settle(ensureEnergy('TSender', 64_285))).toBe('resolved')
    expect(tronsave.rent).toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith('CONFIG_ERROR (ensureResources): TRON_ENERGY_PROVIDERS names an unknown provider "catfe"')
  })

  it('throws, without waiting, when every provider refuses', async () => {
    catfee.rent.mockResolvedValue({ status: 'refused', reason: 'POST /v1/order -> 200: code 201 Insufficient balance' })
    tronsave.rent.mockResolvedValue({ status: 'refused', reason: 'only 0 ENERGY available' })
    reads({ energyAvailable: 0 })
    await expect(ensureEnergy('TSender', 64_285)).rejects.toThrow(
      'No provider can rent ENERGY for TSender right now (CatFee: POST /v1/order -> 200: code 201 Insufficient balance; TronSave: only 0 ENERGY available)')
    expect(getTronResources).toHaveBeenCalledTimes(1)
  })
})

// The fallback rules: move on only when nothing was bought or the order can no longer deliver
describe('ensureEnergy falling back from CatFee to TronSave', () => {
  it('falls back when CatFee refuses, ordering TronSave\'s own amount', async () => {
    catfee.minimum.mockReturnValue(65_000)
    catfee.rent.mockResolvedValue({ status: 'refused', reason: 'order cf-1: INSUFFICIENT_BALANCE' })
    reads({ energyAvailable: 0 }, { energyAvailable: 64_928 })
    expect(await settle(ensureEnergy('TSender', 64_285))).toBe('resolved')
    expect(tronsave.rent).toHaveBeenCalledWith({ resource: 'ENERGY', receiver: 'TSender', amount: 64_928 })
    expect(logged('ENERGY_FALLBACK')).toEqual([
      'ENERGY_FALLBACK from=CatFee to=TronSave resource=ENERGY address=TSender reason=order cf-1: INSUFFICIENT_BALANCE',
    ])
    expect(logged('ENERGY_RENTED')).toEqual([expect.stringContaining('ENERGY_RENTED provider=TronSave ')])
  })

  it('falls back when CatFee says a placed order failed to delegate', async () => {
    catfee.orderState.mockResolvedValueOnce({ status: 'pending' }).mockResolvedValueOnce({ status: 'failed', reason: 'DELEGATE_FAIL' })
    reads({ energyAvailable: 0 }, { energyAvailable: 0 }, { energyAvailable: 0 }, { energyAvailable: 64_928 })
    expect(await settle(ensureEnergy('TSender', 64_285), 6000)).toBe('resolved')
    expect(catfee.orderState).toHaveBeenCalledWith('cf-1')
    expect(tronsave.rent).toHaveBeenCalled()
    expect(logged('ENERGY_FALLBACK')).toEqual([
      'ENERGY_FALLBACK from=CatFee to=TronSave resource=ENERGY address=TSender reason=order cf-1 failed: DELEGATE_FAIL',
    ])
  })

  it('does not fall back when CatFee cannot tell whether an order exists', async () => {
    catfee.rent.mockRejectedValue(new Error('CatFee order 1234 for TSender is unclear: POST /v1/order: no answer (fetch failed)'))
    reads({ energyAvailable: 0 })
    await expect(ensureEnergy('TSender', 64_285)).rejects.toThrow('is unclear')
    expect(tronsave.rent).not.toHaveBeenCalled()
  })

  // A pending order, UNKNOWN included, may still deliver: renting again could pay twice
  it('does not fall back when a placed order has not delivered after 60 s', async () => {
    reads({ energyAvailable: 0 })
    const err = await settle(ensureEnergy('TSender', 64_285), 60_000)
    expect(err).toEqual(new Error('CatFee order cf-1 for TSender did not deliver enough ENERGY within 60s'))
    expect(tronsave.rent).not.toHaveBeenCalled()
  })

  it('keeps waiting when CatFee\'s order cannot be read', async () => {
    catfee.orderState.mockRejectedValue(new Error('CatFee could not read order cf-1: GET /v1/order/cf-1: no answer'))
    reads({ energyAvailable: 0 }, { energyAvailable: 0 }, { energyAvailable: 64_928 })
    expect(await settle(ensureEnergy('TSender', 64_285), 4000)).toBe('resolved')
    expect(tronsave.rent).not.toHaveBeenCalled()
  })

  it('gives TronSave 120 s to deliver', async () => {
    process.env.TRON_ENERGY_PROVIDERS = 'tronsave'
    reads({ energyAvailable: 0 })
    const err = await settle(ensureEnergy('TSender', 64_285), 120_000)
    expect(err).toEqual(new Error('TronSave order ts-1 for TSender did not deliver enough ENERGY within 120s'))
  })
})

describe('ensureBandwidth', () => {
  it('orders nothing when one pool covers the whole transaction', async () => {
    reads({ freeBandwidthAvailable: 600, stakedBandwidthAvailable: 0 })
    await ensureBandwidth('TSender', 345)
    expect(tronsave.rent).not.toHaveBeenCalled()
  })

  it('burns instead of renting when the address\'s TRX covers the burn', async () => {
    reads({})
    ;(getTronBalance as jest.Mock).mockResolvedValue(0.35) // 345 × 1000 sun + 1% = 0.348450 TRX
    await ensureBandwidth('TSender', 345)
    expect(tronsave.rent).not.toHaveBeenCalled()
  })

  it('rents the staked pool\'s shortfall from TronSave, since CatFee rents energy only', async () => {
    ;(getTronBalance as jest.Mock).mockResolvedValue(0.348)
    reads({ freeBandwidthAvailable: 300, stakedBandwidthAvailable: 100 }, { stakedBandwidthAvailable: 348 })
    expect(await settle(ensureBandwidth('TSender', 345))).toBe('resolved')
    // Rented Bandwidth lands in the staked pool: 345 − 100 = 245, plus 1%
    expect(tronsave.rent).toHaveBeenCalledWith({ resource: 'BANDWIDTH', receiver: 'TSender', amount: 248 })
    expect(catfee.rent).not.toHaveBeenCalled()
    expect(logged('ENERGY_FALLBACK')).toEqual([])
  })
})
