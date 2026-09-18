// Endpoints are injected at build time from Vite env vars, set per branch in the
// Amplify console (same mechanism as VITE_TRON_NETWORK). See .env.example for local dev.
// Note: import.meta.env keys must be referenced statically — Vite does not replace
// dynamic key access in production builds.
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set — add it in the Amplify console, or in vue-app/.env for local dev`)
  }
  return value.replace(/\/+$/, '')
}

export const API_BASE   = required('VITE_API_BASE', import.meta.env.VITE_API_BASE)
export const WS_BASE    = required('VITE_WS_BASE', import.meta.env.VITE_WS_BASE)
export const RELAY_BASE = required('VITE_EVERVAULT_RELAY_BASE', import.meta.env.VITE_EVERVAULT_RELAY_BASE)

// Ledger currency to request when creating a USDT-TRON custodial account. Real
// USDT_TRON is a Tatum mainnet-only built-in with no testnet faucet; testnet uses a
// self-registered TRC-20 stand-in, TEST_USDT_TRON. Mirrors VITE_TRON_NETWORK.
export const USDT_TRON_CURRENCY = import.meta.env.VITE_TRON_NETWORK === 'mainnet' ? 'USDT_TRON' : 'TEST_USDT_TRON'
