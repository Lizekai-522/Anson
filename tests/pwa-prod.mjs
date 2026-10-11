// 生产形态校验（不进 npm test 主链路，避免每次都 build）：
//   build → vite preview → 断言 manifest 可取到 / service worker 注册成功 / 断网后仍能渲染。
// 用法：npm run test:pwa
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5191
const BASE = `http://localhost:${PORT}`

function log(ok, msg) {
  console.log(`${ok ? '✔' : '✖'} ${msg}`)
  if (!ok) process.exitCode = 1
}

const build = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
if (build.status !== 0) {
  console.error('[pwa] 构建失败')
  process.exit(1)
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: 'ignore', detached: true, shell: process.platform === 'win32',
})

async function alive() {
  try {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch { return false }
}

let browser = null
try {
  for (let i = 0; i < 60; i++) {
    if (await alive()) break
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!(await alive())) throw new Error('preview server 30s 内未就绪')

  const { chromium } = await import('playwright')
  browser = await chromium.launch({ args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await page.goto(BASE + '/')
  await page.locator('text=安程').first().waitFor({ timeout: 8000 })
  log(true, '生产产物可打开')

  const manifest = await page.evaluate(async () => {
    const r = await fetch('./manifest.webmanifest')
    if (!r.ok) return { ok: false, status: r.status }
    const j = await r.json()
    return { ok: true, name: j.name, icons: (j.icons || []).length, display: j.display }
  })
  log(manifest.ok && manifest.icons === 3 && manifest.display === 'standalone',
    `manifest 可取到：${manifest.name} / ${manifest.icons} 个图标 / ${manifest.display}`)

  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported'
    const reg = await navigator.serviceWorker.ready
    return reg && reg.active ? 'active' : 'pending'
  })
  log(swState === 'active', `service worker 注册：${swState}`)

  // 再走一遍长辈端页面，确保资产都进了缓存
  await page.goto(BASE + '/#/e')
  await page.locator('text=输入子女给的 6 位码').first().waitFor({ timeout: 8000 })
  await page.waitForTimeout(500)

  const cacheInfo = await page.evaluate(async () => {
    const keys = await caches.keys()
    const urls = []
    for (const k of keys) {
      const c = await caches.open(k)
      urls.push(...(await c.keys()).map((r) => r.url))
    }
    return { controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null, keys, urls }
  })
  console.log('   [debug] controller =', cacheInfo.controller)
  console.log('   [debug] caches =', JSON.stringify(cacheInfo.keys))
  console.log('   [debug] cached urls =', JSON.stringify(cacheInfo.urls))

  await ctx.setOffline(true)
  const logs = []
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()))
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message))
  let offlineOk = false
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('text=输入子女给的 6 位码').first().waitFor({ timeout: 8000 })
    offlineOk = true
  } catch (e) {
    console.log('   [debug] 离线重载失败：', String(e.message).split('\n')[0])
    console.log('   [debug] 当前 URL =', page.url())
    const body = await page.evaluate(() => document.body.innerText).catch(() => '<读不到>')
    console.log('   [debug] body =', JSON.stringify(String(body).slice(0, 300)))
    console.log('   [debug] 控制台 =', JSON.stringify(logs.slice(0, 8)))
  }
  log(offlineOk, '断网后重载仍能渲染（service worker 缓存生效）')
  await ctx.setOffline(false)
} catch (e) {
  console.error('[pwa]', e.message)
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  try { if (server.pid) process.kill(-server.pid) } catch {}
}

console.log(process.exitCode ? '\n[pwa] FAIL' : '\n[pwa] ALL GREEN')