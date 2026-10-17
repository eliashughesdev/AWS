import { normalizeIp, parseAllowlist } from './ipAddress'

const { normalizeIp: authorizerNormalizeIp } = require('../fn/authorizer/apiKey')

describe('normalizeIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    [' 203.0.113.7 ', '203.0.113.7'],
    ['2001:DB8:0:0:0:0:0:1', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'],
    ['::FFFF:198.51.100.1', '198.51.100.1'],
    ['203.0.113.0/24', null],
    ['256.1.1.1', null],
    ['fe80::1%eth0', null],
    ['example.com', null],
    ['', null],
  ])('%p → %p', (given, expected) => {
    expect(normalizeIp(given)).toBe(expected)
  })

  // The route stores what the authorizer compares against: they must write each address alike
  it('writes every address as the authorizer does', () => {
    for (const ip of ['203.0.113.7', '2001:DB8:0:0:0:0:0:1', '::ffff:198.51.100.1', 'fe80::1%eth0', '1.2.3']) {
      expect(normalizeIp(ip)).toBe(authorizerNormalizeIp(ip))
    }
  })
})

describe('parseAllowlist', () => {
  it('normalises each address and drops duplicates', () => {
    expect(parseAllowlist(['2001:DB8::1', '203.0.113.7', '2001:db8:0::1'])).toEqual({ ok: true, ips: ['2001:db8::1', '203.0.113.7'] })
    expect(parseAllowlist([])).toEqual({ ok: true, ips: [] })
  })

  it('names the first entry that is not an address', () => {
    expect(parseAllowlist(['203.0.113.7', '10.0.0.0/8'])).toEqual({ ok: false, bad: '10.0.0.0/8' })
    expect(parseAllowlist([42])).toEqual({ ok: false, bad: '42' })
  })

  it('takes 20 addresses, not 21', () => {
    const ips = (n: number) => Array.from({ length: n }, (_, i) => `203.0.113.${i + 1}`)
    expect(parseAllowlist(ips(20)).ok).toBe(true)
    expect(parseAllowlist(ips(21))).toEqual({ ok: false, bad: 'too-many' })
    // Duplicates do not count
    expect(parseAllowlist([...ips(20), ...ips(20)]).ok).toBe(true)
  })
})
