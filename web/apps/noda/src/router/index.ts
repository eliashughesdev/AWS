import { createRouter, createWebHistory } from 'vue-router'
import { checkAccess, type AccessRules } from '@loudibly/core/auth/guards'
import TopNavLayout from '../layouts/TopNavLayout.vue'
import AccountsView from '../views/AccountsView.vue'
import ComingSoonView from '../views/ComingSoonView.vue'
import ConvertView from '../views/ConvertView.vue'
import DashboardView from '../views/DashboardView.vue'
import DepositView from '../views/DepositView.vue'
import TransactionsView from '../views/TransactionsView.vue'
import WithdrawView from '../views/WithdrawView.vue'
import WithdrawFormView from '../views/WithdrawFormView.vue'
import WithdrawHistoryView from '../views/WithdrawHistoryView.vue'

declare module 'vue-router' {
  interface RouteMeta extends AccessRules {
    title?: string     // page heading, drawn by the layout
    subtitle?: string  // the line under it
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Public, so a signed-out user has somewhere to land until the sign-in screen exists.
    { path: '/auth', name: 'auth', component: ComingSoonView },
    {
      path: '/',
      component: TopNavLayout,
      redirect: { name: 'dashboard' },
      meta: { requiresAuth: true },
      children: [
        { path: 'dashboard',    name: 'dashboard',    component: DashboardView,  meta: { title: 'Dashboard' } },
        { path: 'accounts',     name: 'accounts',     component: AccountsView,   meta: { title: 'Accounts', subtitle: 'Manage your crypto accounts and wallets' } },
        { path: 'deposit',      name: 'deposit',      component: DepositView,    meta: { title: 'Deposit', subtitle: 'Add funds to your account via crypto or fiat' } },
        {
          path: 'withdraw',
          component: WithdrawView,
          meta: { title: 'Withdraw', subtitle: 'Transfer your crypto to external wallets' },
          children: [
            { path: '',        name: 'withdraw',         component: WithdrawFormView },
            { path: 'history', name: 'withdraw-history', component: WithdrawHistoryView },
          ],
        },
        { path: 'convert',      name: 'convert',      component: ConvertView,    meta: { title: 'Convert', subtitle: 'Instantly convert between cryptocurrencies' } },
        { path: 'payments',     name: 'payments',     component: ComingSoonView, meta: { title: 'Payments' } },
        { path: 'earn',         name: 'earn',         component: ComingSoonView, meta: { title: 'Earn' } },
        { path: 'transactions', name: 'transactions', component: TransactionsView, meta: { title: 'Transactions', subtitle: 'View and manage all your transaction history' } },
        // Where header controls with nothing behind them lead (language, theme, notifications, settings).
        { path: 'coming-soon',  name: 'coming-soon',  component: ComingSoonView, meta: { title: 'Coming soon' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach(async (to) => {
  const access = await checkAccess(to.meta)
  return access === 'allowed' ? true : { name: 'auth' }
})

export default router
