import { createRouter, createWebHistory } from 'vue-router'
import { checkAccess, type AccessRules } from '@loudibly/core/auth/guards'
import TopNavLayout from '../layouts/TopNavLayout.vue'
import ComingSoonView from '../views/ComingSoonView.vue'

declare module 'vue-router' {
  interface RouteMeta extends AccessRules {}
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
        { path: 'dashboard',    name: 'dashboard',    component: ComingSoonView },
        { path: 'accounts',     name: 'accounts',     component: ComingSoonView },
        { path: 'deposit',      name: 'deposit',      component: ComingSoonView },
        { path: 'withdraw',     name: 'withdraw',     component: ComingSoonView },
        { path: 'convert',      name: 'convert',      component: ComingSoonView },
        { path: 'payments',     name: 'payments',     component: ComingSoonView },
        { path: 'earn',         name: 'earn',         component: ComingSoonView },
        { path: 'transactions', name: 'transactions', component: ComingSoonView },
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
