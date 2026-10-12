import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './claim.json'
import verify from './verify.json'

const token = 'q3J8kZ0vYw1sT9bX4mN7pL2cR5hD8fG6aE3uI0oK1jQ'
const valid = { token, password: 'Correct-Horse-9' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /onboarding/claim body', () => {
  it('accepts a token and a password', () => {
    expect(checkBodyAgainstSchema(valid, schema)).toEqual({ valid: true })
  })

  // Cognito's policy answers these with 100037 and the sentence the set-password screen shows
  it.each([
    ['a short password', 'a'],
    ['a password with no digit or symbol', 'password'],
    ['a password of spaces', '        '],
    ['a password of 256 characters', 'x'.repeat(256)],
  ])('lets %s through to the handler', (_, password) => {
    expect(checkBodyAgainstSchema({ ...valid, password }, schema)).toEqual({ valid: true })
  })

  it('lets a malformed token through to loadClaim, as verify does', () => {
    expect(checkBodyAgainstSchema({ ...valid, token: token.slice(0, 10) }, schema)).toEqual({ valid: true })
    expect(schema.properties.token).toEqual(verify.properties.token)
  })

  it.each([
    [{ password: 'x' }],
    [{ token }],
  ])('requires token and password (%o)', body => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: false, code: 100029, message: 'token,password' })
  })

  it.each([
    ['an empty password', { password: '' }, 'password'],
    ['a numeric password', { password: 12345678 }, 'password'],
    ['a password over Cognito\'s 256 characters', { password: 'x'.repeat(257) }, 'password'],
    ['an empty token', { token: '' }, 'token'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
