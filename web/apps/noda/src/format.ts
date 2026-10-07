const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// "$12,580.50". An amount that cannot be priced is a dash, never a wrong number.
export const usd = (value: number | null) => value === null ? '—' : dollars.format(value)
