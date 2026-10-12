import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './list.json'

// The query string of GET /payments/list, as API Gateway passes it: every value a string
describe('GET /payments/list query', () => {
  it.each([
    ['a Cognito user id', { userId: '018bb520-4061-70b4-6d65-4d7d4bdb5a25' }],
    ['another parameter beside it', { userId: 'user-1', page: '2' }],
  ])('accepts %s', (_, query) => {
    expect(checkBodyAgainstSchema(query, schema)).toEqual({ valid: true })
  })

  it('requires userId', () => {
    expect(checkBodyAgainstSchema({}, schema)).toEqual({ valid: false, code: 100029, message: 'userId' })
  })

  it.each([
    ['an empty userId', ''],
    ['a userId of 129 characters', 'u'.repeat(129)],
  ])('refuses %s', (_, userId) => {
    expect(checkBodyAgainstSchema({ userId }, schema)).toEqual({ valid: false, code: 100031, message: 'userId' })
  })
})
