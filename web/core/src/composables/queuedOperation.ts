import { onScopeDispose, ref } from 'vue'
import type { ApiResult } from '../api/client'
import { watchPaymentResult, type PaymentResult, type PaymentResultWatch } from '../realtime/socket'

export type OperationStatus = 'idle' | 'processing' | 'success' | 'failed'

// The app's wording for each way an operation can fail. A message from the server wins.
export interface FailureMessages {
  rejected: string    // the API refused the request
  failed: string      // the result came back unsuccessful
  timeout: string     // no result arrived in time
  unexpected: string  // the request itself failed
}

// An operation the API only queues: the HTTP call starts it and the outcome arrives
// later as a PAYMENT_RESULT push.
export function useQueuedOperation(messages: FailureMessages) {
  const status     = ref<OperationStatus>('idle')
  const error      = ref('')
  const submitting = ref(false)

  let resultWatch: PaymentResultWatch | null = null

  function stopWaiting() {
    resultWatch?.close()
    resultWatch = null
  }
  onScopeDispose(stopWaiting)

  function fail(message: string) {
    status.value = 'failed'
    error.value  = message
  }

  async function run(
    userId: string,
    request: (transactionId: string) => Promise<ApiResult<unknown>>,
    onResult: (data: PaymentResult) => void,
  ) {
    const transactionId = crypto.randomUUID()

    // Open the socket before the HTTP call so a fast result isn't missed.
    resultWatch = watchPaymentResult(userId, transactionId, {
      onResult: (data) => {
        stopWaiting()
        onResult(data)
      },
      onTimeout: () => {
        if (status.value === 'processing') {
          stopWaiting()
          fail(messages.timeout)
        }
      },
    })

    status.value     = 'processing'
    submitting.value = true

    try {
      const { ok, data } = await request(transactionId)
      if (!ok) {
        stopWaiting()
        fail(data.message ?? messages.rejected)
      }
      // Accepted (queued): the status stays 'processing' until the push arrives.
    } catch {
      stopWaiting()
      fail(messages.unexpected)
    } finally {
      submitting.value = false
    }
  }

  function reset() {
    status.value = 'idle'
    error.value  = ''
  }

  return { status, error, submitting, run, fail, reset }
}
