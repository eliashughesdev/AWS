import { createRouter, createWebHistory } from 'vue-router'
import { checkAccess, type AccessRules } from '@loudibly/core/auth/guards'
import TopNavLayout from '../layouts/TopNavLayout.vue'
import ComingSoonView from '../views/ComingSoonView.vue'

declare module 'vue-router' {
  interface RouteMeta extends AccessRules {
    title?: string  // page heading, drawn by the layout
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
        { path: 'dashboard',    name: 'dashboard',    component: ComingSoonView, meta: { title: 'Dashboard' } },
        { path: 'accounts',     name: 'accounts',     component: ComingSoonView, meta: { title: 'Accounts' } },
        { path: 'deposit',      name: 'deposit',      component: ComingSoonView, meta: { title: 'Deposit' } },
        { path: 'withdraw',     name: 'withdraw',     component: ComingSoonView, meta: { title: 'Withdraw' } },
        { path: 'convert',      name: 'convert',      component: ComingSoonView, meta: { title: 'Convert' } },
        { path: 'payments',     name: 'payments',     component: ComingSoonView, meta: { title: 'Payments' } },
        { path: 'earn',         name: 'earn',         component: ComingSoonView, meta: { title: 'Earn' } },
        { path: 'transactions', name: 'transactions', component: ComingSoonView, meta: { title: 'Transactions' } },
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
