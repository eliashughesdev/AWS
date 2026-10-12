import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './rename.json'

const accountNumber = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'
const valid = { accountNumber, name: 'Savings' }
const required = { valid: false, code: 100029, message: 'accountNumber,name' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /accounts/rename body', () => {
  it.each([
    ['a name', valid],
    // An empty name removes the one the account has
    ['an empty name', { accountNumber, name: '' }],
    ['a name of 40 characters', { accountNumber, name: 'a'.repeat(40) }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['accountNumber', 'name'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual(required)
  })

  it.each([
    ['a name of 41 characters', { name: 'a'.repeat(41) }, 'name'],
    ['a numeric name', { name: 42 }, 'name'],
    ['a null name', { name: null }, 'name'],
    ['the ACCOUNT# prefix', { accountNumber: `ACCOUNT#${accountNumber}` }, 'accountNumber'],
    ['a short account number', { accountNumber: accountNumber.slice(0, 20) }, 'accountNumber'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
