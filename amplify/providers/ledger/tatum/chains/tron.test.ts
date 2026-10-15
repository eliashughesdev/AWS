import axios from 'axios'
import {
  buildTronSweep, getTronTransactionFee, isTronAccountActive,
  tronBandwidthBytes, tronBandwidthCovered, tronBandwidthFeeSun, tronSweepAmount,
} from './tron'

jest.mock('axios')
const post = axios.post as jest.Mock
const get = axios.get as jest.Mock

// Signed TRX transfers on Shasta and what their receipts charged
// (gettransactioninfobyid), the chain's price being 1000 sun per byte
const SHASTA = {
  // 0.1 TRX, free bandwidth: net_usage 267
  free: '0a02632f2208aa2f6994c7ee86c240f88fefc38b345a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541c8599111f29c1e1e061265b4af93ea1f274ad78a121541977f82c69011cf4a7db6f7339edcded85c614d4518a08d067098bbebc38b34',
  // 7475 sun, free bandwidth: net_usage 266
  freeSmall: '0a022a4a22085517232957d2a65d40b0eabef2d0335a66080112620a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412310a1541c40b333ce0bf38611ff1f78030dac3d9451930ff121541160e23917c48cc09cd6d2530dba6d925b0f5ea1f18b33a70e799bbf2d033',
  // 149.499178 TRX, burned: fee and net_fee 268000
  burned: '0a022a5d22089cfeefa1eee22e5440d8a7c2f2d0335a68080112640a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412330a1541c40b333ce0bf38611ff1f78030dac3d9451930ff121541160e23917c48cc09cd6d2530dba6d925b0f5ea1f18aadaa44770dde8bef2d033',
  // 2000 TRX, burned: fee and net_fee 269000
  burnedLarge: '0a027996220835ecf5e3d4d508424090c3ecdd93345a69080112650a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412340a1541d3682962027e721c5247a9faf7865fe4a71d5438121541d589203d2652720e05476d467aca9180e941a0841880a8d6b9077082f8e8dd9334',
}
const PRICE = 1000
const none = { freeBandwidthAvailable: 0, stakedBandwidthAvailable: 0 }

describe('tronBandwidthBytes', () => {
  it.each([
    ['12b9f5c4… (free)', SHASTA.free, 267],
    ['5bf51a05… (free)', SHASTA.freeSmall, 266],
    ['cb6ee01e… (burned)', SHASTA.burned, 268],
    ['71a2624a… (burned)', SHASTA.burnedLarge, 269],
  ])('matches the receipt of Shasta tx %s', (_, raw, bytes) => {
    expect(tronBandwidthBytes({ raw_data_hex: raw })).toBe(bytes)
  })
})

describe('tronBandwidthCovered', () => {
  it('takes a pool that covers every byte', () => {
    expect(tronBandwidthCovered({ freeBandwidthAvailable: 267, stakedBandwidthAvailable: 0 }, 267)).toBe(true)
    expect(tronBandwidthCovered({ freeBandwidthAvailable: 0, stakedBandwidthAvailable: 300 }, 267)).toBe(true)
  })

  it('never adds the pools together', () => {
    expect(tronBandwidthCovered({ freeBandwidthAvailable: 200, stakedBandwidthAvailable: 200 }, 267)).toBe(false)
  })
})

describe('tronBandwidthFeeSun', () => {
  it('is 0 when a pool covers the bytes', () => {
    expect(tronBandwidthFeeSun(267, { freeBandwidthAvailable: 600, stakedBandwidthAvailable: 0 }, PRICE)).toBe(0)
  })

  it('burns every byte at the price otherwise, as Shasta tx cb6ee01e did', () => {
    expect(tronBandwidthFeeSun(tronBandwidthBytes({ raw_data_hex: SHASTA.burned }), none, PRICE)).toBe(268_000)
  })
})

