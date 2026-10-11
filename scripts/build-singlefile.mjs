// 单文件交付：vite build → 把 JS/CSS 内联回 index.html → dist/安程-单文件.html
// 产物双击即开（file:// 也能跑），无任何外部资源引用。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

// 1. 标准构建
const r = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
if (r.status !== 0) process.exit(r.status ?? 1)

// 2. 内联
let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
// 单文件形态不含 PWA（file:// 不支持 service worker）：剥掉 manifest 与图标链接
html = html.replace(/<link[^>]*rel="manifest"[^>]*>\s*/g, '')
html = html.replace(/<link[^>]*rel="apple-touch-icon"[^>]*>\s*/g, '')
html = html.replace(
  /<script[^>]*src="\.\/assets\/[^"]+\.js"[^>]*><\/script>/,
  (m) => {
    const src = m.match(/src="\.\/(assets\/[^"]+\.js)"/)[1]
    return '<script type="module">' + fs.readFileSync(path.join(DIST, src), 'utf8') + '</script>'
  },
)
html = html.replace(
  /<link[^>]*href="\.\/assets\/[^"]+\.css"[^>]*>/,
  (m) => {
    const href = m.match(/href="\.\/(assets\/[^"]+\.css)"/)[1]
    return '<style>' + fs.readFileSync(path.join(DIST, href), 'utf8') + '</style>'
  },
)

// 3. 校验：不允许再有任何 assets 引用残留，也不允许残留 manifest 链接
if (/\.\/assets\//.test(html) || /rel="manifest"/.test(html)) {
  console.error('[singlefile] 仍有外部资源引用（assets 或 manifest），内联失败')
  process.exit(1)
}

const out = path.join(DIST, '安程-单文件.html')
fs.writeFileSync(out, html)
const kb = (fs.statSync(out).size / 1024).toFixed(0)
console.log(`[singlefile] OK → dist/安程-单文件.html (${kb} KB)`)

// 4. 自校验：用真实浏览器以 file:// 打开产物，确认能渲染（离线可跑是交付承诺）
const { chromium } = await import('playwright')
const browser = await chromium.launch({ args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto('file://' + out + '#/')
  await page.locator('text=安程').first().waitFor({ timeout: 8000 })
  await page.locator('text=我是爸妈').first().waitFor({ timeout: 8000 })
  console.log('[singlefile] file:// 烟测通过')
} catch (e) {
  console.error('[singlefile] file:// 烟测失败：' + e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
