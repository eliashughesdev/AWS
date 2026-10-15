import { ref } from 'vue'
import { transfer } from '../api/accounts'
import { LEDGER_PROVIDER } from '../config'
import type { FailureMessages, OperationStatus } from './queuedOperation'

// A transfer between two custodial accounts. The API answers with the outcome directly.
export function useTransfer(messages: Pick<FailureMessages, 'rejected' | 'unexpected'>) {
  const status     = ref<OperationStatus>('idle')
  const error      = ref('')
  // The API's error_code when it refused, e.g. KYC_REQUIRED (useKyc).
  const errorCode  = ref<number>()
  const submitting = ref(false)

  async function send({ from, to, amount }: { from: string; to: string; amount: number }) {
    status.value     = 'processing'
    submitting.value = true
    errorCode.value  = undefined

    try {
      const { ok, data } = await transfer({
        provider:               LEDGER_PROVIDER,
        senderAccountNumber:    from,
        recipientAccountNumber: to,
        amount:                 amount.toString(),
      })

      if (ok && data.success) {
        status.value = 'success'
      } else {
        status.value    = 'failed'
        error.value     = data.message ?? messages.rejected
        errorCode.value = data.error_code
      }
    } catch {
      status.value = 'failed'
      error.value  = messages.unexpected
    } finally {
      submitting.value = false
    }
  }

  function reset() {
    status.value    = 'idle'
    error.value     = ''
    errorCode.value = undefined
  }

  return { status, error, errorCode, submitting, send, reset }
}
