// 家人分组 + 「他对我的称呼」+ 分享页按组选家人 → 结果/记录展示本次家人姓名；
// 长辈端家人页能看到「他叫你：…」。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

test('家人分组 / 称呼 / 分享页选家人', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  await registerAccount(page, 'fam')

  // ---- 加两位家人，各自配「他对我的称呼」----
  await page.goto(BASE + '/#/family')
  const people = [
    { name: '阿明', relation: '儿子', callsMe: '妈', phone: '13800001111' },
    { name: '阿芳', relation: '女儿', callsMe: '爸', phone: '13900002222' },
  ]
  for (const p of people) {
    await page.getByRole('button', { name: /添加家人/ }).first().click()
    await page.getByLabel('姓名').fill(p.name)
    await page.getByLabel(/称呼（长辈看到的就是这个）/).fill(p.relation)
    await page.getByLabel(/他对我的称呼/).fill(p.callsMe)
    await page.getByLabel('手机号').fill(p.phone)
    await page.getByRole('button', { name: /^保存$/ }).click()
    await waitText(page, p.name)
  }
  ck(await page.getByText('他叫你：妈').count() >= 1, '家人列表显示「他叫你：妈」')
  ck(await page.getByText('他叫你：爸').count() >= 1, '家人列表显示「他叫你：爸」')

  // ---- 建一个分组，把两人都放进去 ----
  await page.getByRole('button', { name: /新建分组/ }).click()
  await page.getByLabel('分组名').fill('老家组')
  await page.locator('.group-member').filter({ hasText: '阿明' }).click()
  await page.locator('.group-member').filter({ hasText: '阿芳' }).click()
  await page.getByRole('button', { name: /保存分组/ }).click()
  await waitText(page, '阿明、阿芳')

  // 家人卡片上出现只读分组标签
  ck(await page.getByText('老家组').count() >= 2, '家人卡片带分组标签 + 分组列表')

  // ---- 造一条行程 → 分享页 ----
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9903次从上海虹桥站到北京南站 08:00发车 11:00到`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G9903')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const tripId = page.url().split('#/trip/')[1]

  await page.goto(BASE + '/#/share/' + tripId)
  await waitText(page, '本次包含的家人')
  ck(await page.locator('.pick-item').count() === 2, '两个家人可勾选')

  // 全不选 → 0；按组一键 → 回到 2
  await page.getByRole('button', { name: /^全不选$/ }).click()
  await waitText(page, '已选 0 / 2')
  await page.getByRole('button', { name: /^老家组$/ }).click()
  await waitText(page, '已选 2 / 2')

  await page.getByRole('button', { name: /生成分享链接/ }).click()
  await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
  const link = await page.locator('input[readonly]').first().inputValue()

  await waitText(page, '本次包含的家人：阿明、阿芳')
  await waitText(page, '本次家人：阿明、阿芳')

  // ---- 长辈端家人页：显示「他叫你：妈」----
  const elder = await ctx.newPage()
  await elder.setViewportSize({ width: 390, height: 844 })
  await elder.goto(link)
  await waitText(elder, '今天')
  await elder.getByRole('button', { name: '家人电话' }).click()
  await waitText(elder, '他叫你：妈')
  ck(await elder.getByText('他叫你：爸').count() >= 1, '长辈端也能看到「他叫你：爸」')
  await elder.close()
})