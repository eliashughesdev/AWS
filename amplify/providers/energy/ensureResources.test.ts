import { getTronBalance, getTronBandwidthPriceSun, getTronResources, type TronResources } from '../ledger/tatum/chains/tron'
import { ensureBandwidth, ensureEnergy } from './ensureResources'
import { TronSaveProvider } from './tronsave/tronsave'

jest.mock('../ledger/tatum/chains/tron', () => ({ getTronResources: jest.fn(), getTronBalance: jest.fn(), getTronBandwidthPriceSun: jest.fn() }))

// The provider list is [TronSave]: its API is stubbed, so it stands for any provider
const rent = jest.spyOn(TronSaveProvider.prototype, 'rent')
const minimum = jest.spyOn(TronSaveProvider.prototype, 'minimum')

const resources = (r: Partial<TronResources>): TronResources =>
  ({ energyLimit: 0, energyAvailable: 0, freeBandwidthAvailable: 0, stakedBandwidthAvailable: 0, ...r })

// What the address reads: the first answer before the order, the rest while waiting
const reads = (...answers: Partial<TronResources>[]) => {
  answers.forEach((a) => (getTronResources as jest.Mock).mockResolvedValueOnce(resources(a)))
  ;(getTronResources as jest.Mock).mockResolvedValue(resources(answers[answers.length - 1]))
}

beforeEach(() => {
  jest.useFakeTimers()
  ;(getTronResources as jest.Mock).mockReset()
  rent.mockResolvedValue({ status: 'placed', orderId: 'order-1' })
  minimum.mockReturnValue(0)
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
    expect(rent).not.toHaveBeenCalled()
  })

  it.each([
    [10_000, 64_285, 54_828], // 54,285 × 1.01 = 54,827.85
    [0, 100, 101], // not 102: 100 × 1.01 is 101.00000000000001 in floats
  ])('orders the shortfall plus 1%%, rounded up (has %d, needs %d)', async (has, needs, ordered) => {
    reads({ energyAvailable: has }, { energyAvailable: needs })
    expect(await settle(ensureEnergy('TSender', needs))).toBe('resolved')
    expect(rent).toHaveBeenCalledWith({ resource: 'ENERGY', receiver: 'TSender', amount: ordered })
  })

  it('raises the order to the provider\'s minimum', async () => {
    minimum.mockReturnValue(65_000)
    reads({ energyAvailable: 64_185 }, { energyAvailable: 129_185 })
    expect(await settle(ensureEnergy('TSender', 64_285))).toBe('resolved')
    expect(minimum).toHaveBeenCalledWith('ENERGY')
    expect(rent).toHaveBeenCalledWith(expect.objectContaining({ amount: 65_000 }))
  })

  it('resolves once the energy arrives', async () => {
    reads({ energyAvailable: 0 }, { energyAvailable: 0 }, { energyAvailable: 0 }, { energyAvailable: 64_928 })
    expect(await settle(ensureEnergy('TSender', 64_285), 6000)).toBe('resolved')
    expect(getTronResources).toHaveBeenCalledTimes(4)
  })

  it('gives up when the order has not delivered after 120 s', async () => {
    reads({ energyAvailable: 0 })
    const err = await settle(ensureEnergy('TSender', 64_285), 120_000)
    expect(err).toEqual(new Error('TronSave order order-1 for TSender did not deliver enough ENERGY within 120s'))
  })

  it('throws, without waiting, when every provider refuses', async () => {
    rent.mockResolvedValue({ status: 'refused', reason: 'only 0 ENERGY available' })
    reads({ energyAvailable: 0 })
    await expect(ensureEnergy('TSender', 64_285)).rejects.toThrow('No provider can rent ENERGY for TSender right now (TronSave: only 0 ENERGY available)')
    expect(getTronResources).toHaveBeenCalledTimes(1)
  })
})

describe('ensureBandwidth', () => {
  it('orders nothing when one pool covers the whole transaction', async () => {
    reads({ freeBandwidthAvailable: 600, stakedBandwidthAvailable: 0 })
    await ensureBandwidth('TSender', 345)
    expect(rent).not.toHaveBeenCalled()
  })

  it('burns instead of renting when the address\'s TRX covers the burn', async () => {
    reads({})
    ;(getTronBalance as jest.Mock).mockResolvedValue(0.35) // 345 × 1000 sun + 1% = 0.348450 TRX
    await ensureBandwidth('TSender', 345)
    expect(rent).not.toHaveBeenCalled()
  })

  it('rents the staked pool\'s shortfall when the address can\'t burn', async () => {
    ;(getTronBalance as jest.Mock).mockResolvedValue(0.348)
    reads({ freeBandwidthAvailable: 300, stakedBandwidthAvailable: 100 }, { stakedBandwidthAvailable: 348 })
    expect(await settle(ensureBandwidth('TSender', 345))).toBe('resolved')
    // Rented Bandwidth lands in the staked pool: 345 − 100 = 245, plus 1%
    expect(rent).toHaveBeenCalledWith({ resource: 'BANDWIDTH', receiver: 'TSender', amount: 248 })
  })
})
