import { describeRequest } from './requestLog'

describe('describeRequest', () => {
  it('names the API key a request came with, by id only', () => {
    const event = {
      httpMethod: 'GET',
      path: '/v1/accounts/list',
      headers: { Authorization: 'Basic c2VjcmV0' },
      requestContext: { requestId: 'r-1', authorizer: { role: 'user', authType: 'apikey', keyId: 'lk_live_0123456789abcdef' } },
    }
    expect(describeRequest(event)).toEqual({ method: 'GET', path: '/v1/accounts/list', requestId: 'r-1', role: 'user', keyId: 'lk_live_0123456789abcdef' })
  })

  it('says nothing of a key for any other caller', () => {
    expect(describeRequest({ httpMethod: 'GET', path: '/x', requestContext: { authorizer: { role: 'user', authType: 'jwt' } } })).not.toHaveProperty('keyId')
  })
})
