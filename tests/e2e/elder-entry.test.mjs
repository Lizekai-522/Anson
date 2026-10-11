// 长辈端入口：① 输码成功后「记住这台手机」→ 再进来给「继续上次的行程」；② 换一个行程会清掉；
// ③ 断网时给一句「行程已经存在这台手机里」的横幅。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

test('记住这台手机 + 离线横幅', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  // ---- 子女端：造一条行程，拿到 6 位码（输码是「记住本机」的唯一入口）----
  await registerAccount(page, 'entry')
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9911次从上海虹桥站到北京南站 08:00发车 11:00到`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G9911')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })
  const tripId = page.url().split('#/trip/')[1]

  await page.goto(BASE + '/#/share/' + tripId)
  await page.getByRole('button', { name: /生成分享链接/ }).click()
  await page.locator('.code6').waitFor({ timeout: 8000 })
  const code6 = (await page.locator('.code6').innerText()).replace(/\D/g, '')
  ck(/^\d{6}$/.test(code6), '拿到 6 位码: ' + code6)

  // ---- 长辈端：输码 → 看到行程 ----
  const elder = await ctx.newPage()
  await elder.setViewportSize({ width: 390, height: 844 })
  await elder.goto(BASE + '/#/e')
  await waitText(elder, '输入子女给的')
  await elder.getByLabel('6 位码').fill(code6)
  await elder.getByRole('button', { name: /查看行程/ }).click()
  await waitText(elder, 'G9911')

  // ---- 再进 /e：给「继续上次的行程」 + 「换一个行程」----
  await elder.goto(BASE + '/#/e')
  await waitText(elder, '欢迎回来')
  ck(await elder.getByText('继续上次的行程').count() === 1, '有大按钮「继续上次的行程」')
  const sub = await elder.locator('.resume-sub').innerText()
  ck(sub.includes('G9911'), '按钮上写着行程名: ' + sub)

  // 点它 → 直接进行程，不再输码
  await elder.getByRole('button', { name: /继续上次的行程/ }).click()
  await waitText(elder, 'G9911')
  ck(!(await elder.getByLabel('6 位码').count()), '没有再要求输码')

  // ---- 「换一个行程」→ 回输码页，并且清掉本机记忆 ----
  await elder.goto(BASE + '/#/e')
  await waitText(elder, '欢迎回来')
  await elder.getByRole('button', { name: /换一个行程/ }).click()
  await waitText(elder, '输入子女给的')
  await elder.goto(BASE + '/#/e')
  await waitText(elder, '输入子女给的')
  ck(await elder.getByText('继续上次的行程').count() === 0, '清掉后不再出现「继续上次的行程」')

  // ---- 离线横幅：同一页面里断网 → 一句人话 ----
  await elder.goto(BASE + '/#/e')
  // 用 6 位码再进一次，保证在行程页
  await elder.getByLabel('6 位码').fill(code6)
  await elder.getByRole('button', { name: /查看行程/ }).click()
  await waitText(elder, 'G9911')
  ck(await elder.locator('.offline-banner').count() === 0, '有网时不显示横幅')
  await ctx.setOffline(true)
  await waitText(elder, '没有网络 · 行程已经存在这台手机里')
  await ctx.setOffline(false)
  await elder.waitForTimeout(200)
  ck(await elder.locator('.offline-banner').count() === 0, '恢复网络后横幅自动消失')

  await elder.close()
})