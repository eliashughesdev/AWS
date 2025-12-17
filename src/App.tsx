import CustomerKyc from './pages/CustomerKyc'

function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'
  if (path === '/customer/kyc') return <CustomerKyc />

  return (
    <main>
      <div>
        🥳 App successfully hosted. — <a href="/customer/kyc">Open KYC</a>
      </div>
    </main>
  )
}

export default App
