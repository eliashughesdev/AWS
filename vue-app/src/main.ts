import { createApp } from 'vue'
import { Amplify } from 'aws-amplify'
// @ts-ignore — file is empty locally; populated by `ampx generate outputs` or on Amplify deploy
import outputs from '../../amplify_outputs.json'
import router from './router'
import './assets/main.css'
import App from './App.vue'
import tracker from './tracker'

Amplify.configure(outputs)
tracker.start()

createApp(App).use(router).mount('#app')
