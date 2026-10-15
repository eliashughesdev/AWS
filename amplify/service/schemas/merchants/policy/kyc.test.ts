import { checkBodyAgainstSchema } from '../../../../utils/schema'
import { LEDGER_CURRENCY_IDS } from '../../../../utils/currencies'
import schema from './kyc.json'

const valid = { merchantId: 'internal-001', currency: 'USDT_TRON', withdraw: false }

describe('POST /merchants/policy/kyc body', () => {
  it.each([
    ['one switch', valid],
    ['all three', { ...valid, transfer: true, cardDeposit: false }],
    ['a switch turned on', { merchantId: 'internal-001', currency: 'SOL', transfer: true }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it('names every ledger currency the backend knows, and only those', () => {
    expect([...schema.properties.currency.enum].sort()).toEqual([...LEDGER_CURRENCY_IDS].sort())
  })

  it.each(['merchantId', 'currency'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual({ valid: false, code: 100029, message: 'merchantId,currency' })
  })

  it('requires at least one switch', () => {
    expect(checkBodyAgainstSchema({ merchantId: 'internal-001', currency: 'SOL' }, schema))
      .toEqual({ valid: false, code: 100029, message: 'withdraw or transfer or cardDeposit' })
  })

  it.each([
    ['a lower-case currency', { currency: 'usdt_tron' }, 'currency'],
    ['an unknown currency', { currency: 'BTC' }, 'currency'],
    ['a switch that is not a boolean', { withdraw: 'false' }, 'withdraw'],
    ['an unknown operation', { deposit: true }, 'deposit'],
    ['an empty merchantId', { merchantId: '' }, 'merchantId'],
  ])('refuses %s with 100031', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual({ valid: false, code: 100031, message: field })
  })
})
