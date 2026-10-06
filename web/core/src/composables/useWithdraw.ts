import { ref } from 'vue'
import { withdraw } from '../api/accounts'
import { useQueuedOperation, type FailureMessages } from './queuedOperation'

// A withdrawal from a custodial account to an on-chain address.
export function useWithdraw(messages: FailureMessages) {
  const { status, error, submitting, run, fail, reset: resetOperation } = useQueuedOperation(messages)
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

  return { status, error, txId, submitting, send, reset }
}
