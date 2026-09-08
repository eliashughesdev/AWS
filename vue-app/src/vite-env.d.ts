/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
  readonly VITE_WS_BASE: string
  readonly VITE_EVERVAULT_RELAY_BASE: string
  readonly VITE_TRON_NETWORK?: string
  readonly VITE_SOLANA_NETWORK?: string
  readonly OPENREPLAY_PROJECT_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
