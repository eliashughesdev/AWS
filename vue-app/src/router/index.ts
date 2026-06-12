import { createRouter, createWebHistory } from 'vue-router'
import { getCurrentUser } from 'aws-amplify/auth'
import AuthView from '../views/AuthView.vue'
import DashboardView from '../views/DashboardView.vue'
import CardsView from '../views/CardsView.vue'
import DepositView from '../views/DepositView.vue'
import WithdrawView from '../views/WithdrawView.vue'
import TransactionsView from '../views/TransactionsView.vue'
import TransferView from '../views/TransferView.vue'
import ReceiveView from '../views/ReceiveView.vue'
import ConfirmView from '../views/ConfirmView.vue'

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
      meta: { requiresAuth: true },
    },
    {
      path: '/cards',
      name: 'cards',
      component: CardsView,
      meta: { requiresAuth: true },
    },
    {
      path: '/deposit',
      name: 'deposit',
      component: DepositView,
      meta: { requiresAuth: true },
    },
    {
      path: '/withdraw',
      name: 'withdraw',
      component: WithdrawView,
      meta: { requiresAuth: true },
    },
    {
      path: '/transfer',
      name: 'transfer',
      component: TransferView,
      meta: { requiresAuth: true },
    },
    {
      path: '/ledger',
      name: 'ledger',
      component: TransactionsView,
      meta: { requiresAuth: true },
    },
    {
      path: '/receive',
      name: 'receive',
      component: ReceiveView,
      meta: { requiresAuth: true },
    },
    {
      path: '/confirm',
      name: 'confirm',
      component: ConfirmView,
    },
    {
      path: '/',
      redirect: '/auth',
    },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true
  try {
    await getCurrentUser()
    return true
  } catch {
    return { name: 'auth' }
  }
})

export default router
