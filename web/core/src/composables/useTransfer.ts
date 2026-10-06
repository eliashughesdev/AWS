import { ref } from 'vue'
import { transfer } from '../api/accounts'
import { LEDGER_PROVIDER } from '../config'
import type { FailureMessages, OperationStatus } from './queuedOperation'

// A transfer between two custodial accounts. The API answers with the outcome directly.
export function useTransfer(messages: Pick<FailureMessages, 'rejected' | 'unexpected'>) {
  const status     = ref<OperationStatus>('idle')
  const error      = ref('')
  const submitting = ref(false)

  async function send({ from, to, amount }: { from: string; to: string; amount: number }) {
    status.value     = 'processing'
    submitting.value = true

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
        status.value = 'failed'
        error.value  = data.message ?? messages.rejected
      }
    } catch {
      status.value = 'failed'
      error.value  = messages.unexpected
    } finally {
      submitting.value = false
    }
  }

  function reset() {
    status.value = 'idle'
    error.value  = ''
  }

  return { status, error, submitting, send, reset }
}
