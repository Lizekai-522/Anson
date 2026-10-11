import { createApp } from 'vue'
import App from './App.vue'
import './styles/global.css'
import { installRouter } from './core/router.js'
import { initStore } from './core/store.js'

// 顺序不可颠倒：先装路由，再恢复会话+数据桶，最后挂载
installRouter()
initStore()
createApp(App).mount('#app')

// PWA：只在生产构建 + http(s) 下注册 service worker。
// dev（vite dev）与 file:// 单文件形态都不注册 —— 不污染开发体验与端到端测试。
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
