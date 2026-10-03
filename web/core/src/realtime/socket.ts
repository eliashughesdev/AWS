import { WS_BASE } from '../config'

// Fields the views read from a PAYMENT_RESULT push (deposits and withdrawals share it).
export interface PaymentResult {
  success?: boolean
  status?: string
  error?: string
  authenticationUrl?: string
  txId?: string
}

export interface PaymentResultWatch {
  close(): void
}

// Waits for the PAYMENT_RESULT of one operation. Open it before the HTTP call that
// starts the operation, so a fast result isn't missed. The server delivers it to the
// connection whose userId and paymentId (= the view's transactionId) both match.
export function watchPaymentResult(
  userId: string,
  transactionId: string,
  { onResult, onTimeout, timeoutMs = 60_000 }: {
    onResult: (data: PaymentResult) => void
    onTimeout: () => void
    timeoutMs?: number
  },
): PaymentResultWatch {
  let ws: WebSocket | null = new WebSocket(`${WS_BASE}?userId=${userId}&paymentId=${transactionId}`)
  let timer: ReturnType<typeof setTimeout> | null = null

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'PAYMENT_RESULT') onResult(msg.data)
    } catch { /* ignore parse errors */ }
  }
  // A socket error doesn't end the operation — the result may still arrive, or the timeout fires.
  ws.onerror = () => console.warn('WebSocket error; will rely on timeout fallback')
  timer = setTimeout(onTimeout, timeoutMs)

  return {
    close() {
      if (timer) { clearTimeout(timer); timer = null }
      if (ws) { ws.close(); ws = null }
    },
  }
}
