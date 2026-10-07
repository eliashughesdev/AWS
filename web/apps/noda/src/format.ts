const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// "$12,580.50". An amount that cannot be priced is a dash, never a wrong number.
export const usd = (value: number | null) => value === null ? '—' : dollars.format(value)

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