describe('tronSweepAmount', () => {
  // A transfer's raw_data is 130 bytes plus its amount's varint (Shasta tx 12b9f5c4)
  it('sends the whole balance when the free allowance covers it', () => {
    expect(tronSweepAmount(149_767_178, 134, { freeBandwidthAvailable: 600, stakedBandwidthAvailable: 0 }, PRICE))
      .toEqual({ amountSun: 149_767_178, feeSun: 0 })
  })

  it('sends the balance minus the burned fee, leaving 0', () => {
    expect(tronSweepAmount(149_767_178, 134, none, PRICE)).toEqual({ amountSun: 149_499_178, feeSun: 268_000 })
  })

  it('counts the byte saved when the amount drops below 2^21 sun', () => {
    // 2.3 TRX takes 4 varint bytes, 2.033 TRX takes 3: 267 bytes, not 268
    expect(tronSweepAmount(2_300_000, 134, none, PRICE)).toEqual({ amountSun: 2_033_000, feeSun: 267_000 })
  })

  it('leaves less than one byte\'s price when no amount empties the address', () => {
    // With 4 bytes the amount falls under 2^21; with 3 it would have to exceed it
    expect(tronSweepAmount(2_364_500, 134, none, PRICE)).toEqual({ amountSun: 2_097_151, feeSun: 267_000 })
  })

  it('burns rather than leave coins when the free allowance is a byte short', () => {
    expect(tronSweepAmount(3_000_000, 134, { freeBandwidthAvailable: 267, stakedBandwidthAvailable: 0 }, PRICE))
      .toEqual({ amountSun: 2_732_000, feeSun: 268_000 })
  })

  it('is null when the balance cannot pay the fee', () => {
    expect(tronSweepAmount(200_000, 133, none, PRICE)).toBeNull()
  })
})

describe('buildTronSweep', () => {
  const nodeAnswers = (balanceSun: number, freeNetUsed: number) => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith('/tron/account/TSender')) return { data: { balance: balanceSun } }
      if (url.endsWith('/getchainparameters')) return { data: { chainParameter: [{ key: 'getTransactionFee', value: PRICE }] } }
      throw new Error(`unexpected GET ${url}`)
    })
    post.mockImplementation(async (url: string, body: any) => {
      if (url.endsWith('/getaccountresource')) return { data: { freeNetLimit: 600, freeNetUsed } }
      if (url.endsWith('/createtransaction')) {
        // Shasta tx cb6ee01e's raw_data with the amount's varint resized
        const varint = body.amount >= 2 ** 28 ? 5 : body.amount >= 2 ** 21 ? 4 : 3
        return { data: { txID: `tx-${body.amount}`, raw_data_hex: 'ab'.repeat(130 + varint) } }
      }
      throw new Error(`unexpected POST ${url}`)
    })
  }

  it('builds the whole balance when the free allowance covers it', async () => {
    nodeAnswers(149_767_178, 0)
    const sweep = await buildTronSweep('TSender', 'TMaster')
    expect(sweep).toMatchObject({ amountSun: 149_767_178, feeSun: 0, tx: { txID: 'tx-149767178' } })
    expect(post.mock.calls.filter(([url]) => url.endsWith('/createtransaction'))).toHaveLength(1)
  })

  it('rebuilds for the balance minus the fee, and signs nothing', async () => {
    nodeAnswers(2_300_000, 600)
    const sweep = await buildTronSweep('TSender', 'TMaster')
    expect(sweep).toMatchObject({ amountSun: 2_033_000, feeSun: 267_000, tx: { txID: 'tx-2033000' } })
    expect(post).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/createtransaction$/),
      { owner_address: 'TSender', to_address: 'TMaster', amount: 2_033_000, visible: true },
      expect.anything()
    )
  })

  it('is null for an empty address, without building', async () => {
    nodeAnswers(0, 600)
    expect(await buildTronSweep('TSender', 'TMaster')).toBeNull()
    expect(post.mock.calls.filter(([url]) => url.endsWith('/createtransaction'))).toHaveLength(0)
  })
})

describe('isTronAccountActive', () => {
  it('is false for the {} the node answers for an address never used', async () => {
    post.mockResolvedValue({ data: {} })
    expect(await isTronAccountActive('TEcy7JDxPxZbURB9k6cBiPemK92kt78Rwc')).toBe(false)
  })

  it('is true for an account, even an empty one', async () => {
    post.mockResolvedValue({ data: { address: 'TBypofoy6CJaSY1VrcrUjgFzDCNer7iVLW', create_time: 1774061511000 } })
    expect(await isTronAccountActive('TBypofoy6CJaSY1VrcrUjgFzDCNer7iVLW')).toBe(true)
  })
})

describe('getTronTransactionFee', () => {
  it.each([
    ['free bandwidth leaves fee out', { id: '12b9f5c4', blockNumber: 68510513, receipt: { net_usage: 267 } }, 0],
    ['burned bandwidth', { id: 'cb6ee01e', fee: 268000, blockNumber: 63318641, receipt: { net_fee: 268000 } }, 0.268],
    ['an activation counts too', { id: '66b78315', fee: 1100000, blockNumber: 63318612, receipt: { net_fee: 100000 } }, 1.1],
    ['not in a block yet', {}, null],
  ])('reads the receipt: %s', async (_, data, fee) => {
    post.mockResolvedValue({ data })
    expect(await getTronTransactionFee('txid')).toBe(fee)
  })
})
