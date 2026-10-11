// 长辈端任务态：走完了 → 压成一行（仍然是原来的卡片）；再点改回；收起/展开；刷新后记得。
// 三条硬要求来自用户原话：
//   1. 点一下完成 → 完成的那一段缩成一行
//   2. 「还是原本的卡片」→ 宽度/底色/描边都不许变
//   3. 卡片可以折叠
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, waitText, buildElderToken, makeRideCard } from '../helpers.mjs'

test('长辈端任务态：走完了压成一行 + 收起展开 + 刷新记得', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)
  await page.setViewportSize({ width: 390, height: 844 })

  const token = buildElderToken({
    title: '去北京',
    cards: [
      makeRideCard({ segId: 'seg0', code: 'G8001', from: '上海虹桥站', to: '北京南站', depart: '08:00', arrive: '11:00' }),
      makeRideCard({ segId: 'seg1', code: 'G8002', from: '北京南站', to: '上海虹桥站', depart: '15:00', arrive: '18:00' }),
    ],
  })
  await page.goto(BASE + '/#/e/' + token)
  await waitText(page, '今天')

  const cards = page.locator('.card')
  ck(await cards.count() === 2, '两张卡')

  // ---- 走完了：压成一行，但仍是卡片 ----
  const before = await cards.nth(0).boundingBox()
  await cards.nth(0).getByRole('button', { name: /走完了/ }).click()
  await page.waitForTimeout(100)

  const done = page.locator('.card.card-done')
  ck(await done.count() === 1, '第一张进入完成态')
  ck(await done.first().getByText('已走完').count() === 1, '完成态有「已走完」徽标')

  const after = await done.first().boundingBox()
  ck(Math.abs(after.width - before.width) <= 2, '宽度不变（还是原来的卡片）: ' + before.width + '→' + after.width)
  ck(after.height < before.height - 20, '高度显著变小（压成一行）: ' + before.height + '→' + after.height)
  ck(await done.first().locator('.card-line3').count() === 1, '完成态仍保留时间行')
  const look = await done.first().evaluate((el) => {
    const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, top: parseFloat(cs.borderTopWidth), radius: cs.borderRadius }
  })
  ck(look.bg !== 'rgba(0, 0, 0, 0)' && look.bg !== 'transparent', '完成态仍有卡片底色: ' + look.bg)
  ck(look.top > 0, '完成态仍有卡片顶线/描边: ' + look.top)

  // ---- 改回没走完：恢复完整卡片 ----
  await done.first().getByRole('button', { name: /改回没走完/ }).click()
  await page.waitForTimeout(100)
  ck(await page.locator('.card.card-done').count() === 0, '改回后不再是完成态')
  const restored = await page.locator('.card').nth(0).boundingBox()
  ck(restored.height > after.height + 20, '恢复成完整卡片: ' + after.height + '→' + restored.height)

  // ---- 收起 / 展开 ----
  const first = page.locator('.card').nth(0)
  await first.locator('.card-toggle').click()
  await page.waitForTimeout(100)
  ck(await first.evaluate((el) => el.classList.contains('card-collapsed')), '收起后带 card-collapsed')
  ck(await first.locator('.card-toggle').getAttribute('aria-expanded') === 'false', 'aria-expanded=false')
  ck(!(await first.locator('.card-body').isVisible()), '收起后正文不可见')

  await first.locator('.card-toggle').click()
  await page.waitForTimeout(100)
  ck(!(await first.evaluate((el) => el.classList.contains('card-collapsed'))), '再点展开')
  ck(await first.locator('.card-body').isVisible(), '正文重新可见')

  // ---- 刷新后状态保持（localStorage，按 room 隔离）----
  await page.locator('.card').nth(1).getByRole('button', { name: /走完了/ }).click()
  await first.locator('.card-toggle').click()
  await page.waitForTimeout(150)
  await page.reload()
  await waitText(page, '今天')
  ck(await page.locator('.card.card-done').count() === 1, '刷新后完成态仍在')
  ck(await page.locator('.card').nth(0).evaluate((el) => el.classList.contains('card-collapsed')), '刷新后收起态仍在')
})