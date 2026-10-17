import { checkBodyAgainstSchema } from '../../../utils/schema'
import schema from './list.json'

describe('GET /merchants/list query string', () => {
  // The router passes {} when there is no query string
  it('accepts none', () => {
    expect(checkBodyAgainstSchema({}, schema)).toEqual({ valid: true })
  })

  it.each(['merchantId', 'status'])('refuses %s, naming it', field => {
    expect(checkBodyAgainstSchema({ [field]: 'x' }, schema)).toEqual({ valid: false, code: 100031, message: field })
  })
})
