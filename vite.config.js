import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: { port: 5190, strictPort: true, host: true },
  preview: { port: 5190, strictPort: true, host: true },
  build: { target: 'es2018', cssCodeSplit: false, assetsInlineLimit: 1024 * 1024 }
})
