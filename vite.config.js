import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  // /api 代理到通知/天气服务端（默认 5180）：dev 下也能查目的地天气、取目的地坐标。
  // changeOrigin 会把 Host 改成目标端口，所以这里把 Origin 一并改写成目标源，
  // 好让服务端的同源校验通过；服务端没起时前端照旧静默降级（不会白屏）。
  server: {
    port: 5190,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5180',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', 'http://localhost:5180'))
        },
      },
    },
  },
  preview: { port: 5190, strictPort: true, host: true },
  build: { target: 'es2018', cssCodeSplit: false, assetsInlineLimit: 1024 * 1024 }
})
