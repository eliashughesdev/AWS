import { reactive, computed } from 'vue'
import type { Chain } from './types'

export interface SessionWallet {
  chain: Chain
  address: string
  privateKey: string
}

// Non-custodial session. Held in memory only — never written to localStorage or
// sessionStorage, so closing the tab destroys the keys. The user re-enters a key
// to unlock. This list is also the non-custodial "account list": the server holds
// no record of these wallets.
const state = reactive({
  wallets: [] as SessionWallet[],
  activeAddress: '',
})

export function useWalletSession() {
  function addWallet(wallet: SessionWallet) {
    if (!state.wallets.some(w => w.address === wallet.address)) state.wallets.push(wallet)
    state.activeAddress = wallet.address
  }

  function setActive(address: string) {
    if (state.wallets.some(w => w.address === address)) state.activeAddress = address
  }

  function clear() {
    state.wallets.splice(0)
    state.activeAddress = ''
  }

  return {
    state,
    wallets: computed(() => state.wallets),
    active: computed(() => state.wallets.find(w => w.address === state.activeAddress) ?? null),
    isUnlocked: computed(() => state.wallets.length > 0),
    addWallet,
    setActive,
    clear,
  }
}

// Plain (non-reactive) check for use in the router guard.
export function isWalletUnlocked(): boolean {
  return state.wallets.length > 0
}
