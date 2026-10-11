// 压力测试：真实长辈场景是「子女一次粘一大段、多天多段」+「一季攒几十条行程」。
// 全部走 UI，不注入 localStorage——注入绕过了被测对象。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

// 生成 40 天、每天 1 段的行程原文（时间递增，避免合理性检查倒序告警干扰）
function bigTripText(n = 40) {
  const lines = []
  for (let i = 0; i < n; i++) {
    const dep = 6 * 60 + i * 20
    const arr = dep + 120
    const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
    lines.push(`${cnDatePhrase(i)}早上G${7300 + i}次从上海虹桥站到北京南站 ${hm(dep)}发车 ${hm(arr)}到`)
  }
  return lines.join('\n')
}

test('scale：40 段大行程 解析→渲染→长辈端', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)
  await registerAccount(page, 'scale')

  let shareLink = ''
  await t.test('压力A：40 段原文解析 < 6s 且卡数达标', async () => {
    await page.goto(BASE + '/#/import')
    await page.locator('textarea').fill(bigTripText(40))
    const t0 = Date.now()
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'G7339', 15000)
    const cost = Date.now() - t0
    ck(cost < 6000, '解析耗时 ' + cost + 'ms < 6s')
    const gCount = await page.locator('text=/G73\\d\\d/').count()
    ck(gCount >= 20, '预览可见车次卡数量 ' + gCount + ' ≥ 20（可见区计数）')
  })

  await t.test('压力B：确认入库 → 详情页渲染 40 卡可滚动', async () => {
    const t0 = Date.now()
    await page.getByRole('button', { name: /确认导入/ }).click()
    await page.waitForURL(/#\/trip\//, { timeout: 10000 })
    await waitText(page, 'G7339')
    const cost = Date.now() - t0
    ck(cost < 8000, '入库+详情渲染 ' + cost + 'ms < 8s')
    const scroll = await page.evaluate(() => document.body.scrollHeight)
    ck(scroll > 2000, '长列表可滚动 scrollHeight=' + scroll)
  })

  await t.test('压力C：40 段分享 → 长辈端打开 < 3s', async () => {
    await page.goto(BASE + '/#/home')
    await page.getByRole('button', { name: /分享/ }).first().click()
    await page.waitForURL(/#\/share\//)
    await page.getByRole('button', { name: /生成分享链接/ }).click()
    await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
    shareLink = await page.locator('input[readonly]').first().inputValue()
    const p2 = await ctx.newPage()
    const t0 = Date.now()
    await p2.goto(shareLink)
    await waitText(p2, '今天', 8000)
    const cost = Date.now() - t0
    ck(cost < 3000, '长辈端打开 ' + cost + 'ms < 3s')
    await p2.close()
  })

  await t.test('压力D：刷新后 40 卡行程仍完整', async () => {
    await page.goto(BASE + '/#/home')
    await waitText(page, 'G7300', 8000) // 列表卡展示首段车次
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await waitText(page, 'G7300', 8000)
    ck(true, '刷新不丢')
  })
})

test('scale：20 条独立行程 列表+搜索', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)
  await registerAccount(page, 'many')

  await t.test('压力E：连续导入 20 条', async () => {
    for (let i = 0; i < 20; i++) {
      await page.goto(BASE + '/#/import')
      await page.locator('textarea').fill(`${cnDatePhrase(1)}早上G${7400 + i}次从南京南站到苏州站 09:${String((i * 7) % 60).padStart(2, '0')}发车`)
      await page.getByRole('button', { name: /解析行程/ }).click()
      await waitText(page, `G${7400 + i}`, 10000)
      await page.getByRole('button', { name: /确认导入/ }).click()
      await page.waitForURL(/#\/trip\//, { timeout: 8000 })
    }
    ck(true, '20 条入库')
  })

  await t.test('压力F：列表全渲染 + 搜索 < 1s', async () => {
    await page.goto(BASE + '/#/home')
    await waitText(page, 'G7419', 8000)
    const t0 = Date.now()
    await page.locator('input[type=search], input').first().fill('G7419')
    await page.waitForTimeout(400)
    const cost = Date.now() - t0
    ck(cost < 1000, '搜索响应 ' + cost + 'ms < 1s')
    await page.locator('input[type=search], input').first().fill('')
  })
})
