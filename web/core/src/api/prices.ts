// Binance's public ticker quotes in USDT, which the UI shows as USD.
const BINANCE_SYMBOL: Record<string, string> = { TRON: 'TRX' }

// null when Binance has no such pair. Throws when the request itself fails.
export async function getUsdPrice(chain: string): Promise<number | null> {
  const ticker = BINANCE_SYMBOL[chain] ?? chain
  const res  = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${ticker}USDT`)
  const data = await res.json()
  return data.price ? parseFloat(data.price) : null
}

// Tokens that are a dollar by design. Binance quotes in USDT, so it has no pair for them.
const PEGGED = ['USDT_TRON', 'TUSDT_TRON']

// One price per chain asked for. null where there is none or its request failed.
export async function getUsdPrices(chains: string[]): Promise<Record<string, number | null>> {
  const unique = [...new Set(chains)]
  const prices = await Promise.all(
    unique.map(chain => PEGGED.includes(chain) ? 1 : getUsdPrice(chain).catch(() => null)),
  )
  return Object.fromEntries(unique.map((chain, i) => [chain, prices[i]]))
}
