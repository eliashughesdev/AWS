/**
 * Returns the price of 1 unit of `crypto` in `fiat` using the Binance ticker API.
 * Throws if the symbol pair is not found on Binance.
 *
 * Example: fetchCryptoPrice('BTC', 'USD') → 50000
 *          fetchCryptoPrice('SOL', 'EUR') → 140.5
 */
export const fetchCryptoPrice = async (crypto: string, fiat: string): Promise<number> => {
  const symbol = `${crypto.toUpperCase()}${fiat.toUpperCase()}`
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  console.log(`EXCHANGE_RATE: Fetching price for ${symbol} from Binance`)

  const res = await fetch(url)
  const data = await res.json() as any

  if (!res.ok || data.code || !data.price) {
    const msg = data.msg || 'Unknown error'
    throw new Error(`EXCHANGE_RATE: Price not available for ${symbol} — ${msg}`)
  }

  const price = parseFloat(data.price)
  console.log(`EXCHANGE_RATE: ${symbol} = ${price}`)
  return price
}
