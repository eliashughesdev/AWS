import ListMerchantsHandler from './list'
import { scanItems } from '../../../utils/db'

jest.mock('../../../utils/db', () => ({ scanItems: jest.fn() }))

const profile = (id: string, createdAt: string, extra: Record<string, any> = {}) =>
  ({ id, sk: 'PROFILE', name: `Name of ${id}`, status: 'active', accountingCurrency: 'EUR', createdBy: 'staff-1', createdAt, ...extra })

const master = (id: string, currency: string, extra: Record<string, any> = {}) =>
  ({ id, sk: `MASTER#${currency}`, currency, status: 'ready', depositAddress: `T-${id}-${currency}`, vAccountId: 'va-1', keyModel: 'hd', derivationIndex: 0, assigned: true, ...extra })

const list = async () => {
  const res = await new ListMerchantsHandler().execute({}, {} as any)
  return { statusCode: res.statusCode, body: JSON.parse(res.body) }
}

describe('GET /merchants/list', () => {
  it('reads only the profile and master rows', async () => {
    jest.mocked(scanItems).mockResolvedValue({ success: true, res: [] })
    await list()
    expect(scanItems).toHaveBeenCalledWith('v1MerchantTable', 'sk = :profile OR begins_with(sk, :master)', { ':profile': 'PROFILE', ':master': 'MASTER#' })
  })

  it('answers each merchant with its own currencies, newest merchant first', async () => {
    jest.mocked(scanItems).mockResolvedValue({
      success: true,
      res: [
        master('mrc_old', 'USDT_TRON'),
        profile('mrc_old', '2026-10-01T00:00:00.000Z'),
        profile('mrc_new', '2026-10-12T00:00:00.000Z'),
        master('mrc_new', 'USDT_TRON'),
        master('mrc_new', 'TUSDT_TRON'),
      ],
    })

    const { statusCode, body } = await list()

    expect(statusCode).toBe(200)
    expect(body.merchants).toEqual([
      {
        merchantId: 'mrc_new',
        name: 'Name of mrc_new',
        status: 'active',
        accountingCurrency: 'EUR',
        createdAt: '2026-10-12T00:00:00.000Z',
        currencies: [
          { currency: 'TUSDT_TRON', status: 'ready', depositAddress: 'T-mrc_new-TUSDT_TRON' },
          { currency: 'USDT_TRON', status: 'ready', depositAddress: 'T-mrc_new-USDT_TRON' },
        ],
      },
      {
        merchantId: 'mrc_old',
        name: 'Name of mrc_old',
        status: 'active',
        accountingCurrency: 'EUR',
        createdAt: '2026-10-01T00:00:00.000Z',
        currencies: [{ currency: 'USDT_TRON', status: 'ready', depositAddress: 'T-mrc_old-USDT_TRON' }],
      },
    ])
  })

  // toEqual above already fails on an extra field; this names the ones that must never leave
  it('never answers a master\'s Tatum account, key model or derivation index', async () => {
    jest.mocked(scanItems).mockResolvedValue({ success: true, res: [profile('mrc_a', '2026-10-01T00:00:00.000Z'), master('mrc_a', 'USDT_TRON')] })
    const { body } = await list()
    expect(JSON.stringify(body)).not.toMatch(/vAccountId|va-1|keyModel|derivationIndex|createdBy/)
  })

  it('answers a master that is still being provisioned, with no address yet', async () => {
    jest.mocked(scanItems).mockResolvedValue({
      success: true,
      res: [profile('mrc_a', '2026-10-01T00:00:00.000Z'), master('mrc_a', 'USDT_TRON', { status: 'provisioning', depositAddress: undefined })],
    })
    const { body } = await list()
    expect(body.merchants[0].currencies).toEqual([{ currency: 'USDT_TRON', status: 'provisioning', depositAddress: null }])
  })

  it('answers a merchant with no master, and leaves out a master with no merchant', async () => {
    jest.mocked(scanItems).mockResolvedValue({ success: true, res: [profile('mrc_a', '2026-10-01T00:00:00.000Z'), master('mrc_gone', 'USDT_TRON')] })
    const { body } = await list()
    expect(body.merchants).toHaveLength(1)
    expect(body.merchants[0]).toMatchObject({ merchantId: 'mrc_a', currencies: [] })
  })

  it('answers USD and a null date for a profile that has neither', async () => {
    jest.mocked(scanItems).mockResolvedValue({ success: true, res: [profile('mrc_a', '2026-10-01T00:00:00.000Z', { accountingCurrency: undefined, createdAt: undefined })] })
    const { body } = await list()
    expect(body.merchants[0]).toMatchObject({ accountingCurrency: 'USD', createdAt: null })
  })

  it('answers 500 when the table cannot be read, not an empty list', async () => {
    jest.mocked(scanItems).mockResolvedValue({ success: false, res: null })
    const { statusCode, body } = await list()
    expect(statusCode).toBe(500)
    expect(body).toEqual({ error_code: 100002, message: 'internal error while processing the request' })
  })
})
