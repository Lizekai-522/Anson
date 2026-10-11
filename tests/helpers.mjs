// 测试基建：类型守卫 / PID 互斥锁 / APP_BASE / 动态日期 / 浏览器启动。
// 这些约束是踩坑换来的：
//  - ck() 类型守卫：typeof ok !== 'boolean' 直接抛错，防参数顺序写错导致断言恒真
//  - PID 互斥锁：防多个 run-all 抢 5190 端口
//  - APP_BASE：同一份用例能打本地也能打线上
//  - 动态日期：所有依赖「今天」的断言不许写死日期
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeShare, encodeTripInvite } from '../src/core/share-codec.js'
import { runPipeline } from '../src/core/agents.js'

// ---- 类型守卫 ----
export function ck(cond, msg) {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 只接受布尔断言，收到: ' + typeof cond + ' — ' + msg)
  assert.ok(cond, msg)
}

// ---- 基址 ----
export const BASE = (process.env.APP_BASE || 'http://localhost:5190').replace(/\/$/, '')

// ---- PID 互斥锁 ----
const HERE = path.dirname(fileURLToPath(import.meta.url))
const LOCK = path.join(HERE, '.lock')

export function acquireLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const pid = parseInt(fs.readFileSync(LOCK, 'utf8').trim(), 10)
      if (pid && processAlive(pid)) {
        console.error(`[lock] 另一个测试进程(PID ${pid})正在运行，先等它结束或删除 ${LOCK}`)
        process.exit(2)
      }
    }
  } catch {}
  fs.writeFileSync(LOCK, String(process.pid))
}

export function releaseLock() {
  try {
    if (fs.existsSync(LOCK) && fs.readFileSync(LOCK, 'utf8').trim() === String(process.pid)) fs.unlinkSync(LOCK)
  } catch {}
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

// ---- 动态日期（绝不写死） ----
export function todayStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function cnDatePhrase(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getMonth() + 1}月${d.getDate()}号`
}

// ---- 浏览器 ----
export async function launchBrowser() {
  const { chromium } = await import('playwright')
  return chromium.launch({ args: ['--no-sandbox'] })
}

export async function freshPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  return { ctx, page }
}

// 等待 SPA 渲染出文本
export async function waitText(page, text, timeout = 8000) {
  await page.locator(`text=${text}`).first().waitFor({ state: 'visible', timeout })
}

// 注册一个唯一账号并保持登录态，返回 { name, email, phone, password }
export async function registerAccount(page, tag = 'u') {
  const uniq = Date.now().toString(36) + Math.floor(Math.random() * 1e4)
  const acc = {
    name: `${tag}${uniq}`.slice(0, 20),
    email: `${tag}${uniq}@test.local`,
    phone: '1' + String(30000000000n + (BigInt(Date.now()) % 6000000000n)).slice(0, 10),
    password: 'Passw0rd' + uniq.slice(-4),
  }
  await page.goto(BASE + '/#/register')
  await page.locator('input').nth(0).fill(acc.name)
  await page.locator('input').nth(1).fill(acc.email)
  await page.locator('input').nth(2).fill(acc.phone)
  await page.locator('input[type=password]').nth(0).fill(acc.password)
  await page.locator('input[type=password]').nth(1).fill(acc.password)
  await page.getByRole('button', { name: /注册/ }).first().click()
  await page.waitForURL(/#\/home/, { timeout: 8000 })
  return acc
}

// ---- 分享 token 构造 ----
// e2e 里要构造「很长的站名」「30 分钟后出发」这类边界数据，走导入 UI 很难精确控制，
// 所以直接用编码器造一条自包含链接（和线上生成的是同一套码）。
export function makeRideCard(over = {}) {
  return {
    kind: 'ride', type: 'train', icon: '车', code: 'G8001', title: '高铁',
    from: '上海虹桥站', to: '北京南站', date: todayStr(0), depart: '08:00', arrive: '11:00',
    arriveNextDay: false, manualConfirm: false, note: '', hotelNights: null, seatClass: null,
    timeOfDay: '', todos: [], guide: '', weather: '', voice: '', tips: [], segId: 'seg0', ...over,
  }
}

// 游玩 / 安排卡：正文是「时段 + 地点 + 说明」，还可带「到了之后做什么」清单
export function makePlayCard(over = {}) {
  return {
    kind: 'play', type: 'activity', icon: '玩', code: '', title: '下午 城东公园',
    from: '', to: '城东公园', date: todayStr(0), depart: '', arrive: '',
    arriveNextDay: false, manualConfirm: false, note: '一路都是小吃摊',
    hotelNights: null, seatClass: null, timeOfDay: '下午',
    todos: [
      { text: '买瓶水', level: 'high' },
      { text: '拍张合影', level: 'normal' },
      { text: '找地方歇脚', level: 'low' },
    ],
    guide: '', weather: '',
    voice: '这一段是安排：下午去城东公园。', tips: [], segId: 'segP', ...over,
  }
}

export function buildElderToken({ cards, title = '测试行程', prefs = { scale: 1, theme: 'day', shareLocation: false }, contacts, pr } = {}) {
  return encodeShare({
    v: 1, eid: 'e2e', cid: 'card', title, gen: Date.now(),
    exp: Date.now() + 7 * 86400000, cards: cards || [], contacts: contacts || [], pr, prefs,
  })
}

// 紧急求助用：一个「有首选家人」的长辈 token（阿明是首选）
export function buildSosToken({ cards, title = '赶车', pr = 0 } = {}) {
  return buildElderToken({
    cards,
    title,
    pr,
    contacts: [
      { name: '阿明', relation: '儿子', phone: '13800001111', callsMe: '妈' },
      { name: '阿芳', relation: '女儿', phone: '13900002222', callsMe: '爸' },
    ],
  })
}

// 子女邀请链接（v3）：优先用给好的 segments，否则按 raw 跑一遍解析
export function buildInviteToken({ title = '家人行程', raw = '', segments = null, exp = 0 } = {}) {
  const segs = segments || (raw ? runPipeline(raw, {}).segments : [])
  const startDate = segs.map((s) => s.date).filter(Boolean).sort()[0] || ''
  return encodeTripInvite({
    eid: 'e2e-inv', gen: 1700000000000, title, startDate,
    exp: exp || (Date.now() + 7 * 86400000),
    segments: segs,
  })
}

// 出发时刻落在 [现在+30 分钟, 当天 23:59]：既能让提醒弹窗出现，又保证日期还是今天
export function soonDepart() {
  const now = new Date()
  let dep = new Date(now.getTime() + 30 * 60000)
  const eod = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0)
  if (dep > eod) dep = eod
  const p = (n) => String(n).padStart(2, '0')
  return {
    date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    time: `${p(dep.getHours())}:${p(dep.getMinutes())}`,
  }
}

// 出发时刻落在 [现在+2 小时, 当天 23:59]：给「离 HH:MM 出发还有……」这类绝对时间断言用
export function hoursAheadDepart(hours = 2) {
  const now = new Date()
  let dep = new Date(now.getTime() + hours * 3600000)
  const eod = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0)
  if (dep > eod) dep = eod
  const p = (n) => String(n).padStart(2, '0')
  return {
    date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
    time: `${p(dep.getHours())}:${p(dep.getMinutes())}`,
  }
}

// 昨天的某个时刻：给平安到达（早就该到、一直没确认）用。
// 固定用昨天，避免「现在-90 分钟」跨零点时把出发/到达顺序弄反。
export function yesterdayAt(time = '10:00') {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const p = (n) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    datePhrase: `${d.getMonth() + 1}月${d.getDate()}号`,
    time,
  }
}
