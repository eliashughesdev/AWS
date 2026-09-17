export type Network = 'TRON' | 'SOL'

// Tatum ledger currencies the app supports, mapped to the network they settle on.
// Mirrors Tatum's model: the asset *is* the ledger currency, so an account's `chain`
// field holds one of these keys — not a network. Use networkFor() wherever the network
// itself is needed (KMS key spec, address derivation, Tatum subscriptions).
const LEDGER_CURRENCIES: Record<string, Network> = {
  TRON: 'TRON',
  SOL: 'SOL',
  USDT_TRON: 'TRON',
  // Shasta stand-in: real USDT_TRON is reserved by Tatum and has no testnet faucet,
  // so testnet uses a self-registered TRC-20 with the same 6 decimals.
  TEST_USDT_TRON: 'TRON',
}

export const networkFor = (currency?: string): Network | undefined =>
  currency ? LEDGER_CURRENCIES[currency.toUpperCase()] : undefined

// True when the currency is the network's own coin (TRON, SOL) rather than a token.
export const isNativeCurrency = (currency?: string): boolean =>
  !!currency && networkFor(currency) === currency.toUpperCase()

const TRC20_CONTRACTS: Record<string, string> = {
  USDT_TRON: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  TEST_USDT_TRON: 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
}

export const trc20ContractFor = (currency?: string): string | undefined =>
  currency ? TRC20_CONTRACTS[currency.toUpperCase()] : undefined
