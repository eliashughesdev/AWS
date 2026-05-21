import { createRouter, createWebHistory } from 'vue-router'
import AuthView from '../views/AuthView.vue'

const router = createRouter({
  // Base matches the Vite `base` and the Amplify rewrite prefix
  history: createWebHistory('/v2/'),
  routes: [
    {
      path: '/auth',
      name: 'auth',
      component: AuthView,
    },
    {
      path: '/',
      redirect: '/auth',
    },
  ],
})

export default router
