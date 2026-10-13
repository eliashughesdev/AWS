import { checkBodyAgainstSchema } from '../../../../../utils/schema'
import schema from './session.json'

describe('POST /accounts/kyc/didit/session body', () => {
  it.each([
    // What the dashboard and the React page send
    ['an empty object', {}],
    // API Gateway's body for a POST with none
    ['no body', null],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['userId', 'callback'])('refuses %s, naming it', field => {
    expect(checkBodyAgainstSchema({ [field]: 'x' }, schema)).toEqual({ valid: false, code: 100031, message: field })
  })

  it.each([
    ['a list', []],
    ['text', 'start'],
  ])('refuses %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: false, code: 100031, message: 'body' })
  })
})
