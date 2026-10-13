import { createRouter, createWebHistory } from 'vue-router'
import { checkAccess, type Access, type AccessRules } from '@loudibly/core/auth/guards'
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
import MerchantsView from '../views/MerchantsView.vue'
import ConfirmView from '../views/ConfirmView.vue'
import SetPasswordView from '../views/SetPasswordView.vue'

declare module 'vue-router' {
  interface RouteMeta extends AccessRules {}
}

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
    // Loudibly employees only. The API checks the role itself.
    {
      path: '/merchants',
      name: 'merchants',
      component: MerchantsView,
      meta: { staffOnly: true },
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

// Where this app sends a user who can't see the page (the rules live in core).
const redirectFor: Record<Exclude<Access, 'allowed'>, string> = {
  'signed-out':    'auth',
  'needs-cognito': 'wallet',
  'needs-wallet':  'dashboard',
  'needs-staff':   'dashboard',
}

router.beforeEach(async (to) => {
  const access = await checkAccess(to.meta)
  return access === 'allowed' ? true : { name: redirectFor[access] }
})

export default router
