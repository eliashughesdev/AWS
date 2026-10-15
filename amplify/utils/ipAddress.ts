import { isIPv4, isIPv6 } from 'net'

// IP addresses as an API key's allowlist keeps them (docs/public-api-plan.md D2.3): single IPv4 or
// IPv6 addresses, no ranges, each written one way. fn/authorizer/apiKey.js writes the caller's
// address the same way before comparing, so the two must agree.

export const MAX_ALLOWED_IPS = 20

/** One spelling per address ('2001:DB8::0:1' → '2001:db8::1', '::ffff:1.2.3.4' → '1.2.3.4'), or null. */
export const normalizeIp = (ip: unknown): string | null => {
  if (typeof ip !== 'string') return null
  const trimmed = ip.trim()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed)
  if (mapped && isIPv4(mapped[1])) return mapped[1]
  if (isIPv4(trimmed)) return trimmed
  // A zone (fe80::1%eth0) names a local interface, never a caller's address
  if (isIPv6(trimmed) && !trimmed.includes('%')) return new URL(`http://[${trimmed}]`).hostname.slice(1, -1)
  return null
}

export type AllowlistCheck = { ok: true, ips: string[] } | { ok: false, bad: string }

/** A list as sent: each address normalised, duplicates dropped; `bad` is the entry refused, or 'too-many'. */
export const parseAllowlist = (entries: unknown[]): AllowlistCheck => {
  const ips: string[] = []
  for (const entry of entries) {
    const ip = normalizeIp(entry)
    if (!ip) return { ok: false, bad: String(entry).slice(0, 64) }
    if (!ips.includes(ip)) ips.push(ip)
  }
  if (ips.length > MAX_ALLOWED_IPS) return { ok: false, bad: 'too-many' }
  return { ok: true, ips }
}
