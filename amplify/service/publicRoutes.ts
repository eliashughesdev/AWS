// The routes the public API exposes, out of everything the router serves.
// backend.ts gives each one its own resource on that API, and the router
// refuses any other route that arrives through it. Staff (/merchants/*),
// provider callbacks (/webhook/*) and internal operations stay on the
// internal API only. docs/openapi/public-api.yaml documents every route here.
//
// Kept free of imports: backend.ts reads it at synth time.

// The public API's stage sets the API_SURFACE stage variable to this
export const PUBLIC_API_SURFACE = 'public'

export type PublicRoute = {
  path: string
  method: 'GET' | 'POST'
  // custom: the HMAC/JWT authorizer; none: the request carries its own credential
  auth: 'custom' | 'none'
}

export const publicRoutes: PublicRoute[] = [
  // Merchant platforms, signed with their API key
  { path: '/accounts/onboarding', method: 'POST', auth: 'custom' },
  { path: '/accounts/onboarding/resend', method: 'POST', auth: 'custom' },
  // The payer's claim link: the one-time token is the credential
  { path: '/onboarding/verify', method: 'POST', auth: 'none' },
  { path: '/onboarding/claim', method: 'POST', auth: 'none' },
  // Signed-in users
  { path: '/accounts/profile', method: 'GET', auth: 'custom' },
  { path: '/accounts/profile/save', method: 'POST', auth: 'custom' },
  { path: '/accounts/list', method: 'GET', auth: 'custom' },
  { path: '/accounts/account', method: 'POST', auth: 'custom' },
  { path: '/accounts/transactions', method: 'POST', auth: 'custom' },
  { path: '/accounts/kyc/status', method: 'GET', auth: 'custom' },
  { path: '/accounts/kyc/didit/session', method: 'POST', auth: 'custom' },
  { path: '/accounts/transfer', method: 'POST', auth: 'custom' },
  { path: '/accounts/deposit', method: 'POST', auth: 'custom' },
  { path: '/accounts/withdraw', method: 'POST', auth: 'custom' },
  { path: '/payments/save', method: 'POST', auth: 'custom' },
  { path: '/payments/list', method: 'GET', auth: 'custom' },
]

export const isPublicRoute = (path: string, method: string) =>
  publicRoutes.some(r => r.path === path && r.method === method)
