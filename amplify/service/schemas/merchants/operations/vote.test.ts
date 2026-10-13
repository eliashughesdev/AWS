import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './vote.json'

const valid = { requestId: 'req_1760000000000_0123456789ab', decision: 'approve' }
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /merchants/operations/vote body', () => {
  it.each(['approve', 'reject'])('accepts a vote to %s', decision => {
    expect(checkBodyAgainstSchema({ ...valid, decision }, schema)).toEqual({ valid: true })
  })

  it.each(['requestId', 'decision'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...valid, [field]: undefined }, schema)).toEqual({ valid: false, code: 100029, message: 'requestId,decision' })
  })

  it.each([
    ['an empty request id', { requestId: '' }, 'requestId'],
    // The id goes into the row's sort key after REQ#
    ['another row\'s key', { requestId: 'MEMBER#e13b35a0-1021-7007-2676-937353245fe2' }, 'requestId'],
    ['an id with something after it', { requestId: `${valid.requestId}#x` }, 'requestId'],
    ['a list of ids', { requestId: [valid.requestId] }, 'requestId'],
    ['an upper-case decision', { decision: 'APPROVE' }, 'decision'],
    ['a decision that is neither', { decision: 'abstain' }, 'decision'],
    ['a boolean decision', { decision: true }, 'decision'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...valid, ...change }, schema)).toEqual(invalid(field))
  })
})
