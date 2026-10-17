// What the API keys screen shows of a key and how it words the API's answers.
import type { ApiKey, ApiKeyPermission, ApiKeyPermissionGroup } from '@loudibly/core/api/types'
import type { PillStatus } from './tones'

// The three boxes of the permission picker, in this order. `users` is a merchant's and never offered here.
export const permissionGroups: { group: ApiKeyPermissionGroup; label: string }[] = [
  { group: 'view',       label: 'View' },
  { group: 'manage',     label: 'Manage' },
  { group: 'move-money', label: 'Move money' },
]

// A new key starts with every View permission ticked.
export const viewPermissions = (catalogue: ApiKeyPermission[]) =>
  catalogue.filter(permission => permission.group === 'view').map(permission => permission.name)

// The groups a key holds anything in, for the table: "View · Move money".
export function permissionSummary(names: string[], catalogue: ApiKeyPermission[]) {
  const groupOf = new Map(catalogue.map(permission => [permission.name, permission.group]))
  const held = new Set(names.map(name => groupOf.get(name)))
  return permissionGroups.filter(({ group }) => held.has(group)).map(({ label }) => label).join(' · ') || '—'
}

export const isExpired = (key: ApiKey) => !!key.expiresAt && Date.parse(key.expiresAt) <= Date.now()

export function keyStatus(key: ApiKey): PillStatus {
  if (key.status === 'revoked') return 'Revoked'
  return isExpired(key) ? 'Expired' : 'Active'
}

export const allowedIps = (key: ApiKey) =>
  !key.ipAllowlist.length ? 'Any IP' : key.ipAllowlist.length === 1 ? key.ipAllowlist[0] : `${key.ipAllowlist[0]} +${key.ipAllowlist.length - 1}`

// "lk_live_8f…a2": enough to tell keys apart.
export const shortKeyId = (keyId: string) => `${keyId.slice(0, 10)}…${keyId.slice(-2)}`

// The allowed IPs field: one address a line, blank lines dropped. The API checks each one.
export const ipLines = (text: string) => text.split(/[\s,]+/).map(line => line.trim()).filter(Boolean)

// How long a new key lasts.
export const expiries = [
  { value: 'never', label: 'Never' },
  { value: '30',    label: '30 days' },
  { value: '90',    label: '90 days' },
  { value: '365',   label: '1 year' },
]

export const expiresAt = (choice: string) =>
  choice === 'never' ? undefined : new Date(Date.now() + Number(choice) * 24 * 60 * 60 * 1000).toISOString()

// The refusals a key's form can get, by the API's error_code. What is not here is a generic "try again".
export const refusals: Record<number, string> = {
  100054: 'You already have 10 keys in use. Revoke one before you create another.',
  100058: 'One of the permissions is not available. Reload the page and choose again.',
  100060: 'This key is no longer active, so it cannot be changed.',
  100062: 'Each line of Allowed IPs must be one IPv4 or IPv6 address (no ranges), and at most 20.',
  100063: 'Open an account first: a key can only be used once you have one.',
}
