// Endpoints are injected at build time from Vite env vars, set per branch in the
// Amplify console (same mechanism as VITE_TRON_NETWORK). See .env.example for local dev.
// Note: import.meta.env keys must be referenced statically — Vite does not replace
// dynamic key access in production builds.
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set — add it in the Amplify console, or in the app's .env for local dev`)
  }
  return value.replace(/\/+$/, '')
}

export const API_BASE   = required('VITE_API_BASE', import.meta.env.VITE_API_BASE)
export const WS_BASE    = required('VITE_WS_BASE', import.meta.env.VITE_WS_BASE)
export const RELAY_BASE = required('VITE_EVERVAULT_RELAY_BASE', import.meta.env.VITE_EVERVAULT_RELAY_BASE)
// The public API, the only one an API key works on. Optional: it is shown to the user (the key
// screens' curl example) and never called by the app.
export const PUBLIC_API_BASE = import.meta.env.VITE_PUBLIC_API_BASE?.replace(/\/+$/, '') || null

// Ledger currency to request when creating a USDT-TRON custodial account. Real
// USDT_TRON is a Tatum mainnet-only built-in; on testnet, Shasta's USDT contract is
// registered in Tatum as TUSDT_TRON.
export const USDT_TRON_CURRENCY = import.meta.env.VITE_TRON_NETWORK === 'mainnet' ? 'USDT_TRON' : 'TUSDT_TRON'

// The ledger currencies this build offers, as the backend's routes take them.
export const LEDGER_CURRENCIES = ['TRON', 'SOL', USDT_TRON_CURRENCY]

// The backend's code for its ledger provider (ProviderName.Tatum).
export const LEDGER_PROVIDER = 'PCF0001'
