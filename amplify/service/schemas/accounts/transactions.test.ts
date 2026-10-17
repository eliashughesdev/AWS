import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './transactions.json'
import details from './details.json'

const accountNumber = 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4'

describe('POST /accounts/transactions body', () => {
  it('accepts an account number', () => {
    expect(checkBodyAgainstSchema({ accountNumber }, schema)).toEqual({ valid: true })
  })

  it('requires accountNumber', () => {
    expect(checkBodyAgainstSchema({}, schema)).toEqual({ valid: false, code: 100029, message: 'accountNumber' })
  })

  it.each([
    ['the ACCOUNT# prefix', `ACCOUNT#${accountNumber}`],
    ['an empty string', ''],
    ['a number', 42],
  ])('refuses %s', (_, value) => {
    expect(checkBodyAgainstSchema({ accountNumber: value }, schema)).toEqual({ valid: false, code: 100031, message: 'accountNumber' })
  })

  // The dashboard reads an account's details and its transactions by the same number
  it('takes accountNumber as /accounts/details does', () => {
    expect(schema.properties.accountNumber).toEqual(details.properties.accountNumber)
  })
})
