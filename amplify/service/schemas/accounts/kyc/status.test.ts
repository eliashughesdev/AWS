import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './status.json'

describe('GET /accounts/kyc/status query string', () => {
  // The router passes {} when there is no query string
  it('accepts none', () => {
    expect(checkBodyAgainstSchema({}, schema)).toEqual({ valid: true })
  })

  it.each(['userId', 'sessionId'])('refuses %s, naming it', field => {
    expect(checkBodyAgainstSchema({ [field]: 'x' }, schema)).toEqual({ valid: false, code: 100031, message: field })
  })
})
