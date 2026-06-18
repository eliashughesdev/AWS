import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: '/v2/',
  envPrefix: ['VITE_', 'OPENREPLAY_'],
  define: {
    global: 'globalThis',
    'process.env': {},
  },
})
