// 安全守护：① 紧急求助长按 1 秒才触发（不足 1 秒不触发）；② 走完撤销条；
// ③ 平安到达：长辈端本机横幅 + 子女端「妈妈可能还没到」；④ 屏幕常亮开关（不支持时整行隐藏）。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase, buildSosToken, makeRideCard, yesterdayAt } from '../helpers.mjs'

test('紧急求助：长按 1 秒才生效 + 走完撤销条', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)
  await page.setViewportSize({ width: 390, height: 844 })

  const token = buildSosToken({
    cards: [
      makeRideCard({ segId: 'seg0', code: 'G7001', from: '上海虹桥站', to: '北京南站', depart: '08:00', arrive: '11:00' }),
      makeRideCard({ segId: 'seg1', code: 'G7002', from: '北京南站', to: '上海虹桥站', depart: '15:00', arrive: '18:00' }),
    ],
  })
  await page.goto(BASE + '/#/e/' + token)
  await waitText(page, '遇到困难，按住这个按钮')

  const sos = page.locator('.el-sos')
  const box = await sos.boundingBox()
  ck(!!box, '求助按钮渲染出来')
  ck(box.height >= 72, '求助按钮够大: ' + box.height)

  // ---- 按住不足 1 秒 → 不该触发 ----
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(300)
  ck(await page.getByText('要按住不放 1 秒').count() === 1, '按住时出现说明')
  await page.mouse.up()
  await page.waitForTimeout(300)
  ck(await page.locator('.sos-result').count() === 0, '松手太早不算数（防手滑）')

  // ---- 按住 ≥1 秒 → 触发：拨给首选（阿明）+ 位置短信 ----
  await page.mouse.down()
  await page.waitForTimeout(1400)
  await page.mouse.up()
  await page.locator('.sos-result').waitFor({ timeout: 8000 })
  const resultText = await page.locator('.sos-result').innerText()
  ck(resultText.includes('正在拨打') && resultText.includes('阿明'), '结果显示拨给谁: ' + resultText)
  ck(resultText.includes('138****1111'), '手机号脱敏显示: ' + resultText)

  // 本机镜像里应有一条 sos 事件（子女端靠它实时看到）
  const hasSos = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.indexOf('ptb:sync:') === 0)
    return keys.some((k) => String(localStorage.getItem(k) || '').includes('"sos"'))
  })
  ck(hasSos, '本机同步镜像记录了 sos 事件')

  // ---- 走完撤销：5 秒内可反悔 ----
  await page.locator('.card').nth(1).getByRole('button', { name: /走完了/ }).click()
  await page.locator('.el-toast').waitFor({ timeout: 4000 })
  const toast = await page.locator('.el-toast').innerText()
  ck(toast.includes('撤销'), '撤销条出现: ' + toast)
  ck(await page.locator('.card.card-done').count() === 1, '先真的标成走完了')
  await page.getByRole('button', { name: /^撤销$/ }).click()
  await page.waitForTimeout(200)
  ck(await page.locator('.card.card-done').count() === 0, '撤销后恢复没走完')
  ck(await page.locator('.el-toast').count() === 0, '撤销条消失')

  // ---- 撤销条会自动消失（等 6 秒）----
  await page.locator('.card').nth(1).getByRole('button', { name: /走完了/ }).click()
  await page.locator('.el-toast').waitFor({ timeout: 4000 })
  await page.waitForTimeout(6000)
  ck(await page.locator('.el-toast').count() === 0, '5 秒后自动消失')
})

