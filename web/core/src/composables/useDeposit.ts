import { deposit } from '../api/accounts'
import { useQueuedOperation, type FailureMessages } from './queuedOperation'

// A card deposit into one of the user's accounts.
export function useDeposit(messages: FailureMessages) {
  const { status, error, failure, errorCode, submitting, run, fail, reset } = useQueuedOperation(messages)

  function send({ accountNo, cardId, amount, userId, email }: {
    accountNo: string
    cardId: string
    amount: number
    userId: string
    email: string
  }) {
    return run(
      userId,
      transactionId => deposit({
        accountNumber: accountNo,
        currency:      'USD',
        amount,
        paymentId:     cardId,
        userId,
        email,
        transactionId,
      }),
      (data) => {
        if (data.success && data.status === 'succeeded') {
          status.value = 'success'
        } else if (data.status === 'requires_action' && data.authenticationUrl) {
          // 3-D Secure. Known gap: the socket is closed by now, so the outcome of the
          // challenge never arrives and the status stays 'processing'.
          window.open(data.authenticationUrl, '_blank')
        } else {
          fail(data.error ?? messages.failed)
        }
      },
    )
  }

  return { status, error, failure, errorCode, submitting, send, reset }
}
