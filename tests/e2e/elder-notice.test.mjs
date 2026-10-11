// 出发提醒：出发前 60 分钟内弹页内弹窗 → 点「去看看」跳到那张卡并高亮 →
// 「知道了」之后同一档不再弹；不点「知道了」刷新后仍会提醒。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, waitText, buildElderToken, makeRideCard, soonDepart } from '../helpers.mjs'

test('出发提醒：弹窗 → 去看看跳卡高亮 → 知道了不再弹', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)
  await page.setViewportSize({ width: 390, height: 844 })

  const { date, time } = soonDepart()
  const token = buildElderToken({
    title: '赶车',
    cards: [makeRideCard({ segId: 'seg0', code: 'G7001', from: '上海虹桥站', to: '北京南站', date, depart: time, arrive: '' })],
  })

  await page.goto(BASE + '/#/e/' + token)
  await waitText(page, '快出发了')
  ck(await page.locator('.notice-mask').count() === 1, '页内弹窗出现')
  const cd = await page.locator('.notice-countdown').innerText()
  ck(/还有|该出发了/.test(cd), '倒计时文案: ' + cd)
  const title = await page.locator('.notice-title').innerText()
  ck(title.includes('G7001'), '弹窗标题带车次: ' + title)

  // 去看看 → 跳到那张卡并高亮（behavior=auto，不做平滑滚动）
  await page.getByRole('button', { name: '去看看' }).click()
  await page.waitForTimeout(150)
  ck(await page.locator('.notice-mask').count() === 0, '点去看后弹窗关闭')
  const focus = page.locator('.card.card-focus')
  ck(await focus.count() === 1, '目标卡获得高亮')
  const inView = await focus.first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top >= -1 && r.bottom <= window.innerHeight + 1
  })
  ck(inView, '高亮卡落在视口内')

  // 没点「知道了」→ 刷新后仍会提醒（跳转不等于已读）
  await page.reload()
  await waitText(page, '快出发了')
  ck(await page.locator('.notice-mask').count() === 1, '未读提醒刷新后仍弹')

  // 知道了 → 同一档不再弹
  await page.getByRole('button', { name: '知道了' }).click()
  await page.waitForTimeout(150)
  ck(await page.locator('.notice-mask').count() === 0, '知道了后弹窗消失')
  await page.reload()
  await waitText(page, '今天')
  await page.waitForTimeout(800)
  ck(await page.locator('.notice-mask').count() === 0, '同一档提醒不再弹')
})