import { checkBodyAgainstSchema } from '../../../../utils/schema'
import { MEMBER_ROLES } from '../../../../utils/merchant'
import schema from './invite.json'

const valid = { merchantId: 'mrc_0123456789abcdef', email: 'ana@example.com', name: 'Ana Lima', roles: ['initiator'] }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /merchants/members/invite body', () => {
  it.each([
    ['one role', valid],
    ['both roles', { ...valid, roles: ['initiator', 'approver'] }],
    ['a name of 100 characters', { ...valid, name: 'a'.repeat(100) }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it('lists the same roles as MEMBER_ROLES', () => {
    expect(schema.properties.roles.items.enum).toEqual(MEMBER_ROLES)
  })

  it.each(['merchantId', 'email', 'name', 'roles'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual({ valid: false, code: 100029, message: 'merchantId,email,name,roles' })
  })

  it.each([
    ['an empty merchantId', { merchantId: '' }, 'merchantId'],
    ['an address with no domain', { email: 'ana@' }, 'email'],
    ['a blank name', { name: '   ' }, 'name'],
    ['a name of 101 characters', { name: 'a'.repeat(101) }, 'name'],
    ['no roles', { roles: [] }, 'roles'],
    ['a role given twice', { roles: ['approver', 'approver'] }, 'roles'],
    ['a role as a string', { roles: 'approver' }, 'roles'],
    ['an unknown role', { roles: ['owner'] }, 'roles.0'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
