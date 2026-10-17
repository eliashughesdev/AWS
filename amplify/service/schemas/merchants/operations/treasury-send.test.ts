import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './treasury-send.json'

const valid = { currency: 'USDT_TRON', amount: 250.5, destinationAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /merchants/operations/treasury-send body', () => {
  it.each([
    ['a send', valid],
    // The handler upper-cases it
    ['a lower-case currency', { ...valid, currency: 'usdt_tron' }],
    // The handler answers 100045 and 100048 for these, which say more than 100031
    ['a native coin', { ...valid, currency: 'TRON' }],
    ['an address of another network', { ...valid, destinationAddress: '0x0000000000000000000000000000000000000000' }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['currency', 'amount', 'destinationAddress'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual({ valid: false, code: 100029, message: 'currency,amount,destinationAddress' })
  })

  it.each([
    ['an empty currency', { currency: '' }, 'currency'],
    ['a list of currencies', { currency: ['USDT_TRON'] }, 'currency'],
    ['an amount of 0', { amount: 0 }, 'amount'],
    ['a negative amount', { amount: -1 }, 'amount'],
    // Number() used to turn it into one
    ['an amount as a string', { amount: '250.5' }, 'amount'],
    ['an empty address', { destinationAddress: '' }, 'destinationAddress'],
    ['an address of 129 characters', { destinationAddress: 'T'.repeat(129) }, 'destinationAddress'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
