import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './list.json'

// The query string of GET /payments/list, as API Gateway passes it: every value a string
describe('GET /payments/list query', () => {
  it.each([
    ['a Cognito user id', { userId: '018bb520-4061-70b4-6d65-4d7d4bdb5a25' }],
    ['another parameter beside it', { userId: 'user-1', page: '2' }],
    // F3: a signed-in user lists their own cards; the handler checks a merchant key's userId
    ['no userId', {}],
  ])('accepts %s', (_, query) => {
    expect(checkBodyAgainstSchema(query, schema)).toEqual({ valid: true })
  })

  it.each([
    ['an empty userId', ''],
    ['a userId of 129 characters', 'u'.repeat(129)],
  ])('refuses %s', (_, userId) => {
    expect(checkBodyAgainstSchema({ userId }, schema)).toEqual({ valid: false, code: 100031, message: 'userId' })
  })
})
