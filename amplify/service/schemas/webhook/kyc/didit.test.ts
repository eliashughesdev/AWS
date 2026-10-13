import { checkBodyAgainstSchema } from '../../../../utils/schema'
import schema from './didit.json'

// Trimmed from Didit's status.updated example (docs.didit.me/integration/webhooks)
const approved = {
  event_id: '3f0b9c1e-6a39-4e5b-9d3e-0c7f0d3a1b2c',
  webhook_type: 'status.updated',
  timestamp: 1791850000,
  created_at: 1791849990,
  application_id: '7d1c2a3b-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
  environment: 'sandbox',
  status: 'Approved',
  session_id: '11111111-2222-4333-8444-555555555555',
  vendor_data: 'e13b35a0-1021-7007-2676-937353245fe2',
  sandbox_scenario: null,
  metadata: {},
  decision: { id_verification: { status: 'Approved' } },
}
const invalid = (field: string) => ({ valid: false, code: 100031, message: field })

describe('POST /webhook/kyc/didit body', () => {
  it.each([
    ['a session approval', approved],
    ['a data update', { ...approved, webhook_type: 'data.updated', status: 'In Review' }],
    // A status this code does not know yet must still arrive: Didit does not retry a 400
    ['a status added later', { ...approved, status: 'Kyc Expired' }],
    // Absent when the session was created without it; the handler answers 200 and logs it
    ['no vendor_data', { ...approved, vendor_data: undefined }],
    // Entity and transaction events have no session_id; the signature check refuses them
    ['an entity event', { webhook_type: 'user.status.updated', status: 'BLOCKED', vendor_user_id: 'u-1' }],
  ])('accepts %s', (_, body) => {
    expect(checkBodyAgainstSchema(body, schema)).toEqual({ valid: true })
  })

  it.each(['webhook_type', 'status'])('requires %s', field => {
    expect(checkBodyAgainstSchema({ ...approved, [field]: undefined }, schema)).toEqual({ valid: false, code: 100029, message: 'webhook_type,status' })
  })

  it.each([
    ['an empty status', { status: '' }, 'status'],
    ['a status as an object', { status: { value: 'Approved' } }, 'status'],
    ['a numeric session_id', { session_id: 42 }, 'session_id'],
    // It becomes the key of the profile the status is written to
    ['vendor_data as an object', { vendor_data: { id: 'x' } }, 'vendor_data'],
  ])('refuses %s', (_, change, field) => {
    expect(checkBodyAgainstSchema({ ...approved, ...change }, schema)).toEqual(invalid(field))
  })
})
