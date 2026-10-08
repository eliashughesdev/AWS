import { ref } from 'vue'
import bs58 from 'bs58'
import { withdraw } from '../api/accounts'
import { useQueuedOperation, type FailureMessages } from './queuedOperation'

// What the backend sets aside for the network fee when an account sends its network's own coin
// (WITHDRAWAL_FEES in amplify/providers/ledger/tatum/tatum.ts), so a withdrawal has to leave it.
// A token leaves nothing: its gas is paid from the merchant's master.
const FEE_RESERVES: Record<string, number> = { TRON: 1, SOL: 0.000005 }
export const withdrawalFeeReserve = (chain: string) => FEE_RESERVES[chain] ?? 0

function base58Bytes(text: string) {
  try {
    return bs58.decode(text)
  } catch {
    return new Uint8Array()
  }
}

// Whether an address has the shape of one on the currency's network: a Solana address is 32 bytes,
// a TRON one 25 that start with 0x41. It catches another network's address or a cut paste, not a
// mistyped character (TRON's checksum is not verified). A network not known here is not checked.
export function looksLikeAddress(chain: string, address: string) {
  const bytes = base58Bytes(address)
  if (chain === 'SOL') return bytes.length === 32
  if (chain === 'TRON' || chain.endsWith('_TRON')) return bytes.length === 25 && bytes[0] === 0x41
  return true
}

// A withdrawal from a custodial account to an on-chain address.
export function useWithdraw(messages: FailureMessages) {
  const { status, error, failure, errorCode, submitting, run, fail, reset: resetOperation } = useQueuedOperation(messages)
  const txId = ref('')

  // `unit` says what `amount` is in: US dollars, or the account's own coin.
  function send({ accountNo, chain, amount, unit, userId, destinationAddress }: {
    accountNo: string
    chain?: string
    amount: number
    unit: 'usd' | 'crypto'
    userId: string
    destinationAddress: string
  }) {
    const inCrypto = unit === 'crypto'
    return run(
      userId,
      transactionId => withdraw({
        accountNumber: accountNo,
        currency:      inCrypto ? (chain ?? 'TRON') : 'USD',
        ...(inCrypto ? { cryptoAmount: amount } : { amount }),
        userId,
        destinationAddress,
        transactionId,
      }),
      (data) => {
        if (data.success && data.status === 'withdrawal_complete') {
          status.value = 'success'
          txId.value   = data.txId ?? ''
        } else {
          fail(data.error ?? messages.failed)
        }
      },
    )
  }

  function reset() {
    resetOperation()
    txId.value = ''
  }

  return { status, error, failure, errorCode, txId, submitting, send, reset }
}
