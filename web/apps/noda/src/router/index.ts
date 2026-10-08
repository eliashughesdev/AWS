import { createRouter, createWebHistory } from 'vue-router'
import { checkAccess, type AccessRules } from '@loudibly/core/auth/guards'
import TopNavLayout from '../layouts/TopNavLayout.vue'
import AccountsView from '../views/AccountsView.vue'
import AuthView from '../views/AuthView.vue'
import ComingSoonView from '../views/ComingSoonView.vue'
import ConvertView from '../views/ConvertView.vue'
import DashboardView from '../views/DashboardView.vue'
import DepositView from '../views/DepositView.vue'
import EarnView from '../views/EarnView.vue'
import PaymentsView from '../views/PaymentsView.vue'
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
  // The base comes from the build: '/' by default, '/noda/' where amplify.yml builds it into a subfolder.
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/auth', name: 'auth', component: AuthView },
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
        // The line break is where the mobile design wraps this subtitle.
        { path: 'payments',     name: 'payments',     component: PaymentsView,   meta: { title: 'Payments', subtitle: 'Manage your payments and\npayment methods' } },
        { path: 'earn',         name: 'earn',         component: EarnView,       meta: { title: 'Earn', subtitle: 'Stake your crypto and earn passive income' } },
        { path: 'transactions', name: 'transactions', component: TransactionsView, meta: { title: 'Transactions', subtitle: 'View and manage all your transaction history' } },
        // Where header controls with nothing behind them lead (language, notifications, settings).
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
