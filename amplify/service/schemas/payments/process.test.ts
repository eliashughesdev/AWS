import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './process.json'

// What src/pages/ProcessPayment.tsx sends
const valid = {
  paymentId: 'fe4fa0d6-1f80-4a23-81ee-b7e2692d91b0',
  userId: 'user-1',
  amount: 50,
  currency: 'EUR',
  provider: 'stripe',
  transactionId: 'txn_1760000000000_abc123def',
  bin: '42424242',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
}
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /payments/process body', () => {
  it.each([
    ['the checkout page\'s body', valid],
    ['only the required fields', { paymentId: valid.paymentId, amount: 1000, currency: 'USD' }],
    ['a recurring payment', { paymentId: valid.paymentId, userId: 'user-1', amount: 10.5, currency: 'USD', provider: 'clover', offSession: true }],
    ['a return URL', { ...valid, returnUrl: 'https://my.staging.loudibly.com/' }],
    ['a 6-digit BIN', { ...valid, bin: '424242' }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['paymentId', 'amount', 'currency'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema))
      .toEqual({ valid: false, code: 100029, message: 'paymentId,amount,currency' })
  })

  // Regression: a string, zero or negative amount passed requiredParams and reached the queue
  it.each([
    ['a zero amount', { amount: 0 }, 'amount'],
    ['a negative amount', { amount: -50 }, 'amount'],
    ['an amount sent as a string', { amount: '50' }, 'amount'],
    ['a lower-case currency', { currency: 'eur' }, 'currency'],
    ['a currency that is not 3 letters', { currency: 'EURO' }, 'currency'],
    ['an empty paymentId', { paymentId: '' }, 'paymentId'],
    ['an empty userId', { userId: '' }, 'userId'],
    ['an unknown provider', { provider: 'paypal' }, 'provider'],
    ['offSession sent as a string', { offSession: 'true' }, 'offSession'],
    ['a BIN of 5 digits', { bin: '42424' }, 'bin'],
    ['a malformed email', { email: 'not-an-email' }, 'email'],
    ['a plain-http return URL', { returnUrl: 'http://example.com/' }, 'returnUrl'],
    ['a javascript: return URL', { returnUrl: 'javascript:alert(1)' }, 'returnUrl'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })

  // B1: fields the handler does not read are allowed through and never queued
  it('accepts, and leaves to the handler, a field it does not list', () => {
    expect(checkBodyAgainstSchema({ ...valid, queue: 'v1-sweep-queue' }, schema)).toEqual({ valid: true })
  })
})
