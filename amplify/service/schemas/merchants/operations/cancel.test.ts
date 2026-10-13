import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './cancel.json'

const valid = { requestId: 'req_1760000000000_0123456789ab' }

describe('POST /merchants/operations/cancel body', () => {
  it('accepts a request id', () => {
    expect(checkBodyAgainstSchema(valid, schema)).toEqual({ valid: true })
  })

  it('requires requestId', () => {
    expect(checkBodyAgainstSchema({}, schema)).toEqual({ valid: false, code: 100029, message: 'requestId' })
  })

  it.each([
    ['an empty request id', ''],
    // The id goes into the row's sort key after REQ#
    ['another row\'s key', 'MEMBER#e13b35a0-1021-7007-2676-937353245fe2'],
    ['an id with something after it', `${valid.requestId}#x`],
    ['a list of ids', [valid.requestId]],
  ])('refuses %s', (_, requestId) => {
    expect(checkBodyAgainstSchema({ requestId }, schema)).toEqual({ valid: false, code: 100031, message: 'requestId' })
  })
})
