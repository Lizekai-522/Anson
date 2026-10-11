// 子女之间分享行程：生成邀请链接 → 另一个（或同一）账号打开 /receive/<token> → 导入成新行程；
// 重复导入被拦；6 位码同设备路径可用；未登录先暂存、登录后自动回到接收页。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

test('接收子女分享的行程：链接 / 6 位码 / 重复拦截 / 登录后续接', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)

  const acc = await registerAccount(page, 'recv')

  // ---- 造一条行程并生成「子女邀请链接」----
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9902次从上海虹桥站到北京南站 08:00发车 11:00到`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G9902')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const tripId = page.url().split('#/trip/')[1]

  await page.goto(BASE + '/#/share/' + tripId)
  await page.getByRole('button', { name: /生成子女邀请链接/ }).click()
  await page.locator('#invite-url').waitFor({ timeout: 8000 })
  const inviteUrl = await page.locator('#invite-url').inputValue()
  ck(/#\/receive\//.test(inviteUrl), '邀请链接可用: ' + inviteUrl.slice(0, 50) + '…')
  // 6 位码从生成结果里读出来
  const codeText = await page.locator('.invite-code').innerText()
  const code6 = (codeText.match(/(\d{6})/) || [])[1]
  ck(/^\d{6}$/.test(code6 || ''), '拿到 6 位码: ' + code6)

  // ---- 打开邀请链接：预览 → 导入为新行程 ----
  const token = inviteUrl.split('#/receive/')[1]
  await page.goto(BASE + '/#/receive/' + token)
  await waitText(page, '要加入这条行程吗')
  await waitText(page, 'G9902')
  await page.getByRole('button', { name: /加入我的行程/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const importedId = page.url().split('#/trip/')[1]
  ck(!!importedId && importedId !== tripId, '导入成了另一条行程: ' + importedId)

  await page.goto(BASE + '/#/home')
  await waitText(page, '接收行程')
  ck(await page.locator('.trip-row').count() === 2, '首页有两条行程: ' + (await page.locator('.trip-row').count()))

  // ---- 重复导入被拦 ----
  await page.goto(BASE + '/#/receive/' + token)
  await waitText(page, '这条行程已经加入过了')

  // ---- 6 位码：同设备路径（扫本机 invites）----
  await page.goto(BASE + '/#/receive')
  await page.getByLabel('行程链接或 6 位码').fill(code6)
  await page.getByRole('button', { name: /^查看$/ }).click()
  await waitText(page, '这条行程已经加入过了')

  // ---- 未登录：暂存 + 登录后自动回到接收页 ----
  await page.goto(BASE + '/#/profile')
  await page.getByRole('button', { name: /退出登录/ }).click()
  await page.waitForURL(/#\/$/, { timeout: 8000 })

  // 换一条全新的邀请（避免命中「已加入」分支），验证 needlogin
  await page.goto(BASE + '/#/login')
  await page.getByLabel(/账号名 \/ 邮箱 \/ 手机号/).fill(acc.name)
  await page.getByLabel(/^密码$/).fill(acc.password)
  await page.getByRole('button', { name: /^登录$/ }).click()
  await page.waitForURL(/#\/home/, { timeout: 8000 })

  await page.goto(BASE + '/#/share/' + tripId)
  await page.getByRole('button', { name: /生成子女邀请链接/ }).click()
  await page.locator('#invite-url').waitFor({ timeout: 8000 })
  const inviteUrl2 = await page.locator('#invite-url').inputValue()
  const token2 = inviteUrl2.split('#/receive/')[1]

  await page.goto(BASE + '/#/profile')
  await page.getByRole('button', { name: /退出登录/ }).click()
  await page.waitForURL(/#\/$/, { timeout: 8000 })
  await page.goto(BASE + '/#/receive/' + token2)
  await waitText(page, '先登录，再接收这条行程')

  await page.getByRole('button', { name: /去登录/ }).click()
  await page.waitForURL(/#\/login/, { timeout: 8000 })
  await page.getByLabel(/账号名 \/ 邮箱 \/ 手机号/).fill(acc.name)
  await page.getByLabel(/^密码$/).fill(acc.password)
  await page.getByRole('button', { name: /^登录$/ }).click()
  await page.waitForURL(/#\/receive\//, { timeout: 8000 })
  await waitText(page, '要加入这条行程吗')
})