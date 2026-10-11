// 第二轮新增能力走查：备份导入恢复 / 行程段增删（含长辈端联动）/ 本机账号删除。
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

const SHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')

test('备份：导出 → 清空 → 导入恢复', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)
  await registerAccount(page, 'bk')

  await t.test('准备一份行程并导出备份', async () => {
    await page.goto(BASE + '/#/import')
    await page.locator('textarea').fill(`${cnDatePhrase(1)}早上G8101次从上海虹桥站到北京南站 09:30发车 13:45到`)
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'G8101')
    await page.getByRole('button', { name: /确认导入/ }).click()
    await page.waitForURL(/#\/trip\//, { timeout: 8000 })

    await page.goto(BASE + '/#/profile')
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      page.getByRole('button', { name: /导出数据备份/ }).click(),
    ])
    const file = path.join(os.tmpdir(), 'ptb-backup-' + Date.now() + '.json')
    await download.saveAs(file)
    ck(fs.existsSync(file) && fs.statSync(file).size > 20, '备份文件已落盘')
    globalThis.__bkFile = file
  })

  await t.test('清空本账号数据 → 首页空态', async () => {
    await page.goto(BASE + '/#/profile')
    await page.getByRole('button', { name: /清空本账号数据/ }).click()
    await page.getByRole('button', { name: /确认清空/ }).click()
    await page.goto(BASE + '/#/home')
    await waitText(page, '还没有行程')
    ck(true, '清空后回到空态')
  })

  await t.test('非法文件：提示无效且不落库', async () => {
    const bad = path.join(os.tmpdir(), 'ptb-bad-' + Date.now() + '.json')
    fs.writeFileSync(bad, '{"hello":"world"}')
    await page.goto(BASE + '/#/profile')
    await page.locator('input[type=file]').setInputFiles(bad)
    await waitText(page, '这不是有效的备份文件', 6000)
    fs.unlinkSync(bad)
    ck(true, '非法文件被拦下')
  })

  await t.test('从备份恢复 → 行程回来了', async () => {
    await page.locator('input[type=file]').setInputFiles(globalThis.__bkFile)
    await waitText(page, '已恢复', 6000)
    await page.goto(BASE + '/#/home')
    await waitText(page, 'G8101', 8000)
    ck(true, '数据已恢复')
  })

  await t.test('重复导入同一份：提示没有新内容', async () => {
    await page.goto(BASE + '/#/profile')
    await page.locator('input[type=file]').setInputFiles(globalThis.__bkFile)
    await waitText(page, '没有可恢复的新内容', 6000)
    fs.unlinkSync(globalThis.__bkFile)
    ck(true, '按 id 去重生效')
  })
})

test('行程段：手动新增 → 长辈端可见 → 删除 → 消失', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)
  await registerAccount(page, 'seg')

  // 先有一份行程（明天的高铁），再手动补一段今天的航班
  await page.goto(BASE + '/#/import')
  await page.locator('textarea').fill(`${cnDatePhrase(1)}早上G8201次从上海虹桥站到北京南站 09:30发车 13:45到`)
  await page.getByRole('button', { name: /解析行程/ }).click()
  await waitText(page, 'G8201')
  await page.getByRole('button', { name: /确认导入/ }).click()
  await page.waitForURL(/#\/trip\//, { timeout: 8000 })

  await t.test('手动添加一段航班并补齐信息', async () => {
    await page.getByRole('button', { name: /添加一段/ }).click()
    await page.getByRole('button', { name: '航班' }).click()
    await page.locator('input[id^=ed-code-]').fill('CA1234')
    await page.locator('input[id^=ed-from-]').fill('上海浦东机场')
    await page.locator('input[id^=ed-to-]').fill('北京首都机场')
    await page.locator('input[id^=ed-depart-]').fill('08:00')
    await page.locator('input[id^=ed-arrive-]').fill('10:30')
    await page.getByRole('button', { name: /保存本段/ }).click()
    await waitText(page, 'CA1234', 6000)
    ck(await page.locator('li.seg', { hasText: 'CA1234' }).count() === 1, '新增段出现在列表')
  })

  await t.test('分享后长辈端能看到新增段', async () => {
    await page.getByRole('button', { name: /分享给爸妈/ }).click()
    await page.waitForURL(/#\/share\//, { timeout: 8000 })
    await page.getByRole('button', { name: /生成分享链接/ }).click()
    await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
    const link = await page.locator('input[readonly]').first().inputValue()
    const p2 = await ctx.newPage()
    await p2.goto(link)
    await waitText(p2, 'CA1234', 8000)
    ck(true, '长辈端看到手动添加的段')
    await p2.close()
  })

  await t.test('删除该段（两步确认）', async () => {
    await page.goto(BASE + '/#/home')
    await page.getByRole('button', { name: /查看/ }).first().click()
    await page.waitForURL(/#\/trip\//, { timeout: 8000 })
    const segCard = page.locator('li.seg', { hasText: 'CA1234' })
    await segCard.getByRole('button', { name: /编辑/ }).click()
    await segCard.getByRole('button', { name: /删除本段/ }).click()
    await segCard.getByRole('button', { name: /确认删除/ }).click()
    await page.waitForTimeout(400)
    ck(await page.locator('li.seg', { hasText: 'CA1234' }).count() === 0, '段已删除')
  })

  await t.test('只剩一段时数据仍完好', async () => {
    ck(await page.locator('li.seg').count() === 1, '剩一段高铁')
    await waitText(page, 'G8201', 6000)
  })
})

test('最近账号：删除本机账号（删的是当前登录）', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)
  const acc = await registerAccount(page, 'acc')

  await t.test('列表标注当前登录', async () => {
    await page.goto(BASE + '/#/accounts')
    await waitText(page, '当前登录', 6000)
    await waitText(page, acc.name, 6000)
    ck(true, '当前账号已标注')
  })

  await t.test('删除 → 两步确认 → 退出回身份页', async () => {
    await page.getByRole('button', { name: '删除', exact: true }).first().click()
    await page.getByRole('button', { name: /确认删除/ }).click()
    await page.waitForURL(/#\/$|#$|\/#\/$/, { timeout: 8000 })
    await waitText(page, '我是爸妈', 6000)
    ck(true, '删完自动退出')
  })

  await t.test('账号列表已空', async () => {
    await page.goto(BASE + '/#/accounts')
    await waitText(page, '这台设备还没有账号', 6000)
    ck(true, '列表为空')
  })
})

