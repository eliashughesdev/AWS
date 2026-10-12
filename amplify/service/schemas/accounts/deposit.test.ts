import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './deposit.json'
import details from './details.json'

const valid = { accountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4', currency: 'USD', amount: 50, paymentId: 'card_1' }
const required = { valid: false, code: 100029, message: 'accountNumber,currency,amount,paymentId' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /accounts/deposit body', () => {
  it.each([
    ['the required fields', valid],
    ['a fractional amount', { ...valid, amount: 12.34 }],
    // What the dashboard sends, userId included (the handler takes the user from the authorizer)
    ['the dashboard\'s request', { ...valid, userId: 'u1', email: 'juan@example.com', transactionId: 'dep_1' }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['accountNumber', 'currency', 'amount', 'paymentId'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual(required)
  })

  it.each([
    ['a zero amount', { amount: 0 }, 'amount'],
    ['a negative amount', { amount: -10 }, 'amount'],
    ['an amount sent as a string', { amount: '50' }, 'amount'],
    ['a lowercase currency', { currency: 'usd' }, 'currency'],
    ['a currency that is not a 3-letter code', { currency: 'USDT' }, 'currency'],
    ['an empty paymentId', { paymentId: '' }, 'paymentId'],
    ['an empty transactionId', { transactionId: '' }, 'transactionId'],
    ['an email without a domain', { email: 'juan@' }, 'email'],
    ['an account number with the ACCOUNT# prefix', { accountNumber: 'ACCOUNT#PCF00018604bbd641df4bb0aa5243e1e78f5cc4' }, 'accountNumber'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })

  it('takes accountNumber as the other account routes do', () => {
    expect(schema.properties.accountNumber).toEqual(details.properties.accountNumber)
  })
})
