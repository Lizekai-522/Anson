// 到达指引 / 「接下来」引导 / 绝对倒计时 / 闽南话切换 / 存长图。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase, buildElderToken, makeRideCard, hoursAheadDepart } from '../helpers.mjs'

test('到达指引置顶 + 接下来引导 + 绝对倒计时', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  const hh = hoursAheadDepart(2)

  // ---- 子女端：导入 → 填「出站后往哪走」→ 分享 ----
  await registerAccount(page, 'guide')
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9913次从上海虹桥站到北京南站 05:00发车 23:00到`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G9913')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const tripId = page.url().split('#/trip/')[1]

  await page.getByRole('button', { name: /^编辑$/ }).first().click()
  await page.getByLabel(/出站后往哪走/).fill('B 口出站，右转直走 100 米，公交站就在路口')
  await page.getByRole('button', { name: /保存本段/ }).click()
  await waitText(page, '出站后往哪走')
  ck(await page.getByText('B 口出站，右转直走 100 米，公交站就在路口').count() >= 1, '行程页能看到指引')

  await page.goto(BASE + '/#/share/' + tripId)
  await page.getByRole('button', { name: /生成分享链接/ }).click()
  await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
  const link = await page.locator('input[readonly]').first().inputValue()

  // ---- 长辈端：指引置顶显示 ----
  const elder = await ctx.newPage()
  await elder.setViewportSize({ width: 390, height: 844 })
  await elder.goto(link)
  await waitText(elder, 'G9913')
  const guide = elder.locator('.guide')
  await guide.waitFor({ timeout: 8000 })
  ck((await guide.innerText()).includes('B 口出站，右转直走 100 米，公交站就在路口'), '长辈端卡片上有指引')
  // 置顶：引导块是卡片正文里的第一个元素
  const isFirst = await elder.locator('.card .card-body').first().evaluate((el) => el.firstElementChild.className.includes('guide'))
  ck(isFirst, '指引在卡片展开区置顶')

  await elder.close()
})

test('「接下来」引导 + 绝对倒计时 + 闽南话 + 存长图', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)
  await page.setViewportSize({ width: 390, height: 844 })

  const hh = hoursAheadDepart(2)
  const token = buildElderToken({
    title: '去北京',
    cards: [
      makeRideCard({ segId: 'seg0', code: 'G8001', from: '上海虹桥站', to: '北京南站', date: hh.date, depart: hh.time, arrive: '23:00' }),
      makeRideCard({ segId: 'seg1', code: 'G8002', from: '北京南站', to: '上海虹桥站', date: hh.date, depart: '23:30', arrive: '23:59' }),
    ],
  })
  await page.goto(BASE + '/#/e/' + token)
  await waitText(page, '今天')

  // ---- 绝对倒计时：离 HH:MM 出发还有 … ----
  const cd = await page.locator('.card-countdown').innerText()
  ck(new RegExp('^离 \\d{2}:\\d{2} 出发还有 ').test(cd), '倒计时是绝对时刻 + 剩余: ' + cd)

  // ---- 勾完第一段 → 第二段被标成「接下来您要去这里」 ----
  await page.locator('.card').nth(0).getByRole('button', { name: /走完了/ }).click()
  await page.waitForTimeout(300)
  const next = page.locator('.card').nth(1)
  ck(await next.locator('.next-pill').count() === 1, '第二段出现「接下来您要去这里」')
  ck(await next.evaluate((el) => el.className.includes('card-focus')), '并且被高亮描边')

  // ---- 闽南话：能切、能播（有台语声音走设备；没有则播音频包；都没有则如实提示）----
  // 顺带确认音频包确实能被浏览器取到（若已生成）
  const packCount = await page.evaluate(async () => {
    try {
      const r = await fetch('audio/nan/manifest.json')
      const j = await r.json()
      return Object.keys((j && j.items) || {}).length
    } catch { return 0 }
  })
  ck(packCount === 0 || packCount === 29, '音频包清单条数合理（0 = 未生成，29 = 已生成）: ' + packCount)

  // 无头浏览器没有台语声音，所以闽南话应该走「音频包」这条路：直接看它有没有去请求 mp3
  const mp3Reqs = []
  page.on('request', (r) => { if (/nan_[\w]+\.mp3$/.test(r.url())) mp3Reqs.push(r.url()) })

  const nanBtn = page.getByRole('button', { name: '闽南话', exact: true })
  await nanBtn.click()
  ck(await nanBtn.getAttribute('aria-pressed') === 'true', '切到闽南话')
  const chosen = await page.evaluate(() => JSON.parse(localStorage.getItem('ptb:elder:prefs') || '{}').voice)
  ck(chosen === 'nan', '语言选择存在本机: ' + chosen)

  const listenBtn = page.getByRole('button', { name: /听一遍|停止播报/ })
  await listenBtn.click()
  await page.waitForTimeout(1200)
  const label = await listenBtn.innerText()
  const notice = await page.locator('.voice-unsupported').count()
  ck(mp3Reqs.length >= 1 || notice === 1 || label.includes('停止播报'),
    '闽南话要么去取音频包（' + mp3Reqs.length + ' 个 mp3 请求），要么如实提示没有闽南语声音（label=' + label + '）')
  // 播报不至于把页面卡住：行程卡还在
  ck(await page.locator('.card').count() === 2, '播报后页面仍然可用')
  // 切回普通话
  await page.getByRole('button', { name: '普通话', exact: true }).click()
  await page.waitForTimeout(200)

  // ---- 存长图：点击后产生下载 ----
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.getByRole('button', { name: /存成长图/ }).click(),
  ])
  ck(/\.png$/.test(download.suggestedFilename()), '下载的是 PNG: ' + download.suggestedFilename())
})