test('家人电话：称呼按长辈视角 + 微信复制', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  await registerAccount(page, 'fam')

  let link = ''
  await t.test('子女端添加家人：称呼可自定义（儿子）+ 微信号 + 备注', async () => {
    await page.goto(BASE + '/#/family')
    await page.getByRole('button', { name: /添加家人/ }).first().click()
    await page.locator('#fam-name').fill('小明')
    await page.locator('#fam-relation').fill('儿子')
    await page.locator('#fam-phone').fill('13800001111')
    await page.locator('#fam-im').fill('son_wechat_1')
    await page.locator('#fam-note').fill('住得近，有事先打给他')
    await page.getByRole('button', { name: '保存' }).click()
    await waitText(page, '儿子', 6000)
    ck(await page.locator('.tag-brand', { hasText: '儿子' }).count() === 1, '称呼按填写的显示')

    await page.goto(BASE + '/#/import')
    await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G8801次从上海虹桥站到北京南站 08:00发车 11:00到`)
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'G8801')
    await page.getByRole('button', { name: /确认导入/ }).click()
    await page.waitForURL(/#\/trip\//, { timeout: 8000 })
    await page.getByRole('button', { name: /分享给爸妈/ }).click()
    await page.waitForURL(/#\/share\//, { timeout: 8000 })
    await page.getByRole('button', { name: /生成分享链接/ }).click()
    await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
    link = await page.locator('input[readonly]').first().inputValue()
    ck(link.includes('#/e/'), '拿到分享链接')
  })

  await t.test('长辈端「家人」面板：称呼在前、号码与备注都在，且能复制微信', async () => {
    const p2 = await ctx.newPage()
    await p2.goto(link)
    await waitText(p2, '今天')
    await p2.getByRole('button', { name: '家人电话', exact: true }).click()
    await waitText(p2, '儿子', 6000)
    await waitText(p2, '小明 · 13800001111 · 微信/QQ son_wechat_1', 6000)
    await waitText(p2, '住得近，有事先打给他', 6000)
    ck(await p2.locator('a[aria-label="拨打儿子的电话"]').count() === 1, '拨打链接带长辈视角称呼')
    // 滚动到家人列表再截图（底栏是 fixed，整页截图里会盖住内容）
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    await p2.locator('.contact-row').first().scrollIntoViewIfNeeded()
    await p2.screenshot({ path: path.join(SHOT_DIR, 'elder-family.png') })

    // 浏览器打不开微信，但可以把号复制好，长辈去微信里搜一下就能加人、打视频
    await p2.getByRole('button', { name: /复制儿子的微信号/ }).click()
    await waitText(p2, '打开微信', 6000)
    ck(true, '复制提示出现')
    await p2.close()
  })

  await t.test('旧的子女视角称呼：子女端提示，长辈端不显示', async () => {
    await page.goto(BASE + '/#/family')
    await page.getByRole('button', { name: '编辑' }).first().click()
    await page.locator('#fam-relation').fill('爸爸')
    await page.getByRole('button', { name: '保存' }).click()
    await waitText(page, '旧称呼：爸爸', 6000)

    await page.goto(BASE + '/#/home')
    await page.getByRole('button', { name: /分享/ }).first().click()
    await page.waitForURL(/#\/share\//, { timeout: 8000 })
    await page.getByRole('button', { name: /生成分享链接/ }).click()
    await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
    const link2 = await page.locator('input[readonly]').first().inputValue()

    const p3 = await ctx.newPage()
    await p3.goto(link2)
    await waitText(p3, '今天')
    await p3.getByRole('button', { name: '家人电话', exact: true }).click()
    await waitText(p3, '小明', 6000)
    ck(await p3.locator('text=爸爸').count() === 0, '长辈端不出现「爸爸」这种子女视角称呼')
    await p3.close()
  })
})