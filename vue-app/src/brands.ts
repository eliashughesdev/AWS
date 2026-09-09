// Which client's skin this build wears. Colours and fonts live in the matching
// [data-brand] block in assets/main.css; this file carries the identity that is
// not expressible as CSS — name, tagline, logo.
//
// Adding a client: a block in main.css, an entry here, and VITE_BRAND set in
// that environment's Amplify console.

import nodaLogo from './assets/noda-logo.png'

export type BrandKey = 'loudibly' | 'noda'

export interface Brand {
  key: BrandKey
  /** Product name, shown in the tab title and throughout user-facing copy. */
  name: string
  /** Sub-label under the logo in the sidebar. */
  tagline: string
  /** Logo image. Brands without one fall back to a text wordmark and `icon`. */
  logoSrc?: string
  /** Material symbol used as the auth-screen mark when there is no logoSrc. */
  icon: string
}

const BRANDS: Record<BrandKey, Brand> = {
  loudibly: {
    key: 'loudibly',
    name: 'Loudibly',
    tagline: 'Institutional Access',
    icon: 'deployed_code',
  },
  noda: {
    key: 'noda',
    name: 'NODA',
    tagline: 'Smart Wallet',
    logoSrc: nodaLogo,
    icon: 'deployed_code',
  },
}

const DEFAULT_BRAND: BrandKey = 'loudibly'

function isBrandKey(value: string | undefined): value is BrandKey {
  return value !== undefined && value in BRANDS
}

function resolveBrand(): Brand {
  // Dev-only: preview any skin with ?brand=noda. Deliberately not honoured in a
  // production build — a brand switch from the query string would let any URL
  // dress the app up as another client.
  if (import.meta.env.DEV) {
    const requested = new URLSearchParams(window.location.search).get('brand') ?? undefined
    if (isBrandKey(requested)) return BRANDS[requested]
  }

  const configured = import.meta.env.VITE_BRAND
  return BRANDS[isBrandKey(configured) ? configured : DEFAULT_BRAND]
}

export const brand: Brand = resolveBrand()

export function applyBrand(): void {
  document.documentElement.dataset.brand = brand.key
  document.title = brand.name
}
