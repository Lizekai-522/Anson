// 自定义模型配置 + AI 入口的走查。
// 全程不发真实网络请求：只验证「配置页能填能存」「配置存哪」「AI 按钮的可用提示随配置变化」。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText } from '../helpers.mjs'

const SAMPLE = '10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到\n住一晚 如家酒店(北京南站店)\n第二天高铁 G104 上海虹桥 -> 杭州东'
const MODEL_KEY = 'ptb:model'

// 写一份"已配置"的模型配置（设备级 localStorage），用于验证按钮提示切换
const FAKE_CFG = {
  presetId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test-not-real',
  model: 'deepseek-chat',
  vision: false,
  temperature: 0.2,
  useProxy: false,
  timeoutMs: 30000,
}

test('模型配置 + AI 入口', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)

  const acc = await registerAccount(page, 'mdl')

  await t.test('「我的」页有模型配置入口', async () => {
    await page.goto(BASE + '/#/profile')
    await waitText(page, '模型配置')
    await waitText(page, acc.name)
    const link = page.locator('a[href="#/model"]').first()
    ck(await link.count() > 0, '存在去设置入口')
    await link.click()
    await page.waitForURL(/#\/model/, { timeout: 8000 })
    ck(true, '跳到了模型配置页')
  })

  await t.test('模型配置页渲染必备字段', async () => {
    await waitText(page, '自定义模型')
    await page.locator('#base-url').waitFor({ state: 'visible', timeout: 8000 })
    ck(await page.locator('#api-key').count() === 1, 'API Key 字段存在')
    ck(await page.locator('#model-name').count() === 1, '模型名称字段存在')
    ck(await page.getByRole('button', { name: '测试连接' }).count() === 1, '测试连接按钮存在')
    ck(await page.getByRole('button', { name: '保存' }).count() === 1, '保存按钮存在')
    ck(await page.getByRole('button', { name: '清除' }).count() === 1, '清除按钮存在')
  })

  await t.test('选预设自动填地址与模型名 → 保存落到本机', async () => {
    await page.locator('#preset').selectOption('deepseek')
    ck((await page.locator('#base-url').inputValue()).includes('deepseek.com'), '预设填了 baseUrl')
    ck((await page.locator('#model-name').inputValue()).length > 0, '预设填了模型名')
    await page.locator('#api-key').fill('sk-test-not-real')
    await page.getByRole('button', { name: '保存' }).click()
    await waitText(page, '模型配置已保存')
    const saved = await page.evaluate((k) => localStorage.getItem(k), MODEL_KEY)
    ck(!!saved, 'localStorage 写入了配置')
    const obj = JSON.parse(saved)
    ck(obj.baseUrl.includes('deepseek.com') && obj.model.length > 0, '存了 baseUrl 与模型名')
    ck(obj.apiKey === 'sk-test-not-real', '存了 API Key')
  })

  await t.test('刷新后配置仍在（表单回填）', async () => {
    await page.reload()
    await page.locator('#base-url').waitFor({ state: 'visible', timeout: 8000 })
    ck((await page.locator('#base-url').inputValue()).includes('deepseek.com'), 'baseUrl 回填')
    ck((await page.locator('#model-name').inputValue()).length > 0, '模型名回填')
  })

  await t.test('导入页：未配置时提示去配置', async () => {
    await page.evaluate((k) => localStorage.removeItem(k), MODEL_KEY)
    await page.goto(BASE + '/#/import')
    await page.locator('textarea').fill(SAMPLE)
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'AI 一键补全')
    await waitText(page, '未配置模型')
    ck(true, '未配置时给出配置指引')
  })

  await t.test('导入页：配置后提示换成「用你自己的模型」', async () => {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [MODEL_KEY, JSON.stringify(FAKE_CFG)])
    await page.reload()
    await page.locator('textarea').fill(SAMPLE)
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'AI 一键补全')
    await waitText(page, '用你自己的模型补齐')
    ck(true, '配置后按钮提示切换')
  })

  await t.test('截图识字入口存在（vision 未开时给提示）', async () => {
    await waitText(page, '传一张车票截图识字')
    await waitText(page, '当前模型没开「支持图片」')
    ck(true, 'vision 未开有提示文案')
  })

  await t.test('行程页：导出日历 / 长图 / 行前提醒都在', async () => {
    await page.getByRole('button', { name: /确认导入/ }).click()
    await page.waitForURL(/#\/trip\//, { timeout: 8000 })
    await waitText(page, 'G7102')
    await waitText(page, '导出日历')
    await waitText(page, '导出长图')
    await waitText(page, '行前提醒')
    ck(true, '行程页动作与清单渲染')
  })
})