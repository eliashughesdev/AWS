import { isValidAddressFor, isValidSolanaAddress } from './addresses'

// Well-formed addresses: base58check with its checksum for TRON, 32 bytes for Solana
const tron = 'TPPjH6SeHdZQYYR3Yfk6Wr2xrazJc5MPPf'
const sol = 'EQ6iRuVbqobWug3MrAVfMHt72VT2mkwpCQ57jEfGqc9j'

describe('isValidAddressFor', () => {
  it.each([
    ['TRON', tron],
    ['USDT_TRON', tron],
    ['TUSDT_TRON', tron],
    ['SOL', sol],
  ])('accepts a %s address', (currency, address) => {
    expect(isValidAddressFor(currency, address)).toBe(true)
  })

  it.each([
    ['a Solana address for TRON', 'TRON', sol],
    ['a TRON address for SOL', 'SOL', tron],
    ['a TRON address cut short', 'TRON', tron.slice(0, -2)],
    ['a TRON address with a wrong checksum', 'TRON', tron.slice(0, -1) + (tron.endsWith('f') ? 'g' : 'f')],
    ['a Solana address cut short', 'SOL', sol.slice(0, -4)],
    ['characters base58 does not have', 'SOL', sol.replace(/.$/, '0')],
    ['an empty address', 'TRON', ''],
    ['a currency on no known network', 'BTC', tron],
  ])('refuses %s', (_, currency, address) => {
    expect(isValidAddressFor(currency, address)).toBe(false)
  })

  it('refuses what is not a string', () => {
    expect(isValidSolanaAddress(42)).toBe(false)
    expect(isValidAddressFor('TRON', null)).toBe(false)
  })
})
