import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './withdraw.json'
import details from './details.json'

const base = {
  accountNumber: 'PCF00018604bbd641df4bb0aa5243e1e78f5cc4',
  destinationAddress: 'TQ5n8aV7xY3m2kP9wR4sJ6tL1cE8bH7dG2',
}
const inUsd = { ...base, currency: 'USD', amount: 20 }
const inCoin = { ...base, currency: 'TRON', cryptoAmount: 25 }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /accounts/withdraw body', () => {
  it.each([
    ['an amount in US dollars', inUsd],
    ['an amount in the coin', inCoin],
    ['a token amount', { ...base, currency: 'USDT_TRON', cryptoAmount: 10.5 }],
    // The dashboard's request, userId and transactionId included
    ['the dashboard\'s request', { ...inCoin, userId: 'u1', transactionId: 'wdr_1' }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['accountNumber', 'currency', 'destinationAddress'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...inCoin, [field]: undefined }, schema))
      .toEqual({ valid: false, code: 100029, message: 'accountNumber,currency,destinationAddress' })
  })

  // Regression: with neither, the debit was NaN
  it('requires amount or cryptoAmount', () => {
    expect(checkBodyAgainstSchema({ ...base, currency: 'USD' }, schema))
      .toEqual({ valid: false, code: 100029, message: 'amount or cryptoAmount' })
  })

  it('refuses both amount and cryptoAmount', () => {
    expect(checkBodyAgainstSchema({ ...inUsd, cryptoAmount: 25 }, schema))
      .toEqual({ valid: false, code: 100031, message: 'amount or cryptoAmount: send only one' })
  })

  // Regression: a negative amount passed availableBalance >= amount and raised the balance
  it.each([
    ['a negative cryptoAmount', { ...inCoin, cryptoAmount: -25 }, 'cryptoAmount'],
    ['a zero cryptoAmount', { ...inCoin, cryptoAmount: 0 }, 'cryptoAmount'],
    ['a cryptoAmount sent as a string', { ...inCoin, cryptoAmount: '25' }, 'cryptoAmount'],
    ['a negative amount', { ...inUsd, amount: -20 }, 'amount'],
    ['a zero amount', { ...inUsd, amount: 0 }, 'amount'],
    ['a fiat amount in a currency that is not a 3-letter code', { ...inUsd, currency: 'TRON' }, 'currency'],
    ['a fiat amount in a lowercase currency', { ...inUsd, currency: 'usd' }, 'currency'],
    ['an empty destination', { ...inCoin, destinationAddress: '' }, 'destinationAddress'],
    ['a destination longer than any address', { ...inCoin, destinationAddress: 'T'.repeat(129) }, 'destinationAddress'],
    ['an empty transactionId', { ...inCoin, transactionId: '' }, 'transactionId'],
    ['an account number with the ACCOUNT# prefix', { ...inCoin, accountNumber: `ACCOUNT#${base.accountNumber}` }, 'accountNumber'],
  ])('refuses %s', (_, body, field) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual(invalid(field))
  })

  it('takes accountNumber as the other account routes do', () => {
    expect(schema.properties.accountNumber).toEqual(details.properties.accountNumber)
  })
})
