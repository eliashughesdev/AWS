import { useState } from 'react';

interface PaymentWidgetProps {
  user?: any;
}

type PaymentMethodId = 'credit-card' | 'ideal' | 'paypal' | 'sofort' | 'epay';

interface SidebarMethod {
  id: PaymentMethodId;
  label: string;
  icon?: string;
  image?: string;
}

const paymentMethods: SidebarMethod[] = [
  { id: 'credit-card', icon: 'credit_card', label: 'Credit Card' },
  { id: 'ideal', icon: 'account_balance', label: 'iDEAL' },
  { id: 'paypal', icon: 'payments', label: 'PayPal' },
  { id: 'sofort', icon: 'bolt', label: 'Sofort' },
  { id: 'epay', image: '/src/assets/epay-logo.png', label: 'ePay' },
];

const PaymentWidget = ({ user: _user }: PaymentWidgetProps) => {
  const [activeMethod, setActiveMethod] = useState<PaymentMethodId>('credit-card');
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [cvc, setCvc] = useState('');

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 16);
    const formatted = raw.match(/.{1,4}/g)?.join(' ') ?? raw;
    setCardNumber(formatted);
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
    const formatted = raw.length > 2 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw;
    setExpiryDate(formatted);
  };

  const handlePay = () => {
    // TODO: implement payment submission
    console.log({ cardholderName, cardNumber, expiryDate, cvc });
  };

  const previewNumber = cardNumber || '•••• •••• •••• ••••';
  const previewName = cardholderName || 'John Doe';
  const previewExpiry = expiryDate || 'MM/YY';

  return (
    <div className="bg-background-light dark:bg-background-dark font-display text-[#0d0e1b] dark:text-white min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[960px] bg-white dark:bg-[#1a1b2e] rounded-xl shadow-2xl overflow-hidden flex flex-col md:flex-row min-h-[640px] border border-gray-200 dark:border-gray-800">

        {/* Sidebar */}
        <aside className="w-full md:w-64 bg-gray-50 dark:bg-[#141526] border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 flex flex-col">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-8">
              <span className="material-symbols-outlined text-primary text-3xl">shield_locked</span>
              <h2 className="font-bold text-lg tracking-tight">Checkout</h2>
            </div>
            <nav className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-[#4c4d9a] dark:text-gray-400 font-bold mb-4">
                Payment Method
              </p>
              {paymentMethods.map((method) => (
                <a
                  key={method.id}
                  href="#"
                  onClick={(e) => { e.preventDefault(); setActiveMethod(method.id); }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                    activeMethod === method.id
                      ? 'bg-primary/10 border-r-4 border-primary text-primary'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {method.image
                    ? <img src={method.image} alt={method.label} className="h-6 w-auto object-contain" />
                    : <span className="material-symbols-outlined">{method.icon}</span>
                  }
                  <span className="text-sm font-semibold">{method.label}</span>
                </a>
              ))}
            </nav>
          </div>
          <div className="mt-auto p-6 border-t border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2 text-[#4c4d9a] dark:text-gray-400 text-xs">
              <span className="material-symbols-outlined text-sm">lock</span>
              <span>SSL Encrypted</span>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col relative overflow-y-auto">
          {/* Header */}
          <header className="p-6 md:px-10 flex items-center justify-between sticky top-0 bg-white/80 dark:bg-[#1a1b2e]/80 backdrop-blur-md z-10">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">Complete Payment</h1>
              <p className="text-sm text-[#4c4d9a] dark:text-gray-400">Secure encrypted transaction</p>
            </div>
            <div className="bg-primary px-4 py-2 rounded-lg text-white font-bold text-lg shadow-lg shadow-primary/20">
              $149.00
            </div>
          </header>

          <div className="px-6 md:px-10 py-4 flex-1">
            {/* Card Preview */}
            <div className="relative w-full max-w-md mx-auto mb-10 h-56 rounded-xl overflow-hidden shadow-xl bg-gradient-to-br from-primary to-indigo-900 flex flex-col justify-between p-8 text-white">
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  background: 'rgba(43, 46, 238, 0.15)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                }}
              />
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
              <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-white/5 rounded-full blur-2xl" />

              <div className="relative z-10 flex justify-between items-start">
                <span className="material-symbols-outlined text-4xl opacity-80">contactless</span>
                <div className="w-12 h-8 bg-yellow-400/80 rounded-md shadow-inner" />
              </div>
              <div className="relative z-10">
                <p className="text-xl tracking-[0.2em] font-medium mb-1 truncate">{previewNumber}</p>
              </div>
              <div className="relative z-10 flex justify-between items-end">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase opacity-60 tracking-wider">Cardholder Name</span>
                  <span className="font-bold tracking-wide uppercase">{previewName}</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-[10px] uppercase opacity-60 tracking-wider">Expires</span>
                  <span className="font-bold tracking-wide">{previewExpiry}</span>
                </div>
              </div>
            </div>

            {/* Form */}
            <form
              onSubmit={(e) => { e.preventDefault(); handlePay(); }}
              className="space-y-6 pb-24 max-w-xl mx-auto"
            >
              <div className="grid grid-cols-1 gap-6">
                {/* Cardholder Name */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[#0d0e1b] dark:text-gray-200 px-1">
                    Cardholder Name
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">
                      person
                    </span>
                    <input
                      type="text"
                      value={cardholderName}
                      onChange={(e) => setCardholderName(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                      placeholder="John Doe"
                    />
                  </div>
                </div>

                {/* Card Number */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[#0d0e1b] dark:text-gray-200 px-1">
                    Card Number
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">
                      credit_card
                    </span>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={handleCardNumberChange}
                      className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all tracking-widest"
                      placeholder="•••• •••• •••• ••••"
                      maxLength={19}
                    />
                  </div>
                </div>

                {/* Expiry and CVC */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[#0d0e1b] dark:text-gray-200 px-1">
                      Expiry Date
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">
                        calendar_today
                      </span>
                      <input
                        type="text"
                        value={expiryDate}
                        onChange={handleExpiryChange}
                        className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                        placeholder="MM/YY"
                        maxLength={5}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[#0d0e1b] dark:text-gray-200 px-1">
                      CVC/CVV
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">
                        lock
                      </span>
                      <input
                        type="password"
                        value={cvc}
                        onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        className="w-full pl-12 pr-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all"
                        placeholder="•••"
                        maxLength={4}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>

          {/* Floating Pay Button */}
          <div className="absolute bottom-0 left-0 right-0 p-6 md:px-10 pointer-events-none">
            <button
              type="button"
              onClick={handlePay}
              className="pointer-events-auto w-full max-w-xl mx-auto flex items-center justify-center gap-3 bg-primary hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all active:scale-95 group"
              style={{ boxShadow: '0 10px 30px -5px rgba(100, 103, 242, 0.5)' }}
            >
              <span className="material-symbols-outlined text-white">verified_user</span>
              <span>Pay $149.00 Securely</span>
              <span className="material-symbols-outlined text-white/50 group-hover:translate-x-1 transition-transform">
                arrow_forward
              </span>
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

export default PaymentWidget;
