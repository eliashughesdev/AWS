// Binance's public ticker quotes in USDT, which the UI shows as USD.
const BINANCE_SYMBOL: Record<string, string> = { TRON: 'TRX' }

// null when Binance has no such pair. Throws when the request itself fails.
export async function getUsdPrice(chain: string): Promise<number | null> {
  const ticker = BINANCE_SYMBOL[chain] ?? chain
  const res  = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${ticker}USDT`)
  const data = await res.json()
  return data.price ? parseFloat(data.price) : null
}
