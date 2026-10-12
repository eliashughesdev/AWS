import { handler } from './handler'

// The real helpers, without the read from SSM
jest.mock('../../utils/config', () => ({ ...jest.requireActual('../../utils/config'), loadConfig: jest.fn() }))

const message = async (triggerSource = 'CustomMessage_SignUp') => {
  const event = {
    triggerSource,
    request: { userAttributes: { email: 'ana@example.com' }, codeParameter: '{####}' },
    response: {},
  } as any
  await handler(event, {} as any, () => {})
  return event.response.emailMessage as string | undefined
}

describe('the confirmation email', () => {
  beforeEach(() => {
    process.env.BRAND_NAME = 'NODA'
    process.env.FRONTEND_URL = 'https://my.example.com'
    delete process.env.FRONTEND_APP_PATH
  })

  it('links to the /v2 screen when FRONTEND_APP_PATH is unset', async () => {
    expect(await message()).toContain('<a href="https://my.example.com/v2/confirm?email=ana%40example.com&code={####}"')
  })

  it.each(['CustomMessage_SignUp', 'CustomMessage_ResendCode'])('links to the folder in FRONTEND_APP_PATH (%s)', async (triggerSource) => {
    process.env.FRONTEND_APP_PATH = '/noda'
    expect(await message(triggerSource)).toContain('<a href="https://my.example.com/noda/confirm?email=ana%40example.com&code={####}"')
  })

  it('links to the site root for "/"', async () => {
    process.env.FRONTEND_APP_PATH = '/'
    expect(await message()).toContain('<a href="https://my.example.com/confirm?email=')
  })

  // Before frontendAppUrl() a FRONTEND_URL ending in "/" gave "//v2/confirm" here
  it('has no double slash when FRONTEND_URL ends in one', async () => {
    process.env.FRONTEND_URL = 'https://my.example.com/'
    expect(await message()).toContain('<a href="https://my.example.com/v2/confirm?email=')
  })

  it('carries the code alone without FRONTEND_URL', async () => {
    delete process.env.FRONTEND_URL
    process.env.FRONTEND_APP_PATH = '/noda'
    const html = await message()
    expect(html).toContain('{####}')
    expect(html).not.toContain('<a href')
  })

  it('leaves any other message to Cognito', async () => {
    expect(await message('CustomMessage_ForgotPassword')).toBeUndefined()
  })
})
