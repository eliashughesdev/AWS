import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [vue(), tailwindcss(), nodePolyfills()],
  base: '/v2/',
  envPrefix: ['VITE_', 'OPENREPLAY_'],
})
