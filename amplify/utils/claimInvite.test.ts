import { sendClaimInvite } from './claimInvite'

const mockSendEmail = jest.fn()
jest.mock('./EmailProvider', () => ({ getEmailProvider: () => ({ sendEmail: mockSendEmail }) }))

const claim = { token: 'tok_123', tokenHash: 'hash', expiresAt: Date.now() + 86_400_000 }

// The link as the plain-text email carries it, on a line of its own
const sentLink = () => (mockSendEmail.mock.calls[0][2] as string).split('\n').find(line => line.startsWith('http'))

describe('sendClaimInvite', () => {
  beforeEach(() => {
    process.env.BRAND_NAME = 'NODA'
    process.env.FRONTEND_URL = 'https://my.example.com'
    delete process.env.FRONTEND_APP_PATH
  })

  it('links to the /v2 screen when FRONTEND_APP_PATH is unset', async () => {
    expect(await sendClaimInvite('ana@example.com', 'Ana', claim)).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0]).toBe('ana@example.com')
    expect(sentLink()).toBe('https://my.example.com/v2/set-password?token=tok_123')
  })

  it('links to the folder in FRONTEND_APP_PATH, in the text and in the button', async () => {
    process.env.FRONTEND_APP_PATH = '/noda'
    await sendClaimInvite('ana@example.com', 'Ana', claim)
    expect(sentLink()).toBe('https://my.example.com/noda/set-password?token=tok_123')
    expect(mockSendEmail.mock.calls[0][3]).toContain('<a href="https://my.example.com/noda/set-password?token=tok_123"')
  })

  it('links to the site root for "/"', async () => {
    process.env.FRONTEND_APP_PATH = '/'
    await sendClaimInvite('ana@example.com', 'Ana', claim)
    expect(sentLink()).toBe('https://my.example.com/set-password?token=tok_123')
  })

  it('sends nothing and says so without FRONTEND_URL', async () => {
    delete process.env.FRONTEND_URL
    process.env.FRONTEND_APP_PATH = '/noda'
    expect(await sendClaimInvite('ana@example.com', 'Ana', claim)).toBe(false)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
