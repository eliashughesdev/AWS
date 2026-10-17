import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './save.json'

// What the dashboard sends through the Evervault relay, which encrypts cardData on the way
const card = { lastFour: '4242', bin: '42424242', cardType: 'visa', cardData: 'ev:Tk9OQ:encrypted-card' }
const valid = { userId: 'user-1', paymentMethod: card }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /payments/save body', () => {
  it.each([
    ['a card with an 8-digit BIN', valid],
    ['a card with a 6-digit BIN', { ...valid, paymentMethod: { ...card, bin: '424242' } }],
    // F3: a signed-in user saves for themselves; the handler checks a merchant key's userId
    ['a body without userId', { paymentMethod: card }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it('requires paymentMethod', () => {
    expect(checkBodyAgainstSchema({ ...valid, paymentMethod: undefined }, schema))
      .toEqual({ valid: false, code: 100029, message: 'paymentMethod' })
  })

  it('refuses an empty userId', () => {
    expect(checkBodyAgainstSchema({ ...valid, userId: '' }, schema)).toEqual(invalid('userId'))
  })

  it.each(['lastFour', 'bin', 'cardType', 'cardData'])('requires paymentMethod.%s', field => {
    expect(checkBodyAgainstSchema({ ...valid, paymentMethod: { ...card, [field]: undefined } }, schema))
      .toEqual({ valid: false, code: 100029, message: 'paymentMethod.lastFour,paymentMethod.bin,paymentMethod.cardType,paymentMethod.cardData' })
  })

  // Regression: a plain card sent straight to the API was stored and logged as it came
  it.each([
    ['plain card JSON', JSON.stringify({ number: '4242424242424242', cvc: '123', expiry: { month: '12', year: '30' } })],
    ['a plain card number', '4242424242424242'],
    ['an empty string', ''],
    ['ev: further in, not as its prefix', 'x ev:abc'],
  ])('refuses cardData that is %s', (_, cardData) => {
    expect(checkBodyAgainstSchema({ ...valid, paymentMethod: { ...card, cardData } }, schema)).toEqual(invalid('paymentMethod.cardData'))
  })

  it.each([
    ['a lastFour of 3 digits', { lastFour: '424' }, 'paymentMethod.lastFour'],
    ['a lastFour with letters', { lastFour: '42a2' }, 'paymentMethod.lastFour'],
    ['a BIN of 5 digits', { bin: '42424' }, 'paymentMethod.bin'],
    ['a BIN of 9 digits', { bin: '424242424' }, 'paymentMethod.bin'],
    ['a BIN with spaces', { bin: '4242 424' }, 'paymentMethod.bin'],
    ['an empty cardType', { cardType: '' }, 'paymentMethod.cardType'],
    ['cardData sent as an object', { cardData: { number: '4242424242424242' } }, 'paymentMethod.cardData'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, paymentMethod: { ...card, ...change } }, schema)).toEqual(invalid(field))
  })

  // What src/pages/AddPayment.tsx sends; it was refused before this schema too
  it('refuses card fields sent outside paymentMethod', () => {
    expect(checkBodyAgainstSchema({ userId: 'user-1', cardData: card.cardData, bin: card.bin, lastFour: card.lastFour }, schema))
      .toEqual({ valid: false, code: 100029, message: 'paymentMethod' })
  })
})
