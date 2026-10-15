import { handler } from './handler'

// Step 2.1: deployed before it can do anything (create and revoke come in step 2.2)
describe('apiKeyIssuerFn', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  it.each([{ operation: 'create' }, { operation: 'revoke' }, {}])('refuses %p', async event => {
    expect(await handler(event)).toEqual({ ok: false, error: 'unknown operation' })
  })
})
