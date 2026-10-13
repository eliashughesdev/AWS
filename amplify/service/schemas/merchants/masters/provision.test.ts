import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './provision.json'

const valid = { merchantId: 'mrc_0123456789abcdef', currency: 'USDT_TRON' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /merchants/masters/provision body', () => {
  it.each([
    ['a registered merchant', valid],
    // Merchants from before /merchants/register have ids of other shapes
    ['the system merchant', { merchantId: 'internal-001', currency: 'TRON' }],
    ['every currency', { ...valid, currency: 'TUSDT_TRON' }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['merchantId', 'currency'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual({ valid: false, code: 100029, message: 'merchantId,currency' })
  })

  it.each([
    ['an empty merchantId', { merchantId: '' }, 'merchantId'],
    ['a merchantId of 129 characters', { merchantId: 'a'.repeat(129) }, 'merchantId'],
    ['a numeric merchantId', { merchantId: 42 }, 'merchantId'],
    ['an unknown currency', { currency: 'BTC' }, 'currency'],
    // MASTER#usdt_tron would never be found by getMasterAccount
    ['a lower-case currency', { currency: 'usdt_tron' }, 'currency'],
    ['a list of currencies', { currency: ['TRON'] }, 'currency'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
