import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './account.json'

const valid = { accountName: 'Savings', chain: 'USDT_TRON', provider: 'PCF0001', accountingCurrency: 'USD' }
const required = { valid: false, code: 100029, message: 'accountName,chain,provider,accountingCurrency' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /accounts/account body', () => {
  it.each([
    ['the four required fields', valid],
    ['an email', { ...valid, email: 'anEmail@email.com' }],
    // The dashboard sends userId; the handler takes the user from the authorizer instead
    ['fields the schema does not name', { ...valid, userId: 'u1' }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['accountName', 'chain', 'provider', 'accountingCurrency'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual(required)
  })

  // Regression: renamed from snake_case (c6aab29)
  it('refuses the old snake_case names', () => {
    const body = { account_name: 'Savings', chain: 'USDT_TRON', provider: 'PCF0001', accounting_currency: 'USD' }
    expect(checkBodyAgainstSchema(body, schema)).toEqual(required)
  })

  it.each([
    ['an empty accountName', { accountName: '' }, 'accountName'],
    ['a numeric accountName', { accountName: 42 }, 'accountName'],
    ['an unknown provider', { provider: 'PCF9999' }, 'provider'],
    ['an empty email', { email: '' }, 'email'],
    ['an email without @', { email: 'not-an-email' }, 'email'],
    ['an email without a dot in its domain', { email: 'a@b' }, 'email'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