test('屏幕常亮：开关存在；浏览器不支持时整行隐藏', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())

  // 支持 wakeLock（Chromium + localhost 是安全上下文）
  const { page } = await freshPage(browser)
  await page.setViewportSize({ width: 390, height: 844 })
  const token = buildSosToken({ cards: [makeRideCard({ segId: 'seg0' })] })
  await page.goto(BASE + '/#/e/' + token)
  await waitText(page, '今天')
  await page.getByRole('button', { name: '显示设置' }).click()
  await waitText(page, '屏幕常亮')
  ck(await page.getByText('勾完自动读下一段').count() === 1, '勾完自动读开关也在')
  const sw = page.getByRole('switch', { name: '屏幕常亮' })
  ck(await sw.getAttribute('aria-checked') === 'true', '默认打开')
  await sw.click()
  ck(await sw.getAttribute('aria-checked') === 'false', '点一下能关')
  // 关掉后刷新仍记得（存在本机）
  await page.reload()
  await page.getByRole('button', { name: '显示设置' }).click()
  await waitText(page, '屏幕常亮')
  ck(await page.getByRole('switch', { name: '屏幕常亮' }).getAttribute('aria-checked') === 'false', '刷新后仍是关')

  // 不支持 wakeLock 的浏览器：整行不渲染，也不弹任何提示
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
  await ctx2.addInitScript(() => {
    // 把 navigator.wakeLock 抹掉：模拟「浏览器不支持」的老设备
    try { Object.defineProperty(Navigator.prototype, 'wakeLock', { get: () => undefined, configurable: true }) } catch {}
  })
  const p2 = await ctx2.newPage()
  await p2.goto(BASE + '/#/e/' + token)
  await waitText(p2, '今天')
  await p2.getByRole('button', { name: '显示设置' }).click()
  await waitText(p2, '勾完自动读下一段')
  // 注意：说明文字「手机不支持屏幕常亮时…」里也含「屏幕常亮」，所以按开关本体判断
  ck(await p2.getByRole('switch', { name: '屏幕常亮' }).count() === 0, '不支持时整行隐藏')
  ck(await p2.getByRole('switch', { name: '勾完自动读下一段' }).count() === 1, '其它开关不受影响')
  ck(await p2.getByText('手机不支持屏幕常亮时').count() === 1, '有一句说明（不弹提示）')
  await ctx2.close()
})

test('平安到达：长辈端本机提醒 + 子女端「妈妈可能还没到」', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  // 昨天就该到了（固定用昨天：不会因为「现在-90 分钟」跨零点把顺序弄反）
  const yArrive = yesterdayAt('10:00')
  const yDepart = yesterdayAt('08:00')

  // ---- 子女端：导入 → 把这一段改成「昨天到」→ 分享 ----
  await registerAccount(page, 'arrive')
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9912次从上海虹桥站到北京南站 06:00发车 09:00到`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G9912')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const tripId = page.url().split('#/trip/')[1]

  await page.getByRole('button', { name: /^编辑$/ }).first().click()
  await page.locator('input[type="date"]').first().fill(yArrive.date)
  await page.locator('input[type="time"]').nth(0).fill(yDepart.time)
  await page.locator('input[type="time"]').nth(1).fill(yArrive.time)
  await page.getByRole('button', { name: /保存本段/ }).click()
  await waitText(page, '已保存')

  await page.goto(BASE + '/#/share/' + tripId)
  await page.getByRole('button', { name: /生成分享链接/ }).click()
  await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
  const link = await page.locator('input[readonly]').first().inputValue()

  await page.goto(BASE + '/#/trip/' + tripId)
  await waitText(page, '长辈动态')

  // ---- 长辈端：打开链接 → 本机横幅提醒给家人打电话 ----
  const elder = await ctx.newPage()
  await elder.setViewportSize({ width: 390, height: 844 })
  await elder.goto(link)
  await waitText(elder, 'G9912')
  await elder.locator('.arrive-banner').waitFor({ timeout: 8000 })
  const banner = await elder.locator('.arrive-text').innerText()
  ck(banner.includes('打个电话报平安'), '长辈端横幅文案: ' + banner)
  await elder.getByRole('button', { name: /好，我知道了/ }).click()
  await elder.waitForTimeout(200)
  ck(await elder.locator('.arrive-banner').count() === 0, '点过就不再打扰')

  // ---- 子女端：收到「妈妈可能还没到」 ----
  const alert = '妈妈可能还没到，打个电话吧'
  let seen = false
  try {
    await page.getByText(alert).first().waitFor({ timeout: 6000 })
    seen = true
  } catch { seen = false }
  if (!seen) {
    await page.reload()
    await waitText(page, '长辈动态')
    await page.getByText(alert).first().waitFor({ timeout: 8000 })
    seen = true
  }
  ck(seen, '子女端出现安全提醒：' + alert)
  ck(await page.locator('.safety-card').count() === 1, '提醒是一张醒目的卡')
  ck(await page.getByRole('button', { name: /先不提醒/ }).count() === 1, '可以「先不提醒」')

  await elder.close()
})