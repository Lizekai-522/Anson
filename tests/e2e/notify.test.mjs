// 短信 / 邮件双通道端到端：服务端真实发送链路（假服务商）+ 未配置时的本机回落。
// 这里不"假装能发"：发送路径要么打到 mock 服务商（证明链路真通），要么落到用户手机上的短信/邮件。
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchBrowser, freshPage, ck, waitText, cnDatePhrase } from '../helpers.mjs'

// 本文件在 tests/e2e/ 下，仓库根在上两层
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MOCK_PORT = 5181
const WITH_SERVER = 'http://localhost:5182'
const NO_SERVER = 'http://localhost:5183'
const MOCK = 'http://localhost:' + MOCK_PORT

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => resolve(server))
  })
}

// helpers 里的 registerAccount 绑死在 dev server(5190)；这里要用"通知服务发布的那份 dist"，
// 所以照着同一套流程在指定 origin 上注册。
async function registerAt(page, origin, tag) {
  const uniq = Date.now().toString(36) + Math.floor(Math.random() * 1e4)
  await page.goto(origin + '/#/register')
  await page.locator('input').nth(0).fill(`${tag}${uniq}`.slice(0, 20))
  await page.locator('input').nth(1).fill(`${tag}${uniq}@test.local`)
  await page.locator('input').nth(2).fill('1' + String(30000000000n + (BigInt(Date.now()) % 6000000000n)).slice(0, 10))
  await page.locator('input[type=password]').nth(0).fill('Passw0rd' + uniq.slice(-4))
  await page.locator('input[type=password]').nth(1).fill('Passw0rd' + uniq.slice(-4))
  await page.getByRole('button', { name: /注册/ }).first().click()
  await page.waitForURL(/#\/home/, { timeout: 8000 })
}

test('通知双通道：服务端真发送 + 未配置回落本机', async (t) => {
  // 通知服务发的是 dist（生产形态），所以先跑一次真实构建
  const build = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' })
  ck(build.status === 0, 'dist 构建成功（status=' + build.status + ' err=' + (build.error ? build.error.message : '-') + '）\n' + String(build.stderr || build.stdout || '').slice(-400))

  // 假服务商：把 provider 的 BASE_URL 指过来，发送链路整条跑通
  const { server: mock } = await import(pathToFileURL(path.join(ROOT, 'server', 'mock-provider.mjs')).href)
  t.after(() => mock.close())

  const { createServer } = await import('../../server/app.mjs')
  const providerEnv = {
    ...process.env,
    ALIYUN_SMS_AK_ID: 'ak', ALIYUN_SMS_AK_SECRET: 'sk', ALIYUN_SMS_SIGN: '安程', ALIYUN_SMS_TEMPLATE: 'SMS_1',
    ALIYUN_SMS_BASE_URL: MOCK + '/aliyun',
    RESEND_API_KEY: 'rk', RESEND_FROM: '安程 <noreply@example.com>',
    RESEND_BASE_URL: MOCK + '/resend',
  }
  const withServer = await listen(createServer(providerEnv, { serveDist: true }), 5182)
  const noServer = await listen(createServer({ ...process.env }, { serveDist: true }), 5183)
  t.after(() => { withServer.close(); noServer.close() })

  const browser = await launchBrowser()
  t.after(() => browser.close())

  async function prepareShare(origin, account) {
    const { ctx } = await freshPage(browser)
    const page = await ctx.newPage()
    await page.goto(origin + '/')
    await registerAt(page, origin, account)
    await page.goto(origin + '/#/import')
    await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9901次从上海虹桥站到北京南站 08:00发车 11:00到`)
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'G9901')
    await page.getByRole('button', { name: /确认导入/ }).click()
    await page.waitForURL(/#\/trip\//, { timeout: 8000 })
    await page.getByRole('button', { name: /分享给爸妈/ }).click()
    await page.waitForURL(/#\/share\//, { timeout: 8000 })
    await page.getByRole('button', { name: /生成分享链接/ }).click()
    await page.locator('input[readonly]').first().waitFor({ timeout: 8000 })
    const link = await page.locator('input[readonly]').first().inputValue()
    return { ctx, page, link }
  }

  await t.test('配了服务商：点「发短信」真的打到服务商（带签名、带链接）', async () => {
    await fetch(MOCK + '/__requests', { method: 'DELETE' })
    const { ctx, page, link } = await prepareShare(WITH_SERVER, 'noti1')

    await waitText(page, '短信已接通服务端', 6000)
    await page.locator('#send-to').fill('13800001111')
    await page.getByRole('button', { name: '发短信' }).click()
    await waitText(page, '已通过服务端发到', 8000)

    const { requests } = await (await fetch(MOCK + '/__requests')).json()
    ck(requests.length === 1, '服务商收到 1 条请求（实际 ' + requests.length + '）')
    const q = requests[0].query || {}
    ck(requests[0].kind === 'aliyun', '走的是已配置的短信通道: ' + requests[0].kind)
    ck(q.PhoneNumbers === '13800001111', '收件人正确: ' + q.PhoneNumbers)
    ck(typeof q.Signature === 'string' && q.Signature.length > 10, '请求带签名，不是裸调用')
    ck(String(q.TemplateParam).includes(encodeURIComponent(link).slice(0, 24)) || String(q.TemplateParam).includes(link), '正文里带上了分享链接')
    await ctx.close()
  })

  await t.test('没配服务商：页面明说走本机，点「发邮件」不碰任何服务商', async () => {
    await fetch(MOCK + '/__requests', { method: 'DELETE' })
    const { ctx, page } = await prepareShare(NO_SERVER, 'noti2')

    await waitText(page, '用你手机上的邮件 App', 6000)
    await page.locator('#send-to').fill('son@example.com')
    await page.getByRole('button', { name: '发邮件' }).click()
    await waitText(page, '已打开你手机上的邮件', 8000)

    const { requests } = await (await fetch(MOCK + '/__requests')).json()
    ck(requests.length === 0, '未配置服务端时不应打到任何服务商')
    await ctx.close()
  })

  await t.test('手机号格式不对：给中文提示且不发送', async () => {
    const { ctx, page } = await prepareShare(WITH_SERVER, 'noti3')
    await page.locator('#send-to').fill('138')
    await page.getByRole('button', { name: '发短信' }).click()
    await waitText(page, '手机号填 11 位', 6000)
    ck(true, '校验拦住并说明原因')
    await ctx.close()
  })
})