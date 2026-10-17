import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { issueApiKey, revokeApiKey } from './apiKeyIssuer'

const send = jest.spyOn(LambdaClient.prototype, 'send')
const answer = (body: unknown, functionError?: string) =>
  ({ Payload: Buffer.from(JSON.stringify(body)), FunctionError: functionError }) as any

afterEach(() => send.mockReset())

const create = {
  ownerType: 'user' as const,
  ownerId: 'user-1',
  merchantId: 'internal-001',
  name: 'bot',
  permissions: ['accounts:read'],
  perSecond: 10,
  createdBy: 'user-1',
}

describe('apiKeyIssuer', () => {
  it('invokes apiKeyIssuerFn with the operation and answers what it answered', async () => {
    send.mockResolvedValue(answer({ ok: true, keyId: 'lk_live_1', secret: 'lks_x', key: {} }) as never)
    expect(await issueApiKey(create)).toMatchObject({ ok: true, secret: 'lks_x' })
    const command = send.mock.calls[0][0] as InvokeCommand
    expect(command.input.FunctionName).toBe('apiKeyIssuerFn')
    expect(JSON.parse(Buffer.from(command.input.Payload as Uint8Array).toString())).toEqual({ op: 'create', ...create })

    send.mockResolvedValue(answer({ ok: true, keyId: 'lk_live_1', alreadyRevoked: false }) as never)
    await revokeApiKey({ keyId: 'lk_live_1', revokedBy: 'user-1', ownerId: 'user-1' })
    expect(JSON.parse(Buffer.from((send.mock.calls[1][0] as InvokeCommand).input.Payload as Uint8Array).toString()))
      .toEqual({ op: 'revoke', keyId: 'lk_live_1', revokedBy: 'user-1', ownerId: 'user-1' })
  })

  it('throws when the issuer crashed, naming no part of its answer', async () => {
    send.mockResolvedValue(answer({ errorMessage: 'lks_should_not_appear' }, 'Unhandled') as never)
    await expect(issueApiKey(create)).rejects.toThrow('apiKeyIssuerFn create failed: Unhandled')
    await expect(issueApiKey(create)).rejects.not.toThrow('lks_should_not_appear')
  })

  it('throws when nothing came back', async () => {
    send.mockResolvedValue({} as never)
    await expect(revokeApiKey({ keyId: 'lk_live_1', revokedBy: 'u' })).rejects.toThrow('no answer')
  })
})
