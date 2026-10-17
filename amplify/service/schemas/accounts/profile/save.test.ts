import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './save.json'

const valid = { name: 'Ana Lima', email: 'ana@example.com' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /accounts/profile/save body', () => {
  it.each([
    ['a name and an email', valid],
    ['a name alone', { name: 'Ana' }],
    ['a name of 200 characters', { name: 'a'.repeat(200) }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it('requires name', () => {
    expect(checkBodyAgainstSchema({ email: valid.email }, schema)).toEqual({ valid: false, code: 100029, message: 'name' })
  })

  it.each([
    ['an empty name', { name: '' }, 'name'],
    ['a blank name', { name: '  ' }, 'name'],
    ['a name of 201 characters', { name: 'a'.repeat(201) }, 'name'],
    ['a numeric name', { name: 42 }, 'name'],
    // Was written to the profile as it came
    ['an email that is not an address', { email: 'ana' }, 'email'],
    ['an empty email', { email: '' }, 'email'],
    ['an email as an object', { email: { S: 'ana@example.com' } }, 'email'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
