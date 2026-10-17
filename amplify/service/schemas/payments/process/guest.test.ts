import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './guest.json'

// What src/pages/PaymentWidget.tsx sends: evervault.encrypt() of the card, as JSON
const encrypted = JSON.stringify({ number: 'ev:Tk9OQ:num', cvc: 'ev:Tk9OQ:cvc', expiry: { month: 'ev:Tk9OQ:mm', year: 'ev:Tk9OQ:yy' } })
const card = { lastFour: '4242', bin: '42424242', cardType: 'visa', cardData: encrypted }
const valid = { cardData: card, userId: 'user-1', amount: 149, currency: 'USD', transactionId: 'txn_1760000000000_abc123def' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /payments/process/guest body', () => {
  it.each([
    ['the widget\'s body', valid],
    ['a card the relay encrypted whole', { ...valid, cardData: { ...card, cardData: 'ev:Tk9OQ:encrypted-card' } }],
    ['a provider', { ...valid, provider: 'clover' }],
    // F3: a signed-in user pays as themselves; the handler checks a merchant key's userId
    ['a body without userId', { ...valid, userId: undefined }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['cardData', 'amount', 'currency'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema))
      .toEqual({ valid: false, code: 100029, message: 'cardData,amount,currency' })
  })

  it.each(['lastFour', 'bin', 'cardType', 'cardData'])('requires cardData.%s', field => {
    expect(checkBodyAgainstSchema({ ...valid, cardData: { ...card, [field]: undefined } }, schema))
      .toEqual({ valid: false, code: 100029, message: 'cardData.lastFour,cardData.bin,cardData.cardType,cardData.cardData' })
  })

  // Regression: a string, zero or negative amount passed requiredParams and reached the queue
  it.each([
    ['a zero amount', { amount: 0 }, 'amount'],
    ['a negative amount', { amount: -149 }, 'amount'],
    ['an amount sent as a string', { amount: '149' }, 'amount'],
    ['a lower-case currency', { currency: 'usd' }, 'currency'],
    ['an empty userId', { userId: '' }, 'userId'],
    ['an unknown provider', { provider: 'paypal' }, 'provider'],
    ['cardData sent as a string', { cardData: 'ev:Tk9OQ:encrypted-card' }, 'cardData'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })

  it.each([
    ['a lastFour of 3 digits', { lastFour: '424' }, 'cardData.lastFour'],
    ['a BIN of 5 digits', { bin: '42424' }, 'cardData.bin'],
    ['an empty cardType', { cardType: '' }, 'cardData.cardType'],
    ['a plain card number', { cardData: '4242424242424242' }, 'cardData.cardData'],
    ['an empty string', { cardData: '' }, 'cardData.cardData'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, cardData: { ...card, ...change } }, schema)).toEqual(invalid(field))
  })
})
