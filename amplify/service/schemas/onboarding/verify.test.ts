import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './verify.json'

// The shape createClaimToken() mints: 32 random bytes as base64url
const token = 'q3J8kZ0vYw1sT9bX4mN7pL2cR5hD8fG6aE3uI0oK1jQ'

describe('POST /onboarding/verify body', () => {
  it('accepts a token', () => {
    expect(checkBodyAgainstSchema({ token }, schema)).toEqual({ valid: true })
  })

  // A link cut short or mangled by an email client must still answer 100034 from loadClaim,
  // which the set-password screen shows as a dead link; the schema must not refuse it first
  it.each([
    ['a token cut short', token.slice(0, 20)],
    ['a token with characters base64url does not have', `${token}+/=`],
    ['a much longer token', token.repeat(10)],
  ])('lets %s through to the handler', (_, value) => {
    expect(checkBodyAgainstSchema({ token: value }, schema)).toEqual({ valid: true })
  })

  it('requires token', () => {
    expect(checkBodyAgainstSchema({}, schema)).toEqual({ valid: false, code: 100029, message: 'token' })
  })

  it.each([
    ['an empty token', ''],
    ['a numeric token', 123],
  ])('refuses %s', (_, value) => {
    expect(checkBodyAgainstSchema({ token: value }, schema)).toEqual({ valid: false, code: 100031, message: 'token' })
  })
})
