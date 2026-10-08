const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// "$12,580.50". An amount that cannot be priced is a dash, never a wrong number.
export const usd = (value: number | null) => value === null ? '—' : dollars.format(value)

// A value in USD: undefined until the prices are read, null when the coin has no price.
export type UsdValue = number | null | undefined

// `price` is the coin's entry in usePrices().prices.
export function usdValue(amount: number, price: number | null | undefined): UsdValue {
  // Nothing is worth nothing at any price.
  if (amount === 0) return 0
  return typeof price === 'number' ? amount * price : price
}

// Unknown as soon as one of the values is.
export function usdSum(values: UsdValue[]): UsdValue {
  let total = 0
  for (const value of values) {
    if (typeof value !== 'number') return value
    total += value
  }
  return total
}

// A value not read yet leaves its line empty, at its height.
export const BLANK = '\u00a0'
export const priced = (value: UsdValue) => value === undefined ? BLANK : usd(value)

const units = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })

// "1,284.5321": an amount in a coin's own units.
export const coinAmount = (value: number) => units.format(value)

const relative = new Intl.RelativeTimeFormat('en-US')
const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })

// "2 hours ago". A date once it is over 30 days old.
export function timeAgo(iso: string) {
  const then = new Date(iso)
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000)
  if (Number.isNaN(minutes)) return ''
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return relative.format(-minutes, 'minute')
  if (minutes < 60 * 24) return relative.format(-Math.floor(minutes / 60), 'hour')
  if (minutes < 60 * 24 * 30) return relative.format(-Math.floor(minutes / (60 * 24)), 'day')
  return date.format(then)
}

const two = (value: number) => String(value).padStart(2, '0')

// "2026-10-07 14:32", in the browser's time zone.
export function dateTime(iso: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`
}

// "92d2be…d2fb": the two ends of a transaction id or an address.
export const shorten = (text: string, head = 6, tail = 4) =>
  text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`
