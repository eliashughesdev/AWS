import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './onboarding.json'

const transaction = { id: 'txn_abc123', amount: 50, currency: 'EUR', paidAt: '2026-09-09T10:22:31Z' }
const valid = { externalId: 'usr_9f3a2b', firstName: 'Juan', lastName: 'Perez', email: 'juan@example.com', chain: 'TRON', transaction }
const required = { valid: false, code: 100029, message: 'externalId,firstName,lastName,email,chain,transaction' }
const transactionRequired = { valid: false, code: 100029, message: 'transaction.id,transaction.amount,transaction.currency' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /accounts/onboarding body', () => {
  it.each([
    ['the documented example', valid],
    ['a transaction without paidAt', { ...valid, transaction: { id: 'txn_1', amount: 0.01, currency: 'EUR' } }],
    // The handler checks support itself (100009) and accepts any case
    ['a chain in lowercase', { ...valid, chain: 'tron' }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['externalId', 'firstName', 'lastName', 'email', 'chain', 'transaction'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual(required)
  })

  // Regression: the handler answered these itself, with 100029 and the three fields
  it.each(['id', 'amount', 'currency'])('requires transaction.%s', field => {
    expect(checkBodyAgainstSchema({ ...valid, transaction: { ...transaction, [field]: undefined } }, schema))
      .toEqual(transactionRequired)
  })

  it.each([
    ['an empty externalId', { externalId: '' }, 'externalId'],
    ['an empty firstName', { firstName: '' }, 'firstName'],
    ['a numeric lastName', { lastName: 7 }, 'lastName'],
    ['an email without a domain', { email: 'juan@' }, 'email'],
    ['an empty chain', { chain: '' }, 'chain'],
    ['a transaction that is not an object', { transaction: 'txn_abc123' }, 'transaction'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })

  it.each([
    ['a numeric id', { id: 123 }, 'transaction.id'],
    ['an amount sent as a string', { amount: '50.00' }, 'transaction.amount'],
    ['a zero amount', { amount: 0 }, 'transaction.amount'],
    ['a negative amount', { amount: -5 }, 'transaction.amount'],
    ['an empty currency', { currency: '' }, 'transaction.currency'],
    ['a paidAt that is not a date-time', { paidAt: 'yesterday' }, 'transaction.paidAt'],
    ['a paidAt without a time zone', { paidAt: '2026-09-09T10:22:31' }, 'transaction.paidAt'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, transaction: { ...transaction, ...change } }, schema)).toEqual(invalid(field))
  })
})
