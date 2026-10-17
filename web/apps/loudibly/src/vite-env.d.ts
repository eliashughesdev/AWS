/// <reference types="vite/client" />
/// <reference path="../../../core/src/env.d.ts" />

interface ImportMetaEnv {
  readonly VITE_BRAND?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
