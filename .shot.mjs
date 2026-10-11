import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 420, height: 900 } })
await p.goto('http://localhost:5190/', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
await p.screenshot({ path: '/tmp/welcome.png', fullPage: true })
console.log('TITLE', await p.title())
console.log('TEXT', (await p.innerText('body')).slice(0, 300).replace(/\n/g, ' | '))
await b.close()