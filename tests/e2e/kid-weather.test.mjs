// 目的地天气：服务端返回正常时，子女能查到、随分享下发、长辈卡片上能看到；
// 服务端挂了就静默（不阻断分享，也不显示半截信息）。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

const WEATHER_JSON = { ok: true, city: '北京', date: '2026-10-11', tmax: 26, tmin: 18, rain: 10, code: 2 }

test('天气：查到 → 分享后长辈卡片可见；服务端失败 → 静默无天气', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  await registerAccount(page, 'wx')
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9914次从上海虹桥站到北京南站 08:00发车 11:00到`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G9914')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const tripId = page.url().split('#/trip/')[1]

  // ---- 服务端正常：查到天气 ----
  await page.route('**/api/weather**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WEATHER_JSON) }))
  await page.goto(BASE + '/#/trip/' + tripId)
  await waitText(page, '查目的地天气')
  await page.getByRole('button', { name: /查目的地天气/ }).click()
  await waitText(page, '已查到 1 个地方的天气')
  await waitText(page, '天气：26℃ 多云')

  // ---- 分享 → 长辈端卡片上带天气 ----
  await page.goto(BASE + '/#/share/' + tripId)
  await page.getByRole('button', { name: /生成分享链接/ }).click()
  await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
  const link = await page.locator('input[readonly]').first().inputValue()

  const elder = await ctx.newPage()
  await elder.setViewportSize({ width: 390, height: 844 })
  await elder.goto(link)
  await waitText(elder, 'G9914')
  const pill = elder.locator('.weather-pill')
  await pill.waitFor({ timeout: 8000 })
  ck((await pill.innerText()).includes('26℃'), '长辈卡片上有天气: ' + (await pill.innerText()))
  await elder.close()

  // ---- 服务端挂了：静默，不显示天气 ----
  await page.unroute('**/api/weather**')
  await page.route('**/api/weather**', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, reason: 'network' }) }))
  // 清掉已查到的天气，模拟「从没查过」
  await page.goto(BASE + '/#/trip/' + tripId)
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.indexOf('ptb:data:') === 0)
    if (!key) return
    const bucket = JSON.parse(localStorage.getItem(key))
    for (const t of bucket.trips || []) if (t.id) delete t.weather
    localStorage.setItem(key, JSON.stringify(bucket))
  })
  await page.reload()
  await waitText(page, '查目的地天气')
  await page.getByRole('button', { name: /查目的地天气/ }).click()
  await waitText(page, '没连上天气服务，不影响看行程')
  ck(await page.getByText(/^天气：/).count() === 0, '失败时不显示天气（不显示半截信息）')
})