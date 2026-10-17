import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './transfer.json'
import details from './details.json'
import account from './account.json'

const valid = {
  provider: 'PCF0001',
  senderAccountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4',
  recipientAccountNumber: 'PCF0001a1b2c3d4e5f60718293a4b5c6d7e8f90',
  amount: '12.5',
}
const required = { valid: false, code: 100029, message: 'provider,senderAccountNumber,recipientAccountNumber,amount' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /accounts/transfer body', () => {
  it.each([
    ['a decimal amount', '12.5'],
    ['a whole amount', '100'],
    ['a small amount', '0.000001'],
    ['an amount with trailing zeros', '1.50'],
    // What the dashboard sends: amount.toString() of a number
    ['the dashboard\'s amount', (0.25).toString()],
  ])('accepts %s', (_, amount) => {
    expect(checkBodyAgainstSchema({ ...valid, amount }, schema)).toEqual({ valid: true })
  })

  it.each(['provider', 'senderAccountNumber', 'recipientAccountNumber', 'amount'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual(required)
  })

  // Regression: nothing checked the amount before the ledger and the balance update saw it
  it.each([
    ['a zero amount', '0'],
    ['a zero amount with decimals', '0.000'],
    ['a negative amount', '-5'],
    ['an amount with a plus sign', '+5'],
    ['an amount in exponent form', (1e-7).toString()],
    ['an amount with a leading zero', '012'],
    ['an amount without a whole part', '.5'],
    ['an amount ending in a point', '5.'],
    ['an amount with a comma', '1,5'],
    ['an amount with spaces', ' 5'],
    ['an amount sent as a number', 5],
    ['an empty amount', ''],
    ['an amount longer than the ledger takes', '1'.repeat(39)],
  ])('refuses %s', (_, amount) => {
    expect(checkBodyAgainstSchema({ ...valid, amount }, schema)).toEqual(invalid('amount'))
  })

  it.each([
    ['an unknown provider', { provider: 'PCF9999' }, 'provider'],
    ['a sender with the ACCOUNT# prefix', { senderAccountNumber: `ACCOUNT#${valid.senderAccountNumber}` }, 'senderAccountNumber'],
    ['a recipient that is not an account number', { recipientAccountNumber: 'TQ5n8aV7xY3m2kP9wR4sJ6tL1cE8bH7dG2' }, 'recipientAccountNumber'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })

  it('takes account numbers and the provider as the other account routes do', () => {
    expect(schema.properties.senderAccountNumber).toEqual(details.properties.accountNumber)
    expect(schema.properties.recipientAccountNumber).toEqual(details.properties.accountNumber)
    expect(schema.properties.provider).toEqual(account.properties.provider)
  })
})
