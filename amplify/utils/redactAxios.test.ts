import { inspect } from 'util'
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { REDACTED, redactAxiosError } from './redactAxios'

const KEY = 't-secret-tatum-key'

// An adapter that fails the way Tatum's 403 did: the raw request text holds the key too
const refuse = async (config: InternalAxiosRequestConfig) => {
  const request = { _header: `POST /v3/ledger/transaction HTTP/1.1\r\nx-api-key: ${config.headers['x-api-key']}\r\n` }
  throw new AxiosError('Request failed with status code 403', 'ERR_BAD_REQUEST', config, request, {
    status: 403, statusText: 'Forbidden', data: { message: 'Insufficient balance' }, headers: {}, config, request,
  })
}

// Found on staging, 2026-10-15: a failed Tatum call logged its x-api-key
describe('redactAxios', () => {
  it('keeps the key out of a logged axios error, and keeps what callers read', async () => {
    const err = await axios.post('https://api.tatum.io/v3/ledger/transaction', { amount: '1' }, {
      headers: { 'x-api-key': KEY, Authorization: `Bearer ${KEY}` }, adapter: refuse,
    }).catch(e => e)

    expect(inspect(err, { depth: 6 })).not.toContain(KEY)
    expect(JSON.stringify(err.toJSON())).not.toContain(KEY)
    expect(err.config.headers['x-api-key']).toBe(REDACTED)

    expect(axios.isAxiosError(err)).toBe(true)
    expect(err.response.status).toBe(403)
    expect(err.response.data).toEqual({ message: 'Insufficient balance' })
    expect(err.request).toBeDefined()
    expect(inspect(err)).toContain('Insufficient balance')
  })

  it('leaves other headers and anything that is not an error alone', () => {
    const config = { headers: new AxiosHeaders({ 'Content-Type': 'application/json', 'X-API-KEY': KEY }) }
    redactAxiosError({ config })
    expect(config.headers['Content-Type']).toBe('application/json')
    expect(config.headers['X-API-KEY']).toBe(REDACTED)
    expect(redactAxiosError(undefined)).toBeUndefined()
    expect(redactAxiosError('text')).toBe('text')
  })
})
