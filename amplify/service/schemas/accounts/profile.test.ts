import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './profile.json'

describe('GET /accounts/profile query string', () => {
  // The router passes {} when there is no query string
  it('accepts none', () => {
    expect(checkBodyAgainstSchema({}, schema)).toEqual({ valid: true })
  })

  it.each(['userId', 'email'])('refuses %s, naming it', field => {
    expect(checkBodyAgainstSchema({ [field]: 'x' }, schema)).toEqual({ valid: false, code: 100031, message: field })
  })
})
