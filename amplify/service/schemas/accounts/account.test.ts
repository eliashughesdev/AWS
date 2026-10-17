import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './account.json'

const unnamed = { chain: 'USDT_TRON', provider: 'PCF0001', accountingCurrency: 'USD' }
const valid = { ...unnamed, accountName: 'Savings' }
const required = { valid: false, code: 100029, message: 'chain,provider,accountingCurrency' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /accounts/account body', () => {
  it.each([
    ['the three required fields', unnamed],
    ['an accountName', valid],
    // A form sends its empty name field; the account then has no name
    ['an empty accountName', { ...unnamed, accountName: '' }],
    ['an accountName of 40 characters', { ...unnamed, accountName: 'a'.repeat(40) }],
    ['an email', { ...valid, email: 'anEmail@email.com' }],
    // The dashboard sends userId; the handler takes the user from the authorizer instead
    ['fields the schema does not name', { ...valid, userId: 'u1' }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['chain', 'provider', 'accountingCurrency'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual(required)
  })

  // Regression: renamed from snake_case (c6aab29)
  it('refuses the old snake_case names', () => {
    const body = { account_name: 'Savings', chain: 'USDT_TRON', provider: 'PCF0001', accounting_currency: 'USD' }
    expect(checkBodyAgainstSchema(body, schema)).toEqual(required)
  })

  it.each([
    ['an accountName of 41 characters', { accountName: 'a'.repeat(41) }, 'accountName'],
    ['a numeric accountName', { accountName: 42 }, 'accountName'],
    ['an unknown provider', { provider: 'PCF9999' }, 'provider'],
    ['an empty email', { email: '' }, 'email'],
    ['an email without @', { email: 'not-an-email' }, 'email'],
    ['an email without a dot in its domain', { email: 'a@b' }, 'email'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
