// 长辈端「到了之后做什么」清单：卡片里能勾、刷新记得、同设备子女端能看到这条动态。
// 覆盖 R3（子女写清单）+ R4（长辈勾选实时回传）。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

test('子女写清单 → 长辈勾选 → 刷新保持 + 子女端看到动态', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  // ---- 子女端：导入一条「游玩安排」→ 在段编辑里加一条清单 ----
  await registerAccount(page, 'todo')
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(0)}下午去城东公园逛逛`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, '城东公园')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const tripId = page.url().split('#/trip/')[1]

  await page.getByRole('button', { name: /^编辑$/ }).first().click()
  await page.getByRole('button', { name: /加一项/ }).click()
  await page.getByLabel('清单第 1 项', { exact: true }).fill('买瓶水')
  await page.getByLabel('清单第 1 项优先级').selectOption('high')
  await page.getByRole('button', { name: /保存本段/ }).click()
  await waitText(page, '到了之后做什么')
  ck(await page.getByText('买瓶水').count() >= 1, '行程页出现清单项')

  // ---- 生成分享链接 ----
  await page.goto(BASE + '/#/share/' + tripId)
  await page.getByRole('button', { name: /生成分享链接/ }).click()
  await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
  const link = await page.locator('input[readonly]').first().inputValue()

  await page.goto(BASE + '/#/trip/' + tripId)
  await waitText(page, '长辈动态')
  await waitText(page, '仅同设备可见')

  // ---- 长辈端（同浏览器第二个标签）：卡片里勾清单 ----
  const elder = await ctx.newPage()
  await elder.setViewportSize({ width: 390, height: 844 })
  await elder.goto(link)
  await waitText(elder, '城东公园')

  const rows = elder.locator('.todo-row')
  ck(await rows.count() === 1, '卡片里有 1 条清单: ' + (await rows.count()))
  ck((await rows.first().innerText()).includes('买瓶水'), '清单文案可见')
  ck((await rows.first().innerText()).includes('重要'), '优先级标签可见（色 + 字双通道）')
  ck(await rows.first().getAttribute('aria-pressed') === 'false', '初始未勾选')

  await rows.first().click()
  await elder.waitForTimeout(150)
  ck(await rows.first().getAttribute('aria-pressed') === 'true', '勾上后 aria-pressed=true')
  ck(await rows.first().evaluate((el) => el.classList.contains('todo-row-done')), '进入完成态样式')

  // 触控区 ≥60px（适老化）
  const box = await rows.first().boundingBox()
  ck(box.height >= 60, '清单行高 ' + box.height + ' ≥ 60')

  // ---- 刷新后仍然记得（按 room 存本机）----
  await elder.reload()
  await waitText(elder, '城东公园')
  ck(await elder.locator('.todo-row').first().getAttribute('aria-pressed') === 'true', '刷新后勾选仍在')

  // ---- 子女端时间线出现这条动态 ----
  const feed = '长辈完成了「买瓶水」（第 1 段）'
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