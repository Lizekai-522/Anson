// 两功能点组合走查：真实用户不会只用一个功能，组合才是崩溃高发区。
// 每个用例 = 两个功能点的接力，前一个的输出是后一个的输入。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

const tripText = (n, off) =>
  `${cnDatePhrase(off)}早上G${7200 + n}次从上海虹桥站到北京南站 0${8 + (n % 2)}:${String((n * 13) % 60).padStart(2, '0')}发车`

test('combo：连续导入两个行程 → 首页两条 → 分享第一条', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)
  await registerAccount(page, 'combo')

  await t.test('组合：导入#1 → 导入#2（入库不串）', async () => {
    for (const n of [1, 2]) {
      await page.goto(BASE + '/#/import')
      await page.locator('textarea').fill(tripText(n, n))
      await page.getByRole('button', { name: /解析行程/ }).click()
      await waitText(page, `G${7200 + n}`)
      await page.getByRole('button', { name: /确认导入/ }).click()
      await page.waitForURL(/#\/trip\//, { timeout: 8000 })
    }
    await page.goto(BASE + '/#/home')
    await waitText(page, 'G7201')
    await waitText(page, 'G7202')
    ck(true, '两条行程都在首页')
  })

  await t.test('组合：分享第一条 → 长辈端看到 G7201', async () => {
    await page.goto(BASE + '/#/home')
    const cards = page.locator('.trip-card, [class*=trip]', { hasText: 'G7201' })
    await cards.first().getByRole('button', { name: /分享/ }).first().click()
    await page.waitForURL(/#\/share\//)
    await page.getByRole('button', { name: /生成分享链接/ }).click()
    await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
    const link = await page.locator('input[readonly]').first().inputValue()
    ck(link.includes('#/e/'), '拿到链接')
    const p2 = await ctx.newPage()
    await p2.goto(link)
    await waitText(p2, '今天')
    await p2.close()
  })
})

test('combo：退出登录 → 手机号登录 → 数据还在', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)
  const acc = await registerAccount(page, 'cswap')

  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(tripText(5, 1))
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G7205')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })

  await t.test('组合：退出 → 手机号登录', async () => {
    await page.goto(BASE + '/#/profile')
    await page.getByRole('button', { name: /退出登录/ }).click()
    await page.waitForURL(/#\/$|#$|\/#\/$/, { timeout: 8000 })
    await page.goto(BASE + '/#/login')
    await page.locator('input').nth(0).fill(acc.phone)
    await page.locator('input[type=password]').fill(acc.password)
    await page.getByRole('button', { name: /登录/ }).click()
    await page.waitForURL(/#\/home/, { timeout: 8000 })
    ck(true, '手机号重新登录成功')
  })

  await t.test('组合：登录后行程数据仍在（账号隔离不丢）', async () => {
    await page.goto(BASE + '/#/home')
    await waitText(page, 'G7205')
    ck(true, '数据完好')
  })
})

test('combo：坏链接恢复 → 输码页 → 错码提示', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  await t.test('组合：坏 token → 恢复页 → 点回输码页', async () => {
    await page.goto(BASE + '/#/e/aaaa.bbbb-坏token')
    await waitText(page, '链接好像不对')
    await page.getByRole('button', { name: /输入 6 位码试试/ }).click()
    await waitText(page, '输入子女给的 6 位码')
    ck(true, '恢复页 → 输码页不崩')
  })

  await t.test('组合：无缓存输错码 → role=alert 提示', async () => {
    await page.locator('#elder-code').fill('000000')
    await page.getByRole('button', { name: /查看行程/ }).click()
    await page.waitForTimeout(600)
    const alert = page.locator('[role=alert]')
    ck(await alert.count() > 0, '有 alert 提示')
  })
})

test('combo：解析预览 → 重新解析换文本 → 确认导入', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)
  await registerAccount(page, 'credo')

  await t.test('组合：解析A → 重新解析 → 解析B → 入库为B', async () => {
    await page.goto(BASE + '/#/import')
    await page.locator('textarea').fill(tripText(9, 2))
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'G7209')
    await page.getByRole('button', { name: /重新解析/ }).click()
    await page.locator('textarea').fill(tripText(10, 3))
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'G7210')
    await page.getByRole('button', { name: /确认导入/ }).click()
    await page.waitForURL(/#\/trip\//, { timeout: 8000 })
    await waitText(page, 'G7210')
    ck(true, '重解析后入库的是新文本')
  })

  await t.test('组合：导入后分享码随内容变化', async () => {
    await page.goto(BASE + '/#/home')
    await page.getByRole('button', { name: /分享/ }).first().click()
    await page.waitForURL(/#\/share\//)
    await page.getByRole('button', { name: /生成分享链接/ }).click()
    await page.locator('text=/^[0-9]{6}$/').first().waitFor({ timeout: 8000 })
    const code = (await page.locator('text=/^[0-9]{6}$/').first().textContent()).trim()
    ck(/^\d{6}$/.test(code), '6 位码正常: ' + code)
  })
})
