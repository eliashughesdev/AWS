// The routes the public API exposes, out of everything the router serves.
// backend.ts gives each one its own resource on that API, and the router
// refuses any other route that arrives through it. Staff (/merchants/*),
// provider callbacks (/webhook/*) and internal operations stay on the
// internal API only. docs/openapi/public-api.yaml documents every route here.
//
// Kept free of imports: backend.ts reads it at synth time. The one below names types only and is
// erased when compiled.

import type { RoutePermission } from './permissions'

// The public API's stage sets the API_SURFACE stage variable to this
export const PUBLIC_API_SURFACE = 'public'

export type PublicRoute = {
  path: string
  method: 'GET' | 'POST' | 'PATCH'
} & (
  // custom: the authorizer checks a JWT, an HMAC signature or an API key, and an API key must
  // hold the route's permission (permissions.ts; enforced by the router from step 2.5)
  | { auth: 'custom', permission: RoutePermission }
  // none: the request carries its own credential, and no key is involved
  | { auth: 'none', permission?: never }
)

export const publicRoutes: PublicRoute[] = [
  // Merchant platforms, signed with their API key
  { path: '/accounts/onboarding', method: 'POST', auth: 'custom', permission: 'users:create' },
  { path: '/accounts/onboarding/resend', method: 'POST', auth: 'custom', permission: 'users:invite' },
  // The payer's claim link: the one-time token is the credential
  { path: '/onboarding/verify', method: 'POST', auth: 'none' },
  { path: '/onboarding/claim', method: 'POST', auth: 'none' },
  // Signed-in users
  { path: '/accounts/profile', method: 'GET', auth: 'custom', permission: 'profile:read' },
  { path: '/accounts/profile/save', method: 'POST', auth: 'custom', permission: 'profile:write' },
  { path: '/accounts/list', method: 'GET', auth: 'custom', permission: 'accounts:read' },
  { path: '/accounts/account', method: 'POST', auth: 'custom', permission: 'accounts:write' },
  { path: '/accounts/rename', method: 'POST', auth: 'custom', permission: 'accounts:write' },
  { path: '/accounts/transactions', method: 'POST', auth: 'custom', permission: 'transactions:read' },
  { path: '/accounts/kyc/status', method: 'GET', auth: 'custom', permission: 'kyc:read' },
  { path: '/accounts/kyc/didit/session', method: 'POST', auth: 'custom', permission: 'kyc:write' },
  { path: '/accounts/transfer', method: 'POST', auth: 'custom', permission: 'transfers:create' },
  { path: '/accounts/deposit', method: 'POST', auth: 'custom', permission: 'deposits:create' },
  { path: '/accounts/withdraw', method: 'POST', auth: 'custom', permission: 'withdrawals:create' },
  // Card data reaches us only encrypted by Evervault in the browser: no key may add a card (D1.9)
  { path: '/payments/save', method: 'POST', auth: 'custom', permission: null },
  { path: '/payments/list', method: 'GET', auth: 'custom', permission: 'payment-methods:read' },
]

export const isPublicRoute = (path: string, method: string) =>
  publicRoutes.some(r => r.path === path && r.method === method)
