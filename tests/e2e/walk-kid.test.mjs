// 子女端真实走查：注册 → 登录 → 导入 → 行程 → 分享
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, freshPage, ck, BASE, registerAccount, todayStr, waitText } from '../helpers.mjs'

const SHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')

const SAMPLE = '10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到\n住一晚 如家酒店(北京南站店)\n第二天高铁 G104 上海虹桥 -> 杭州东'

test('walk-kid 全流程', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  await t.test('身份选择页', async () => {
    await page.goto(BASE + '/#/')
    await waitText(page, '安程')
    await waitText(page, '我是爸妈')
    await waitText(page, '我是子女')
    ck(true, 'welcome 渲染')
  })

  let acc
  await t.test('注册五字段 → 落到首页', async () => {
    acc = await registerAccount(page, 'walk')
    await waitText(page, '行程')
    ck(page.url().includes('#/home'), 'URL 在 home: ' + page.url())
  })

  await t.test('F5 后登录态不丢（boot 顺序回归）', async () => {
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await waitText(page, acc.name, 8000)
    ck(page.url().includes('#/home'), '刷新后仍在 home')
  })

  await t.test('导入行程：解析预览 → 确认入库', async () => {
    await page.goto(BASE + '/#/import')
    await page.locator('textarea').fill(SAMPLE)
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'G7102')
    await waitText(page, '上海虹桥站')
    await waitText(page, '如家酒店(北京南站店)')
    ck(true, '解析预览可见')
    await page.getByRole('button', { name: /确认导入/ }).click()
    await page.waitForURL(/#\/trip\//, { timeout: 8000 })
    await waitText(page, 'G7102')
    ck(true, '行程详情可见')
  })

  await t.test('首页列表与搜索', async () => {
    await page.goto(BASE + '/#/home')
    await waitText(page, 'G7102')
    await page.locator('input[type=search], input').first().fill('不存在的行程名')
    await page.waitForTimeout(300)
    ck(true, '搜索不崩')
    await page.locator('input[type=search], input').first().fill('')
  })

  await t.test('分享：链接 + 6 位码 + 必须真出二维码', async () => {
    await page.goto(BASE + '/#/home')
    await page.getByRole('button', { name: /分享/ }).first().click()
    await page.waitForURL(/#\/share\//)
    await page.getByRole('button', { name: /生成分享链接/ }).click()
    await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
    const link = await page.locator('input[readonly]').first().inputValue()
    ck(link.includes('#/e/'), '分享链接含 token: ' + link.slice(0, 60))
    const code = await page.locator('text=/^[0-9]{6}$/').first().textContent()
    ck(/^\d{6}$/.test(code.trim()), '6 位码: ' + code)
    // 以前这里允许"二维码放不下"降级通过，结果整段行程根本扫不了码；
    // 现在短行程必须真出码，而且每格要够宽（扫得动），降级只允许出现在超长行程上。
    const qr = page.locator('img[alt*="二维码"]')
    await qr.waitFor({ timeout: 8000 })
    const box = await qr.evaluate((el) => ({ w: el.naturalWidth, nw: el.getAttribute('width') }))
    ck(box.nw === '248', '二维码承载尺寸 248px: ' + box.nw)
    ck(link.length < 600, '短行程链接要够短才扫得动: ' + link.length + ' 字符')
    // 出码状态留一张基线：这个是用户报过的"二维码不显示"，必须肉眼可查
    await page.waitForTimeout(700) // 等 6 位码逐位翻入收尾，基线别抓到动画中途
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, 'kid-share-qr.png') })
  })

  await t.test('长辈端预览直达（免登录）', async () => {
    const link = await page.locator('input[readonly]').first().inputValue()
    const p2 = await ctx.newPage()
    await p2.goto(link)
    await waitText(p2, '今天')
    // 整趟行程都要能看到（SAMPLE 有 3 段：G7102 高铁 / 如家酒店 / G104 高铁），
    // 不能只显示"今天"那一段而把别的段藏起来
    ck(await p2.locator('.card').count() === 3, '长辈端列出整趟 3 段')
    await waitText(p2, 'G104')
    ck(true, '长辈端打开')
    await p2.close()
  })

  await t.test('退出登录回身份页', async () => {
    await page.goto(BASE + '/#/profile')
    await page.getByRole('button', { name: /退出登录/ }).click()
    await page.waitForURL(/#\/$|#$|#\/\?|\/#\/$/)
    await waitText(page, '我是爸妈')
    ck(true, '已退出')
  })

  await t.test('统一登录错误：不泄露账号是否存在', async () => {
    await page.goto(BASE + '/#/login')
    await page.locator('input').nth(0).fill('nobody_here_12345')
    await page.locator('input[type=password]').fill('WrongPass1')
    await page.getByRole('button', { name: /登录/ }).click()
    await waitText(page, '账号或密码不对')
    ck(true, '统一文案')
  })

  await t.test('三种标识登录：手机号', async () => {
    await page.goto(BASE + '/#/login')
    await page.locator('input').nth(0).fill(acc.phone)
    await page.locator('input[type=password]').fill(acc.password)
    await page.getByRole('button', { name: /登录/ }).click()
    await page.waitForURL(/#\/home/, { timeout: 8000 })
    ck(true, '手机号登录成功')
  })
})
