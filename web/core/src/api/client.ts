import { getAccessToken } from '../auth/cognito'
import { API_BASE } from '../config'

// Error bodies come from amplify/errors/http.ts.
export interface ApiErrorBody {
  message?: string
  error_code?: number
}

// Never throws on an error status — callers branch on `ok`, as the views always have.
// It still throws when the request itself fails (offline, DNS, CORS).
export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T & ApiErrorBody
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  auth?: boolean
  base?: string
}

async function authHeader(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` }
}

export async function request<T>(
  path: string,
  { method = 'GET', body, auth = true, base = API_BASE }: RequestOptions = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'X-Project': 'web' }
  if (auth) Object.assign(headers, await authHeader())
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}
