import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { fetchAuthSession } from 'aws-amplify/auth'
import { API_BASE, WS_BASE } from '../config'

interface ProcessPaymentProps {
  user: any;
}

interface PaymentMethod {
  id: string;
  lastFour: string;
  bin?: string;
  cardType: string;
  expiryMonth?: string;
  expiryYear?: string;
}

type PaymentView = 'select' | 'processing' | 'success' | 'failure'

interface PaymentResult {
  transactionId: string;
  error?: string;
  status?: string;
}

// Card type SVG icons
const VisaIcon = () => (
  <svg fill='none' height='20' viewBox='0 0 32 20' width='32'>
    <rect fill='#1434CB' height='20' rx='3' width='32' />
    <path d='M11.6667 13.3333L13.1111 5.33333H15.1111L13.6667 13.3333H11.6667ZM21.3333 5.48889C20.9333 5.37778 20.3556 5.33333 19.8222 5.33333C18.1778 5.33333 17 6.13333 17 7.28889C17 8.13333 17.8222 8.62222 18.4444 8.91111C19.1111 9.2 19.3333 9.4 19.3333 9.68889C19.3333 10.1333 18.7556 10.3111 18.2667 10.3111C17.6889 10.3111 17.2 10.1778 16.7556 10L16.4889 11.2444C16.8889 11.4222 17.6 11.5556 18.2222 11.5556C19.9556 11.5556 21.0667 10.7778 21.0667 9.53333C21.0667 8.11111 18.9333 8.02222 18.9333 7.35556C18.9333 7.15556 19.1556 6.95556 19.6 6.88889C19.8222 6.84444 20.4444 6.8 21.1111 7.08889L21.3333 5.48889Z' fill='white' />
  </svg>
)

const MastercardIcon = () => (
  <svg height='20' viewBox='0 0 32 20' width='32'>
    <rect fill='#231F20' height='20' rx='3' width='32' />
    <circle cx='12' cy='10' fill='#EB001B' r='6' />
    <circle cx='20' cy='10' fill='#F79E1B' r='6' />
    <path d='M16 10C16 7.7 17.2 5.7 19 4.6C18.1 4.2 17.1 4 16 4C12.7 4 10 6.7 10 10C10 13.3 12.7 16 16 16C17.1 16 18.1 15.8 19 15.4C17.2 14.3 16 12.3 16 10Z' fill='#FF5F00' />
  </svg>
)

const AmexIcon = () => (
  <svg height='20' viewBox='0 0 32 20' width='32'>
    <rect fill='#2E77BC' height='20' rx='3' width='32' />
    <path d='M8 14L10.5 6H13L15.5 14H13.2L12.8 12.5H10.2L9.8 14H8ZM11 11H12L11.5 8.5L11 11Z' fill='white' />
    <path d='M16 6H20V7.5H18V9H20V10.5H18V12.5H20V14H16V6Z' fill='white' />
  </svg>
)

const DiscoverIcon = () => (
  <svg height='20' viewBox='0 0 32 20' width='32'>
    <rect fill='#FF6600' height='20' rx='3' width='32' />
    <circle cx='20' cy='10' fill='#fff' r='5' />
    <text fill='#FF6600' fontSize='5' fontWeight='bold' x='18' y='12'>D</text>
  </svg>
)

const getCardIcon = (cardType: string) => {
  switch (cardType.toLowerCase()) {
    case 'visa':
      return <VisaIcon />
    case 'mastercard':
      return <MastercardIcon />
    case 'amex':
    case 'american express':
      return <AmexIcon />
    case 'discover':
      return <DiscoverIcon />
    default:
      return <VisaIcon />
  }
}

