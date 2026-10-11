// 双轨同步的同设备一侧：同一浏览器开两个标签 —— 长辈端点「走完了」，子女端行程页的
// 「长辈动态」应出现对应记录（走 BroadcastChannel + localStorage 镜像，不起服务端）。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

test('长辈端动作同步到子女端（同设备轨）', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  // ---- 子女端：登录 → 导入今天的行程 → 生成一次分享链接（room 由它派生）----
  await registerAccount(page, 'sync')
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9901次从上海虹桥站到北京南站 08:00发车 11:00到`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G9901')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const tripId = page.url().split('#/trip/')[1]
  ck(!!tripId, '拿到 tripId: ' + tripId)

  await page.goto(BASE + '/#/home')
  await page.getByRole('button', { name: /分享/ }).first().click()
  await page.waitForURL(/#\/share\//, { timeout: 8000 })
  await page.getByRole('button', { name: /生成分享链接/ }).click()
  await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
  const link = await page.locator('input[readonly]').first().inputValue()
  ck(/^https?:\/\/.+#\/e\//.test(link), '分享链接可用: ' + link.slice(0, 40) + '…')

  // ---- 子女端看「长辈动态」：未部署同步服务时如实标注 ----
  await page.goto(BASE + '/#/trip/' + tripId)
  await waitText(page, '长辈动态')
  await waitText(page, '仅同设备可见')

  // ---- 长辈端（同一浏览器，第二个标签）：打开同一条链接，点「走完了」----
  const elder = await ctx.newPage()
  await elder.setViewportSize({ width: 390, height: 844 })
  await elder.goto(link)
  await waitText(elder, '今天')
  await elder.locator('.card-done-btn').first().click()

  // ---- 子女端应看到这条动态（BroadcastChannel 立即投递；环境吞掉则刷新后从镜像铺底）----
  const feed = '长辈把第 1 段标成走完了'
  let seen = false
  try {
    await page.getByText(feed).first().waitFor({ timeout: 6000 })
    seen = true
  } catch { seen = false }
  if (!seen) {
    await page.reload()
    await waitText(page, feed, 8000)
    seen = true
  }
  ck(seen, '子女端「长辈动态」出现：' + feed)

  await elder.close()
})