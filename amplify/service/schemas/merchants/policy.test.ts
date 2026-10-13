import { checkBodyAgainstSchema } from '../../../utils/schema'
import { isNativeCurrency, networkFor } from '../../../utils/currencies'
import schema from './policy.json'

const valid = { merchantId: 'mrc_0123456789abcdef', thresholds: { USDT_TRON: 10000 } }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })
const tokenName = new RegExp(schema.properties.thresholds.propertyNames.pattern)

describe('POST /merchants/policy body', () => {
  it.each([
    ['one currency', valid],
    ['both tokens', { ...valid, thresholds: { USDT_TRON: 10000, TUSDT_TRON: 0.5 } }],
    // The handler upper-cases it
    ['a lower-case currency', { ...valid, thresholds: { usdt_tron: 10000 } }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['TRON', 'SOL', 'USDT_TRON', 'TUSDT_TRON'])('names %s only when it is a token currency', currency => {
    expect(tokenName.test(currency)).toBe(!!networkFor(currency) && !isNativeCurrency(currency))
  })

  it.each(['merchantId', 'thresholds'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual({ valid: false, code: 100029, message: 'merchantId,thresholds' })
  })

  it.each([
    ['an empty merchantId', { merchantId: '' }, 'merchantId'],
    // Replacing the set with nothing would stop every send
    ['no thresholds', { thresholds: {} }, 'thresholds'],
    ['a list', { thresholds: [10000] }, 'thresholds'],
    ['a native coin', { thresholds: { TRON: 100 } }, 'thresholds'],
    ['an unknown currency', { thresholds: { BTC: 1 } }, 'thresholds'],
    ['a threshold of 0', { thresholds: { USDT_TRON: 0 } }, 'thresholds.USDT_TRON'],
    ['a negative threshold', { thresholds: { USDT_TRON: -5 } }, 'thresholds.USDT_TRON'],
    ['a threshold as a string', { thresholds: { USDT_TRON: '10000' } }, 'thresholds.USDT_TRON'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
