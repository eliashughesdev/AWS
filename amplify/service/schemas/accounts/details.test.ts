import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './details.json'

const accountNumber = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'
const invalid = { valid: false, code: 100031, message: 'accountNumber' }

describe('POST /accounts/details body', () => {
  it.each([
    ['an account number', accountNumber],
    ['another provider\'s account number', 'PCF00028604bbd641df4bb0aa5243e1e78f5cc4'],
  ])('accepts %s', (_, value) => {
    expect(checkBodyAgainstSchema({ accountNumber: value }, schema)).toEqual({ valid: true })
  })

  // Regression: account_id took the full key, ACCOUNT#<number> (c6aab29)
  it('refuses the old account_id', () => {
    expect(checkBodyAgainstSchema({ account_id: `ACCOUNT#${accountNumber}` }, schema))
      .toEqual({ valid: false, code: 100029, message: 'accountNumber' })
  })

  it.each([
    ['the ACCOUNT# prefix', `ACCOUNT#${accountNumber}`],
    ['a prefix other than PCF', 'XYZ00018604bbd641df4bb0aa5243e1e78f5cc4'],
    ['uppercase hex', accountNumber.toUpperCase()],
    ['a short id', accountNumber.slice(0, 20)],
    ['an empty string', ''],
    ['a number', 42],
  ])('refuses %s', (_, value) => {
    expect(checkBodyAgainstSchema({ accountNumber: value }, schema)).toEqual(invalid)
  })
})
