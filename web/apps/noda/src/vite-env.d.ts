/// <reference types="vite/client" />
/// <reference path="../../../core/src/env.d.ts" />

interface ImportMetaEnv {
  // Where the app's addresses start, when not where its files are (src/router/index.ts)
  readonly VITE_ROUTER_BASE?: string
}
