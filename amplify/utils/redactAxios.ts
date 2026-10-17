import axios from 'axios'

/**
 * Keeps provider credentials out of the logs. An axios error carries its request's headers twice:
 * in `config.headers`, and as raw text inside `request`, the Node ClientRequest. Logging the error,
 * as the providers and the routes that call them do, printed the Tatum API key (found on staging,
 * 2026-10-15). So every error axios rejects with is cleaned before anyone sees it: a credential
 * header's value becomes `[redacted]`, and `request` stays readable but is no longer printed.
 * Status, response body, method and URL are kept. Imported by each provider that sends a key.
 */

const SECRET_HEADERS = new Set(['x-api-key', 'authorization', 'proxy-authorization', 'cookie'])

export const REDACTED = '[redacted]'

const maskHeaders = (headers: Record<string, unknown> | undefined) => {
  if (!headers || typeof headers !== 'object') return
  for (const name of Object.keys(headers)) {
    if (SECRET_HEADERS.has(name.toLowerCase())) headers[name] = REDACTED
  }
}

// util.inspect and JSON.stringify skip a property that is not enumerable
const hide = (holder: any, name: string) => {
  if (holder && Object.prototype.hasOwnProperty.call(holder, name)) {
    Object.defineProperty(holder, name, { value: holder[name], enumerable: false, writable: true, configurable: true })
  }
}

export function redactAxiosError<T>(err: T): T {
  const e = err as any
  if (!e || typeof e !== 'object') return err
  maskHeaders(e.config?.headers)
  maskHeaders(e.response?.config?.headers)
  hide(e, 'request')
  hide(e.response, 'request')
  return err
}

// Tests that mock axios have no interceptors
axios.interceptors?.response.use(undefined, err => Promise.reject(redactAxiosError(err)))
