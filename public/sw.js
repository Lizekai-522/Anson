// 安程 Service Worker：只做同源 GET 的运行时缓存。
// 目的很实在：长辈在弱网/断网时，已经打开过的行程页还能再看一遍。
// 不缓存跨域请求；不拦截非 GET；版本号变了就丢旧缓存。
const CACHE = 'ptb-v4'
const CORE = ['./', './index.html', './manifest.webmanifest']

// 安装时预缓存应用外壳：核心文件 + 从 index.html 里解析出的带哈希 JS/CSS。
// 解析这一步是必要的 —— 构建产物的文件名带内容哈希，源码里写不死。
async function precacheShell() {
  const cache = await caches.open(CACHE)
  await cache.addAll(CORE)
  const res = await cache.match('./index.html')
  if (!res) return
  const html = await res.text()
  const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => './' + m[1])
  if (assets.length) await cache.addAll(assets)
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    precacheShell()
      .catch(() => {})
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Live API responses must never enter the offline shell cache.
  if (url.pathname.startsWith('/api/')) return
  const isNav = req.mode === 'navigate'

  e.respondWith((async () => {
    const cache = await caches.open(CACHE)

    // 页面导航走「网络优先」：线上发了新版本就立刻用新的，断网才回落到缓存。
    // 反过来（cache-first）会让用户一直停在旧的离线壳里 —— 改了页面也看不见。
    if (isNav) {
      try {
        const res = await fetch(req)
        if (res && res.ok) cache.put('./index.html', res.clone()).catch(() => {})
        return res
      } catch (err) {
        const shell = await caches.match('./index.html', { ignoreVary: true })
        if (shell) return shell
        throw err
      }
    }

    // 其余同源资源（构建产物文件名带内容哈希，天然不可变）走缓存优先：
    // ignoreVary：模块脚本带 crossorigin，页面请求比预缓存多一个 Origin 头，
    // 按 Vary 比对会假性未命中，offline 时 asset 就取不到了。
    const hit = await caches.match(req, { ignoreVary: true })
    if (hit) return hit
    const res = await fetch(req)
    if (res && res.ok && res.type === 'basic') {
      cache.put(req, res.clone()).catch(() => {})
    }
    return res
  })())
})