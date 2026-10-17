import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './register.json'

const valid = { name: 'Acme Payments', currencies: ['TRON', 'USDT_TRON'], accountingCurrency: 'EUR' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /merchants/register body', () => {
  it.each([
    ['every field', valid],
    ['a name alone', { name: 'Acme' }],
    ['no currencies', { name: 'Acme', currencies: [] }],
    ['a name of 100 characters', { name: 'a'.repeat(100) }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it('requires name', () => {
    expect(checkBodyAgainstSchema({ ...valid, name: undefined }, schema)).toEqual({ valid: false, code: 100029, message: 'name' })
  })

  it.each([
    ['an empty name', { name: '' }, 'name'],
    ['a blank name', { name: '   ' }, 'name'],
    ['a name of 101 characters', { name: 'a'.repeat(101) }, 'name'],
    ['a numeric name', { name: 42 }, 'name'],
    ['currencies that are not a list', { currencies: 'TRON' }, 'currencies'],
    ['an unknown currency', { currencies: ['BTC'] }, 'currencies.0'],
    // MASTER#usdt_tron would never be found by getMasterAccount
    ['a lower-case currency', { currencies: ['usdt_tron'] }, 'currencies.0'],
    ['a lower-case accountingCurrency', { accountingCurrency: 'usd' }, 'accountingCurrency'],
    ['an empty accountingCurrency', { accountingCurrency: '' }, 'accountingCurrency'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
