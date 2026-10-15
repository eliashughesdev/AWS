// What an API key may do (docs/public-api-plan.md D5). Each public route names the permission a
// key needs to call it (publicRoutes.ts), and a key holds a set of them, chosen by its owner.
//
// A read never moves money; anything that moves money is a permission of its own (group
// 'move-money'). Whether an operation needs approved KYC is not a permission's business: the route
// checks its merchant's KYC policy for the currency and operation (docs/public-api-plan.md D11),
// for a key and a signed-in user alike.
//
// Kept free of imports, like publicRoutes.ts, which uses its types.

// Who may hold a permission: a user's key, or a merchant's key (D9)
export type PermissionOwner = 'user' | 'merchant'

// How the key screens group them: View is ticked on a new key
export type PermissionGroup = 'view' | 'manage' | 'move-money' | 'users'

export type PermissionInfo = {
  description: string
  group: PermissionGroup
  owner: PermissionOwner
}

export const permissions = {
  'profile:read': { description: 'Read your profile', group: 'view', owner: 'user' },
  'profile:write': { description: 'Change your name and email', group: 'manage', owner: 'user' },
  'kyc:read': { description: 'Read your identity verification status', group: 'view', owner: 'user' },
  'kyc:write': { description: 'Start identity verification', group: 'manage', owner: 'user' },
  'accounts:read': { description: 'Read your accounts, balances and deposit addresses', group: 'view', owner: 'user' },
  'accounts:write': { description: 'Open and rename accounts', group: 'manage', owner: 'user' },
  'transactions:read': { description: 'Read your transactions and transfers', group: 'view', owner: 'user' },
  'transfers:create': { description: 'Transfer between accounts', group: 'move-money', owner: 'user' },
  'withdrawals:read': { description: 'Read your withdrawals and estimate new ones', group: 'view', owner: 'user' },
  'withdrawals:create': { description: 'Withdraw to an address', group: 'move-money', owner: 'user' },
  'payment-methods:read': { description: 'Read your saved cards', group: 'view', owner: 'user' },
  'deposits:read': { description: 'Read your card deposits', group: 'view', owner: 'user' },
  'deposits:create': { description: 'Charge a saved card into an account', group: 'move-money', owner: 'user' },
  'rates:read': { description: 'Read exchange rates', group: 'view', owner: 'user' },
  'users:create': { description: 'Register your users', group: 'users', owner: 'merchant' },
  'users:invite': { description: 'Send your users their sign-in invitation again', group: 'users', owner: 'merchant' },
  'users:read': { description: 'Read your users and their saved cards', group: 'users', owner: 'merchant' },
} as const satisfies Record<string, PermissionInfo>

export type Permission = keyof typeof permissions

export const isPermission = (name: unknown): name is Permission =>
  typeof name === 'string' && Object.hasOwn(permissions, name)

// What a public route needs from an API key:
// - a permission the key must hold
// - 'any': every key may call it (GET /v1/me only, so a key can always be tested)
// - null: no API key may call it, whatever it holds (adding a card, D1.9)
export type RoutePermission = Permission | 'any' | null
