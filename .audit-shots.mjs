import { chromium } from 'playwright'
import fs from 'node:fs'
const BASE = 'http://localhost:5190'
const OUT = '/tmp/audit'
fs.mkdirSync(OUT, { recursive: true })
const SAMPLE = '10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到\n住一晚 如家酒店(北京南站店)\n第二天高铁 G104 上海虹桥 -> 杭州东'

const b = await chromium.launch({ args: ['--no-sandbox'] })

async function walk(vw, vh, tag) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, locale: 'zh-CN' })
  const p = await ctx.newPage()
  const uniq = Date.now().toString(36)
  await p.goto(BASE + '/#/register')
  await p.locator('input').nth(0).fill('审计' + uniq.slice(-4))
  await p.locator('input').nth(1).fill(`${uniq}@t.local`)
  await p.locator('input').nth(2).fill('1380000' + uniq.slice(-4).replace(/\D/g, '0').padEnd(4, '0'))
  await p.locator('input[type=password]').nth(0).fill('Passw0rd1234')
  await p.locator('input[type=password]').nth(1).fill('Passw0rd1234')
  await p.getByRole('button', { name: /注册/ }).first().click()
  await p.waitForURL(/#\/home/, { timeout: 9000 })
  await p.screenshot({ path: `${OUT}/${tag}-home-empty.png`, fullPage: true })

  await p.goto(BASE + '/#/import')
  await p.locator('textarea').fill(SAMPLE)
  await p.getByRole('button', { name: /解析行程/ }).click()
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${OUT}/${tag}-import.png`, fullPage: true })
  await p.getByRole('button', { name: /确认导入/ }).click()
  await p.waitForURL(/#\/trip\//, { timeout: 9000 })
  await p.waitForTimeout(700)
  await p.screenshot({ path: `${OUT}/${tag}-trip.png`, fullPage: true })

  await p.goto(BASE + '/#/home')
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${OUT}/${tag}-home.png`, fullPage: true })

  await p.goto(BASE + '/#/family')
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${OUT}/${tag}-family.png`, fullPage: true })

  // share
  await p.goto(BASE + '/#/home')
  await p.getByRole('button', { name: /分享/ }).first().click()
  await p.waitForURL(/#\/share\//)
  await p.waitForTimeout(400)
  await p.getByRole('button', { name: /生成分享链接/ }).click()
  await p.locator('input[readonly]').first().waitFor({ timeout: 9000 })
  await p.waitForTimeout(900)
  await p.screenshot({ path: `${OUT}/${tag}-share.png`, fullPage: true })
  const link = await p.locator('input[readonly]').first().inputValue()

  await p.goto(BASE + '/#/profile')
  await p.waitForTimeout(400)
  await p.screenshot({ path: `${OUT}/${tag}-profile.png`, fullPage: true })

  // elder pages
  const e = await ctx.newPage()
  await e.goto(link)
  await e.waitForTimeout(600)
  await e.screenshot({ path: `${OUT}/${tag}-elder-day.png`, fullPage: true })
  await e.getByRole('button', { name: '家人电话' }).click()
  await e.waitForTimeout(300)
  await e.screenshot({ path: `${OUT}/${tag}-elder-calls.png`, fullPage: true })
  await e.getByRole('button', { name: '显示设置' }).click()
  await e.waitForTimeout(300)
  await e.screenshot({ path: `${OUT}/${tag}-elder-show.png`, fullPage: true })
  await ctx.close()
}

await walk(1280, 900, 'd')
await walk(420, 900, 'm')
await b.close()
console.log('done')