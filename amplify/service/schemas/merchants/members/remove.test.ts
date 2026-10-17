import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './remove.json'

const valid = { merchantId: 'mrc_0123456789abcdef', userId: 'e13b35a0-1021-7007-2676-937353245fe2' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /merchants/members/remove body', () => {
  it('accepts a merchant and a member', () => {
    expect(checkBodyAgainstSchema(valid, schema)).toEqual({ valid: true })
  })

  it.each(['merchantId', 'userId'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual({ valid: false, code: 100029, message: 'merchantId,userId' })
  })

  it.each([
    ['an empty merchantId', { merchantId: '' }, 'merchantId'],
    ['a numeric merchantId', { merchantId: 42 }, 'merchantId'],
    ['an empty userId', { userId: '' }, 'userId'],
    ['a userId of 129 characters', { userId: 'a'.repeat(129) }, 'userId'],
    ['a list of users', { userId: [valid.userId] }, 'userId'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
