import { createApp } from 'vue'
import { configureAmplify } from '@loudibly/core/amplify'
import tracker from '@loudibly/core/tracker'
import router from './router'
import './assets/main.css'
import App from './App.vue'

configureAmplify()
tracker.start()

createApp(App).use(router).mount('#app')
