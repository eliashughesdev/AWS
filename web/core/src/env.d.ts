// Env vars read by core. Each app pulls this in from its own vite-env.d.ts.
interface ImportMetaEnv {
  readonly VITE_API_BASE: string
  readonly VITE_WS_BASE: string
  readonly VITE_EVERVAULT_RELAY_BASE: string
  readonly VITE_PUBLIC_API_BASE?: string
  readonly VITE_TRON_NETWORK?: string
  readonly VITE_SOLANA_NETWORK?: string
  readonly OPENREPLAY_PROJECT_KEY?: string
}
