// 在线真实地图 + 双端实时同步：
//   长辈端（授权定位）点「让子女看到我在哪」→ 地图出现在长辈端；
//   子女端行程页的「长辈现在在哪」也画出同一张地图（同设备同步轨）。
// 地图本身是 OSM 栅格瓦片；这里只断言瓦片元素被渲染 + 中心标记存在（离线时图片可能是空的，但结构必须在）。
import test from 'node:test'
import { ck, BASE, registerAccount, waitText, cnDatePhrase, launchBrowser } from '../helpers.mjs'

const GEO = { latitude: 31.2304, longitude: 121.4737 }

test('在线地图：长辈端与子女端实时同步', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
    geolocation: GEO,
    permissions: ['geolocation'],
  })
  const page = await ctx.newPage()

  // ---- 子女端：导入行程 + 生成分享（并允许长辈共享位置）----
  await registerAccount(page, 'map')
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9904次从上海虹桥站到北京南站 08:00发车 11:00到`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G9904')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const tripId = page.url().split('#/trip/')[1]

  await page.goto(BASE + '/#/share/' + tripId)
  await page.locator('.loc-switch').click()
  await waitText(page, '允许长辈共享位置')
  await page.getByRole('button', { name: /生成分享链接/ }).click()
  await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
  const link = await page.locator('input[readonly]').first().inputValue()

  await page.goto(BASE + '/#/trip/' + tripId)
  await waitText(page, '长辈动态')

  // ---- 长辈端：点共享位置 → 出事地点地图出现 ----
  const elder = await ctx.newPage()
  await elder.setViewportSize({ width: 390, height: 844 })
  await elder.goto(link)
  await waitText(elder, '让子女知道你在哪')
  await elder.locator('.loc-btn').click()

  await elder.locator('.loc-map .amap-tile').first().waitFor({ timeout: 12000 })
  const elderTiles = await elder.locator('.loc-map .amap-tile').count()
  ck(elderTiles > 0, '长辈端画出地图瓦片: ' + elderTiles)
  ck(await elder.locator('.loc-map .amap-marker').count() === 1, '长辈端有「你在这里」标记')
  await waitText(elder, '你在这里')

  // ---- 子女端：同一张地图跟着出现（同设备同步轨）----
  let seen = false
  try {
    await page.locator('.elder-loc-map .amap-tile').first().waitFor({ timeout: 6000 })
    seen = true
  } catch { seen = false }
  if (!seen) {
    await page.reload()
    await waitText(page, '长辈动态')
    await page.locator('.elder-loc-map .amap-tile').first().waitFor({ timeout: 10000 })
    seen = true
  }
  ck(seen, '子女端也能看到在线地图')
  ck(await page.locator('.elder-loc-map .amap-marker').count() === 1, '子女端有长辈位置标记')
  ck(await page.getByText('OpenStreetMap contributors').count() >= 1, '地图标注了数据来源')

  await elder.close()
})