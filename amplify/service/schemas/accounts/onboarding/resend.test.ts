import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './resend.json'
import onboarding from '../onboarding.json'

describe('POST /accounts/onboarding/resend body', () => {
  it('accepts an externalId', () => {
    expect(checkBodyAgainstSchema({ externalId: 'usr_9f3a2b' }, schema)).toEqual({ valid: true })
  })

  it('requires externalId', () => {
    expect(checkBodyAgainstSchema({}, schema)).toEqual({ valid: false, code: 100029, message: 'externalId' })
  })

  it.each([
    ['an empty string', ''],
    // It becomes part of the mapping key, EXT#<platform>#<externalId>
    ['a number', 123],
    ['an object', { id: 'usr_9f3a2b' }],
  ])('refuses %s', (_, externalId) => {
    expect(checkBodyAgainstSchema({ externalId }, schema)).toEqual({ valid: false, code: 100031, message: 'externalId' })
  })

  // An externalId that onboarding accepts must be one resend accepts, or a payer could not get a new link
  it('takes externalId as /accounts/onboarding does', () => {
    expect(schema.properties.externalId).toEqual(onboarding.properties.externalId)
  })
})