export default function ProcessPayment({ user }: ProcessPaymentProps) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>('')
  const [amount] = useState<number>(50.00)
  const [currency] = useState<string>('EUR')
  const [provider, setProvider] = useState<string>('stripe')
  const [view, setView] = useState<PaymentView>('select')
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const WS_URL = WS_BASE

  useEffect(() => {
    loadPaymentMethods()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  const loadPaymentMethods = async () => {
    try {
      const session = await fetchAuthSession()
      const token = session.tokens?.accessToken?.toString()

      const response = await axios.get(
        `${API_BASE}/payments/list`,
        {
          headers: {
            'X-Project': 'e2e-hmac',
            Authorization: `Bearer ${token}`,
          },
        }
      )

      if (response.data.success && response.data.res) {
        setPaymentMethods(response.data.res)
        if (response.data.res.length > 0) {
          setSelectedPaymentId(response.data.res[0].id)
        }
      }
    } catch (error) {
      console.error('Error loading payment methods:', error)
    }
  }

  const connectWebSocket = (paymentId: string) => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        // The API sends the result to the Cognito id it charged for (userId), not the username
        `${WS_URL}?userId=${encodeURIComponent(user.userId)}&paymentId=${encodeURIComponent(paymentId)}`
      )

      ws.onopen = () => {
        console.log('WebSocket connected')
        wsRef.current = ws
        resolve()
      }

      ws.onmessage = (event) => {
        console.log('WebSocket message received:', event.data)
        try {
          const message = JSON.parse(event.data)

          if (message.type === 'PAYMENT_RESULT') {
            const data = message.data

            if (data.status === 'requires_action' && data.authenticationUrl) {
              // 3DS authentication required — redirect user to challenge page
              console.log('3DS required, redirecting to:', data.authenticationUrl)
              window.location.href = data.authenticationUrl
              return
            }

            if (data.success) {
              setPaymentResult({
                transactionId: data.transactionId || 'N/A',
              })
              setView('success')
            } else {
              setPaymentResult({
                transactionId: data.transactionId || 'N/A',
                error: data.error || data.status || 'Payment failed',
              })
              setView('failure')
            }

            setTimeout(() => {
              ws.close()
            }, 1000)
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        reject(error)
      }

      ws.onclose = () => {
        console.log('WebSocket disconnected')
        wsRef.current = null
      }
    })
  }

  const handlePayment = async () => {
    if (!selectedPaymentId) {
      return
    }

    setView('processing')

    try {
      const transactionPaymentId = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

      await connectWebSocket(transactionPaymentId)

      const session = await fetchAuthSession()
      const token = session.tokens?.accessToken?.toString()

      const selectedCard = paymentMethods.find(pm => pm.id === selectedPaymentId)

      await axios.post(
        `${API_BASE}/payments/process`,
        {
          paymentId: selectedPaymentId,
          amount,
          currency,
          provider,
          transactionId: transactionPaymentId,
          bin: selectedCard?.bin,
          // TODO: replace with values from Cognito (fetchUserAttributes) — hardcoded for testing purposes
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
        },
        {
          headers: {
            'X-Project': 'e2e-hmac',
            Authorization: `Bearer ${token}`,
          },
        }
      )

      setPaymentResult({ transactionId: transactionPaymentId })
    } catch (error: any) {
      console.error('Error processing payment:', error)
      setPaymentResult({
        transactionId: 'N/A',
        error: error?.message || 'Unknown error',
      })
      setView('failure')

      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }

  const handleTryAgain = () => {
    setView('select')
    setPaymentResult(null)
  }

  const getSelectedCard = () => {
    return paymentMethods.find(pm => pm.id === selectedPaymentId)
  }

  const formatAmount = (amt: number) => {
    return currency === 'EUR' ? `€${amt.toFixed(2)}` : `$${amt.toFixed(2)}`
  }

  // Card Selection View
  const CardSelectionView = () => (
    <div className='bg-background-light min-h-screen flex items-center justify-center p-4 font-display'>
      <div className='max-w-[480px] w-full max-h-[90vh] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-100'>
        {/* Header */}
        <div className='pt-8 pb-6 px-8 text-center border-b border-gray-50 flex-shrink-0'>
          <p className='text-gray-500 text-sm font-medium uppercase tracking-widest mb-1'>Total to pay</p>
          <h1 className='text-[#0d0e1b] text-4xl font-extrabold tracking-tight'>{formatAmount(amount)}</h1>
        </div>

        {/* Card List */}
        <div className='overflow-y-auto flex-grow p-8 custom-scrollbar'>
          <div className='space-y-4'>
            <label className='block text-sm font-bold text-gray-700'>Select a payment method</label>

            <div className='space-y-3'>
              {paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  onClick={() => setSelectedPaymentId(pm.id)}
                  className={`group relative w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all cursor-pointer hover:border-primary ${
                    selectedPaymentId === pm.id
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-100 bg-transparent hover:border-gray-200'
                  }`}
                >
                  <div className='flex items-center gap-4'>
                    {getCardIcon(pm.cardType)}
                    <div>
                      <p className='text-sm font-bold text-gray-900'>
                        {pm.cardType.charAt(0).toUpperCase() + pm.cardType.slice(1)} ending in {pm.lastFour}
                      </p>
                      <p className='text-xs text-gray-500'>
                        Expires {pm.expiryMonth || '12'}/{pm.expiryYear || '25'}
                      </p>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    selectedPaymentId === pm.id ? 'border-primary bg-primary' : 'border-gray-300'
                  }`}
                  >
                    <div className={`w-2 h-2 rounded-full bg-white transition-transform ${
                      selectedPaymentId === pm.id ? 'scale-100' : 'scale-0'
                    }`}
                    />
                  </div>
                </div>
              ))}

              {paymentMethods.length === 0 && (
                <p className='text-gray-500 text-center py-4'>No payment methods found</p>
              )}
            </div>

            {/* Add New Card Button */}
            <a
              href='/payment/add'
              className='w-full flex items-center gap-3 p-4 rounded-xl border border-dashed border-gray-300 hover:bg-gray-50 hover:border-primary transition-all group mt-2'
            >
              <div className='w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center group-hover:bg-primary/10 transition-colors'>
                <span className='material-symbols-outlined text-gray-500 group-hover:text-primary text-xl'>add</span>
              </div>
              <span className='text-sm font-semibold text-gray-600 group-hover:text-primary'>Add new credit card</span>
            </a>

            {/* Provider Selection */}
            <div className='mt-6'>
              <label className='block text-sm font-bold text-gray-700 mb-2'>Payment Provider</label>
              <div className='relative'>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className='w-full appearance-none bg-white border-2 border-gray-100 rounded-xl px-4 py-3 pr-10 text-sm font-semibold text-gray-900 focus:border-primary focus:outline-none transition-all cursor-pointer hover:border-gray-200'
                >
                  <option value='stripe'>Stripe</option>
                  <option value='clover'>Clover</option>
                </select>
                <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
                  <span className='material-symbols-outlined text-gray-400 text-xl'>expand_more</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pay Button */}
        <div className='p-8 bg-white border-t border-gray-50 flex-shrink-0'>
          <button
            onClick={handlePayment}
            disabled={!selectedPaymentId}
            className='w-full bg-primary hover:bg-primary/90 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl shadow-lg shadow-primary/30 transition-all active:scale-[0.98] text-lg flex items-center justify-center gap-2'
          >
            <span className='material-symbols-outlined text-xl'>lock</span>
            Pay {formatAmount(amount)}
          </button>
          <div className='flex items-center justify-center gap-2 mt-4 text-gray-400 text-[11px] uppercase tracking-wider font-bold'>
            <span className='material-symbols-outlined text-base'>verified_user</span>
            <p>Secured with 256-bit SSL encryption</p>
          </div>
        </div>
      </div>
    </div>
  )

  // Processing View
  const ProcessingView = () => (
    <div className='font-display bg-background-light min-h-screen'>
      <style>{`
        @keyframes pulse-bg {
          0%, 100% { background-color: #f6f6f8; }
          50% { background-color: #f8f9ff; }
        }
        .animate-pulse-bg {
          animation: pulse-bg 4s ease-in-out infinite;
        }
        .spinner-ring {
          border: 4px solid #6467f220;
          border-top: 4px solid #6467f2;
          border-radius: 50%;
          width: 80px;
          height: 80px;
          animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}
      </style>

      <div className='relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden animate-pulse-bg'>
        {/* Header / Logo Area */}
        <div className='absolute top-0 left-0 right-0 px-8 py-8 flex justify-center lg:justify-start lg:px-20'>
          <div className='flex items-center gap-2 text-primary'>
            <div className='size-8'>
              <svg className='text-primary' fill='none' viewBox='0 0 48 48' xmlns='http://www.w3.org/2000/svg'>
                <path clipRule='evenodd' d='M12.0799 24L4 19.2479L9.95537 8.75216L18.04 13.4961L18.0446 4H29.9554L29.96 13.4961L38.0446 8.75216L44 19.2479L35.92 24L44 28.7521L38.0446 39.2479L29.96 34.5039L29.9554 44H18.0446L18.04 34.5039L9.95537 39.2479L4 28.7521L12.0799 24Z' fill='currentColor' fillRule='evenodd' />
              </svg>
            </div>
            <h2 className='text-[#0d0e1b] text-xl font-bold leading-tight tracking-tight'>VaultPay</h2>
          </div>
        </div>

        {/* Central Processing Card */}
        <main className='relative z-10 flex w-full max-w-[520px] flex-col items-center px-6 text-center'>
          {/* Large Smooth Spinner */}
          <div className='mb-12 relative flex items-center justify-center'>
            <div className='spinner-ring' />
            <div className='absolute text-primary'>
              <span className='material-symbols-outlined text-3xl' style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
            </div>
          </div>

          {/* Content */}
          <h1 className='text-[#0d0e1b] text-[32px] md:text-[40px] font-extrabold leading-tight tracking-tight mb-4'>
            Processing your payment...
          </h1>
          <p className='text-[#4c4d9a] text-lg md:text-xl font-medium max-w-md mx-auto leading-relaxed mb-8'>
            Please wait while we securely process your transaction. This may take a few moments.
          </p>

          {/* Secure Badge */}
          <div className='inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary mb-12'>
            <span className='material-symbols-outlined text-sm'>verified_user</span>
            <span className='text-xs font-bold uppercase tracking-widest'>Bank-level Security</span>
          </div>

          {/* Progress Bar */}
          <div className='w-full max-w-xs h-1.5 bg-gray-200 rounded-full overflow-hidden mb-4'>
            <div className='h-full bg-primary rounded-full w-2/3 shadow-[0_0_10px_rgba(100,103,242,0.5)]' />
          </div>
          <p className='text-xs text-[#4c4d9a] font-medium'>Communicating with payment gateway</p>
        </main>

        {/* Footer Note */}
        <footer className='absolute bottom-8 left-0 right-0 text-center'>
          <div className='flex flex-col items-center gap-2'>
            <p className='text-sm text-[#4c4d9a] font-medium flex items-center gap-2'>
              <span className='material-symbols-outlined text-base text-amber-500'>warning</span>
              Do not close this window
            </p>
            <div className='mt-4 flex items-center gap-2 opacity-40'>
              <p className='text-[10px] uppercase tracking-tighter text-[#0d0e1b] font-bold'>Powered by</p>
              <div className='size-3 grayscale'>
                <svg className='text-current' fill='none' viewBox='0 0 48 48' xmlns='http://www.w3.org/2000/svg'>
                  <path clipRule='evenodd' d='M12.0799 24L4 19.2479L9.95537 8.75216L18.04 13.4961L18.0446 4H29.9554L29.96 13.4961L38.0446 8.75216L44 19.2479L35.92 24L44 28.7521L38.0446 39.2479L29.96 34.5039L29.9554 44H18.0446L18.04 34.5039L9.95537 39.2479L4 28.7521L12.0799 24Z' fill='currentColor' fillRule='evenodd' />
                </svg>
              </div>
            </div>
          </div>
        </footer>

        {/* Background Decorative Elements */}
        <div className='absolute -top-[10%] -left-[10%] size-96 rounded-full bg-primary/5 blur-3xl' />
        <div className='absolute -bottom-[10%] -right-[10%] size-96 rounded-full bg-primary/5 blur-3xl' />
      </div>
    </div>
  )

  // Success View
  const SuccessView = () => {
    const selectedCard = getSelectedCard()
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

    return (
      <div className='bg-background-light min-h-screen flex items-center justify-center font-display antialiased'>
        <div className='w-full max-w-[520px] px-6 py-12'>
          {/* Main Success Card */}
          <div className='bg-white rounded-xl shadow-xl overflow-hidden border border-gray-100'>
            {/* Success Header */}
            <div className='flex flex-col items-center pt-10 pb-6 px-8 text-center'>
              <div className='size-20 bg-success/10 rounded-full flex items-center justify-center mb-6'>
                <span className='material-symbols-outlined text-success text-5xl' style={{ fontVariationSettings: "'wght' 600" }}>
                  check_circle
                </span>
              </div>
              <h1 className='text-[#0d0e1b] text-3xl font-extrabold leading-tight tracking-tight mb-2'>
                Payment Successful!
              </h1>
              <p className='text-gray-500 text-base'>
                Your transaction was completed successfully. A receipt has been sent to your email.
              </p>
            </div>

            {/* Transaction Detail Banner */}
            <div className='px-8 mb-4'>
              <div className='relative w-full h-32 rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 flex flex-col items-center justify-center border border-primary/10 overflow-hidden'>
                <div className='absolute inset-0 opacity-10' style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #6467f2 1px, transparent 0)', backgroundSize: '24px 24px' }} />
                <p className='text-primary text-sm font-semibold uppercase tracking-wider mb-1'>Total Amount Paid</p>
                <p className='text-[#0d0e1b] text-4xl font-extrabold'>{formatAmount(amount)}</p>
              </div>
            </div>

            {/* Transaction Details List */}
            <div className='px-8 py-4 space-y-4'>
              <div className='flex justify-between items-center py-2 border-b border-gray-50'>
                <p className='text-gray-500 text-sm font-medium'>Transaction ID</p>
                <div className='flex items-center gap-2'>
                  <p className='text-[#0d0e1b] text-sm font-semibold'>{paymentResult?.transactionId || 'N/A'}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(paymentResult?.transactionId || '')}
                    className='text-primary hover:bg-primary/10 p-1 rounded-md transition-colors'
                  >
                    <span className='material-symbols-outlined text-base'>content_copy</span>
                  </button>
                </div>
              </div>
              <div className='flex justify-between items-center py-2 border-b border-gray-50'>
                <p className='text-gray-500 text-sm font-medium'>Date & Time</p>
                <p className='text-[#0d0e1b] text-sm font-semibold'>{dateStr}, {timeStr}</p>
              </div>
              <div className='flex justify-between items-center py-2 border-b border-gray-50'>
                <p className='text-gray-500 text-sm font-medium'>Payment Method</p>
                <div className='flex items-center gap-2'>
                  <span className='material-symbols-outlined text-gray-400 text-lg'>credit_card</span>
                  <p className='text-[#0d0e1b] text-sm font-semibold'>
                    {selectedCard ? `${selectedCard.cardType.charAt(0).toUpperCase() + selectedCard.cardType.slice(1)} ending in ${selectedCard.lastFour}` : 'Card'}
                  </p>
                </div>
              </div>
              <div className='flex justify-between items-center py-2'>
                <p className='text-gray-500 text-sm font-medium'>Status</p>
                <div className='flex items-center gap-1.5'>
                  <span className='size-2 rounded-full bg-success' />
                  <p className='text-success text-sm font-bold'>Confirmed</p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className='px-8 pt-4 pb-10 flex flex-col gap-3'>
              <a
                href='/'
                className='w-full h-14 bg-primary hover:bg-primary/90 text-white rounded-lg font-bold text-base transition-all flex items-center justify-center gap-2'
              >
                <span>Return to Home</span>
                <span className='material-symbols-outlined text-xl'>arrow_forward</span>
              </a>
              <button className='w-full h-14 bg-gray-100 hover:bg-gray-200 text-[#0d0e1b] rounded-lg font-bold text-base transition-all flex items-center justify-center gap-2'>
                <span className='material-symbols-outlined text-xl'>download</span>
                <span>Download Receipt</span>
              </button>
            </div>
          </div>

          {/* Footer / Help */}
          <div className='mt-8 text-center'>
            <p className='text-gray-400 text-sm'>
              Having issues? <a className='text-primary font-semibold hover:underline' href='#'>Contact Support</a>
            </p>
            <div className='mt-6 flex items-center justify-center gap-2 text-gray-400'>
              <span className='material-symbols-outlined text-sm'>lock</span>
              <span className='text-xs font-medium uppercase tracking-widest'>Securely processed by PaymentPortal</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Failure View
  const FailureView = () => (
    <div className='bg-background-light text-[#0d0e1b] font-display min-h-screen'>
      <div className='relative flex min-h-screen w-full flex-col overflow-x-hidden'>
        {/* Header */}
        <header className='flex items-center justify-between px-6 py-4 border-b border-solid border-gray-200'>
          <div className='flex items-center gap-2'>
            <div className='size-8 bg-primary rounded-lg flex items-center justify-center text-white'>
              <span className='material-symbols-outlined text-xl'>account_balance_wallet</span>
            </div>
            <h2 className='text-lg font-bold tracking-tight'>PayStream</h2>
          </div>
          <a href='/' className='p-2 hover:bg-gray-100 rounded-full transition-colors'>
            <span className='material-symbols-outlined'>close</span>
          </a>
        </header>

        {/* Main Content */}
        <main className='flex-1 flex items-center justify-center p-4'>
          <div className='w-full max-w-[480px] bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden'>
            {/* Status Visual */}
            <div className='pt-12 pb-6 flex flex-col items-center'>
              <div className='size-20 bg-error-red/10 rounded-full flex items-center justify-center mb-6'>
                <span className='material-symbols-outlined text-error-red text-5xl'>error</span>
              </div>
              <h1 className='text-3xl font-extrabold text-center px-6'>Payment Failed</h1>
              <p className='mt-4 text-center px-8 text-gray-600 text-base leading-relaxed'>
                {paymentResult?.error || 'An error occurred while processing your payment. Please try again or use a different payment method.'}
              </p>
            </div>

            {/* Action Buttons */}
            <div className='px-8 pb-8 space-y-3'>
              <button
                onClick={handleTryAgain}
                className='w-full bg-primary hover:bg-primary/90 text-white font-bold py-3.5 px-6 rounded-lg transition-all flex items-center justify-center gap-2'
              >
                <span className='material-symbols-outlined text-[20px]'>refresh</span>
                Try Again
              </button>
              <a
                href='#'
                className='w-full bg-gray-100 hover:bg-gray-200 text-[#0d0e1b] font-bold py-3.5 px-6 rounded-lg transition-all flex items-center justify-center gap-2 border border-transparent'
              >
                <span className='material-symbols-outlined text-[20px]'>support_agent</span>
                Contact Support
              </a>
            </div>

            {/* Card Footer / Transaction Details */}
            <div className='bg-gray-50 px-8 py-4 border-t border-gray-100 flex flex-col items-center gap-1'>
              <span className='text-xs uppercase tracking-widest font-semibold text-gray-400'>Transaction ID</span>
              <span className='text-sm font-mono font-medium text-gray-600'>{paymentResult?.transactionId || 'N/A'}</span>
            </div>
          </div>
        </main>

        {/* Page Footer */}
        <footer className='py-6 px-4'>
          <div className='max-w-[480px] mx-auto flex flex-col items-center gap-4'>
            <div className='flex items-center gap-6'>
              <a className='text-xs text-gray-400 hover:text-primary transition-colors' href='#'>Privacy Policy</a>
              <a className='text-xs text-gray-400 hover:text-primary transition-colors' href='#'>Terms of Service</a>
              <a className='text-xs text-gray-400 hover:text-primary transition-colors' href='#'>Help Center</a>
            </div>
            <div className='flex items-center gap-2 text-gray-300'>
              <span className='material-symbols-outlined text-sm'>shield_lock</span>
              <span className='text-[10px] uppercase font-bold tracking-tighter'>Secure 256-bit SSL Encrypted Connection</span>
            </div>
          </div>
        </footer>

        {/* Decorative Elements */}
        <div className='fixed top-0 left-0 -z-10 w-full h-full opacity-30 pointer-events-none overflow-hidden'>
          <div className='absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[100px]' />
          <div className='absolute -bottom-[10%] -right-[10%] w-[30%] h-[30%] bg-error-red/5 rounded-full blur-[80px]' />
        </div>
      </div>
    </div>
  )

  // Render based on current view
  switch (view) {
    case 'processing':
      return <ProcessingView />
    case 'success':
      return <SuccessView />
    case 'failure':
      return <FailureView />
    default:
      return <CardSelectionView />
  }
}
