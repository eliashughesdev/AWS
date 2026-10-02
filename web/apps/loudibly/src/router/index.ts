import { createRouter, createWebHistory } from 'vue-router'
import { getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth'
import tracker from '../tracker'
import { isWalletUnlocked } from '../wallet/session'
import AuthView from '../views/AuthView.vue'
import DashboardView from '../views/DashboardView.vue'
import NonCustodialDashboardView from '../views/NonCustodialDashboardView.vue'
import NonCustodialSendView from '../views/NonCustodialSendView.vue'
import NonCustodialLedgerView from '../views/NonCustodialLedgerView.vue'
import NonCustodialReceiveView from '../views/NonCustodialReceiveView.vue'
import CardsView from '../views/CardsView.vue'
import DepositView from '../views/DepositView.vue'
import WithdrawView from '../views/WithdrawView.vue'
import TransactionsView from '../views/TransactionsView.vue'
import TransferView from '../views/TransferView.vue'
import ReceiveView from '../views/ReceiveView.vue'
import ConfirmView from '../views/ConfirmView.vue'
import SetPasswordView from '../views/SetPasswordView.vue'

const router = createRouter({
  history: createWebHistory('/v2/'),
  routes: [
    {
      path: '/auth',
      name: 'auth',
      component: AuthView,
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: DashboardView,
      meta: { requiresAuth: true, custodialOnly: true },
    },
    // Non-custodial (anonymous) screens — no Cognito, everything read straight
    // from the chain with the in-session key. Guarded by an unlocked wallet.
    {
      path: '/wallet',
      name: 'wallet',
      component: NonCustodialDashboardView,
      meta: { requiresAuth: true, walletOnly: true },
    },
    {
      path: '/wallet/send',
      name: 'wallet-send',
      component: NonCustodialSendView,
      meta: { requiresAuth: true, walletOnly: true },
    },
    {
      path: '/wallet/ledger',
      name: 'wallet-ledger',
      component: NonCustodialLedgerView,
      meta: { requiresAuth: true, walletOnly: true },
    },
    {
      path: '/wallet/receive',
      name: 'wallet-receive',
      component: NonCustodialReceiveView,
      meta: { requiresAuth: true, walletOnly: true },
    },
    {
      path: '/cards',
      name: 'cards',
      component: CardsView,
      meta: { requiresAuth: true, custodialOnly: true },
    },
    {
      path: '/deposit',
      name: 'deposit',
      component: DepositView,
      meta: { requiresAuth: true, custodialOnly: true },
    },
    {
      path: '/withdraw',
      name: 'withdraw',
      component: WithdrawView,
      meta: { requiresAuth: true, custodialOnly: true },
    },
    {
      path: '/transfer',
      name: 'transfer',
      component: TransferView,
      meta: { requiresAuth: true, custodialOnly: true },
    },
    {
      path: '/ledger',
      name: 'ledger',
      component: TransactionsView,
      meta: { requiresAuth: true, custodialOnly: true },
    },
    {
      path: '/receive',
      name: 'receive',
      component: ReceiveView,
      meta: { requiresAuth: true, custodialOnly: true },
    },
    {
      path: '/confirm',
      name: 'confirm',
      component: ConfirmView,
    },
    // No requiresAuth: the payer arrives from an email link with no session and no
    // password. The one-time token in the query string is the only credential.
    {
      path: '/set-password',
      name: 'set-password',
      component: SetPasswordView,
    },
    {
      path: '/',
      redirect: '/auth',
    },
  ],
})

// Two ways to be signed in: a Cognito session (custodial) or an unlocked in-memory
// wallet (non-custodial — no server identity at all). Non-custodial users are kept
// out of the custodial-only screens, which all depend on a Cognito token.
router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true

  const hasWallet = isWalletUnlocked()

  // An unlocked wallet is a complete session on its own — a non-custodial user has
  // no Cognito identity, so don't pay for a lookup that is guaranteed to throw.
  if (hasWallet && to.meta.walletOnly) return true

  let hasCognito = false
  try {
    await getCurrentUser()
    const attrs = await fetchUserAttributes()
    if (attrs.email) tracker.setUserID(attrs.email)
    hasCognito = true
  } catch {
    hasCognito = false
  }

  if (!hasCognito && !hasWallet) return { name: 'auth' }
  if (!hasCognito && to.meta.custodialOnly) return { name: 'wallet' }
  if (to.meta.walletOnly && !hasWallet) return { name: 'dashboard' }

  return true
})

export default router
