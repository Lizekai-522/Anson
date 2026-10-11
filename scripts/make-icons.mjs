// 生成 PWA 图标：用已装的 Playwright 渲染内联 SVG → PNG（零新依赖）。
// 图标语言与 BrandMark.vue 同源：信号绿方底 + 米白的「出发→抵达」路线标记。
// 坐标与 src/components/BrandMark.vue 的 24×24 网格逐点一致，改标记时两处一起改。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public', 'icons')
fs.mkdirSync(OUT, { recursive: true })

const BG = '#0B6B45'
const FG = '#F6F7F5'

function svgIcon(size, { maskable = false } = {}) {
  // maskable 版本：内容收进中心安全区，底色铺满整块
  const inner = maskable ? size * 0.52 : size * 0.68
  const scale = inner / 24
  const off = (size - inner) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${off} ${off}) scale(${scale})" fill="none" stroke="${FG}"
     stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4.6 19.2 H11.2 L17 9.4"/>
    <circle cx="4.6" cy="19.2" r="2.5" fill="${FG}" stroke="none"/>
    <circle cx="18.8" cy="6.4" r="2.4"/>
  </g>
</svg>`
}

const TARGETS = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]

const browser = await chromium.launch({ args: ['--no-sandbox'] })
try {
  for (const [file, size, maskable] of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(
      `<!doctype html><html><body style="margin:0">${svgIcon(size, { maskable })}</body></html>`
    )
    await page.screenshot({ path: path.join(OUT, file) })
    await page.close()
    const kb = (fs.statSync(path.join(OUT, file)).size / 1024).toFixed(1)
    console.log(`[icons] ${file} ${size}px ${kb} KB`)
  }
} finally {
  await browser.close()
}
console.log('[icons] OK →', path.relative(ROOT, OUT))