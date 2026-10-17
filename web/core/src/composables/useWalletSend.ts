import { computed, ref, type Ref } from 'vue'
import { bust, readWallet } from '../wallet/reads'
import type { SessionWallet } from '../wallet/session'
import { sendSolanaTransaction } from '../wallet/solana'
import { sendTronTransaction } from '../wallet/tron'

// Solana cannot spend its entire balance — a little must remain for fees.
export const SOL_FEE_BUFFER = 0.000005

// Sending from one of the session's wallets; `wallet` is the one picked in the form.
export function useWalletSend(wallet: Readonly<Ref<SessionWallet | null>>) {
  const balance = ref<number | null>(null)

  const maxSendable = computed(() => {
    if (balance.value === null || !wallet.value) return 0
    const max = wallet.value.chain === 'SOL' ? balance.value - SOL_FEE_BUFFER : balance.value
    return max > 0 ? max : 0
  })

  async function loadBalance() {
    if (!wallet.value) return
    balance.value = null
    try {
      const read = await readWallet(wallet.value.chain, wallet.value.address)
      balance.value = read.balance
    } catch (e) {
      console.error('Failed to read balance', e)
    }
  }

  // Signed and broadcast entirely in this browser with the in-session key — the server
  // is never involved and never sees the key. Resolves with the transaction id.
  async function send(to: string, amount: string) {
    const w = wallet.value
    if (!w) throw new Error('No wallet selected')

    const txId = w.chain === 'SOL'
      ? await sendSolanaTransaction(w.privateKey, to, amount)
      : await sendTronTransaction(w.privateKey, to, amount)

    // Our own action shouldn't wait out the read TTL.
    bust(w.address)
    return txId
  }

  return { balance, maxSendable, loadBalance, send }
}
