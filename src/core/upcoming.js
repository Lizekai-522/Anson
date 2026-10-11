// 出发提醒：纯函数，方便单测，也方便长辈端（弹窗 + 倒计时条）复用同一份判断。
//
// 规则（写死，不留选择）：
//   - 只对「不是住宿」且日期是今天、且有出发时刻的卡片生效
//   - 出发前 60 分钟内首次提醒（stage = 'lead'）
//   - 出发前 20 分钟内再提醒一次（stage = 'second'）
//   - 已经过了出发时间 5 分钟以上就不再提醒（别让长辈打开页面被一堆过期弹窗淹没）
//   - 同一个 stage 点过「知道了」就不再弹（记账键 segId:stage，交给 elderState.js 存）

export const LEAD_MIN = 60
export const SECOND_MIN = 20
export const GRACE_MIN = 5
// 平安到达：过了预计到达时刻这么久还没勾「走完」，就该提醒子女打个电话
export const ARRIVE_GRACE_MIN = 60

function pad2(n) { return String(n).padStart(2, '0') }

function addDaysISO(s, n) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)
  return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate())
}

// 本地时区 'YYYY-MM-DD'
export function localDate(now = new Date()) {
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate())
}

// 'YYYY-MM-DD' + 'HH:MM' → 本地 Date。缺值/越界/会被 Date 静默滚动的写法一律 null。
function parseAt(dateStr, timeStr) {
  const dm = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const tm = String(timeStr || '').match(/^(\d{1,2}):(\d{2})/)
  if (!dm || !tm) return null
  const y = Number(dm[1]), mo = Number(dm[2]), d = Number(dm[3])
  const hh = Number(tm[1]), mi = Number(tm[2])
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59) return null
  const dt = new Date(y, mo - 1, d, hh, mi, 0, 0)
  // 反查一遍：挡掉 2 月 30 日这种会被 Date 静默滚到下个月的写法
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dt
}

// 卡片的出发时刻 → Date（本地时区）。缺日期/缺时刻/格式不对一律返回 null。
export function parseDepartAt(card) {
  if (!card) return null
  return parseAt(card.date, card.depart)
}

// 卡片的到达时刻 → Date；跨天到达要把日期 +1（sanityCheck 已写好 arriveNextDay）
export function parseArriveAt(card) {
  if (!card) return null
  const date = card.arriveNextDay && card.date ? addDaysISO(card.date, 1) : card.date
  return parseAt(date, card.arrive)
}

export function minutesUntil(departAt, now) {
  return Math.round((departAt.getTime() - now.getTime()) / 60000)
}

// 今天还没出发的那些段，按「离出发还有多久」升序
export function futureList(cards, now = new Date()) {
  const today = localDate(now)
  const out = []
  ;(cards || []).forEach((c, i) => {
    if (!c || c.kind === 'stay' || c.manualConfirm) return
    if (c.date !== today) return
    const at = parseDepartAt(c)
    if (!at) return
    const left = minutesUntil(at, now)
    if (left < 0) return
    out.push({ segId: keyOf(c, i), card: c, departAt: at, minutesLeft: left })
  })
  out.sort((a, b) => a.minutesLeft - b.minutesLeft)
  return out
}

// 倒计时条用：今天还没出发的最近一段
export function nextUpcoming(cards, now = new Date()) {
  return futureList(cards, now)[0] || null
}

export function countdownText(minutesLeft) {
  const m = Math.round(minutesLeft)
  if (m <= 0) return '该出发了'
  return '还有 ' + durationText(m)
}

// 时长说法（不带「还有」前缀），供「离 09:35 出发还有 …」这类绝对时间句式复用
export function durationText(minutesLeft) {
  const m = Math.round(minutesLeft)
  if (m < 1) return '不到 1 分钟'
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} 小时 ${rest} 分钟` : `${h} 小时`
}

// 页头常驻的「离 09:35 出发还有 2 小时 15 分」——绝对时刻，长辈不用心算
export function nextDepartText(cards, now = new Date()) {
  const n = nextUpcoming(cards, now)
  if (!n) return ''
  const m = String((n.card && n.card.depart) || '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return '下一段：' + countdownText(n.minutesLeft)
  const hm = pad2(Number(m[1])) + ':' + m[2]
  if (n.minutesLeft <= 0) return `到 ${hm} 了，该出发了`
  return `离 ${hm} 出发还有 ${durationText(n.minutesLeft)}`
}

// 平安到达检查点：已经过了预计到达时刻 + graceMin，而且还没被标成「走完」的段
// doneMap 是长辈端的完成表（按 segId 记账）。返回按逾期时长降序。
export function arrivalCheckpoints(cards, doneMap, now = new Date(), { graceMin = ARRIVE_GRACE_MIN } = {}) {
  const out = []
  ;(cards || []).forEach((c, i) => {
    if (!c || c.kind === 'stay' || c.manualConfirm) return
    if (!c.arrive) return
    const at = parseArriveAt(c)
    if (!at) return
    // 逾期分钟数 = 现在 - 到达时刻（正数才是「已经过点」）
    const overdue = minutesUntil(now, at)
    if (overdue < graceMin) return
    const k = c.segId != null && c.segId !== '' ? String(c.segId) : 'i' + i
    if (doneMap && doneMap[k]) return
    out.push({ segId: k, card: c, arriveAt: at, overdueMin: overdue })
  })
  out.sort((a, b) => b.overdueMin - a.overdueMin)
  return out
}

// 下一个「还没到、也还没被标走完」的到达点（给服务端做超时比对用）
export function nextArrivalCheckpoint(cards, doneMap, now = new Date()) {
  let best = null
  ;(cards || []).forEach((c, i) => {
    if (!c || c.kind === 'stay' || c.manualConfirm || !c.arrive) return
    const at = parseArriveAt(c)
    if (!at || at.getTime() <= now.getTime()) return
    const k = c.segId != null && c.segId !== '' ? String(c.segId) : 'i' + i
    if (doneMap && doneMap[k]) return
    if (!best || at < best.arriveAt) best = { segId: k, card: c, arriveAt: at }
  })
  return best
}

// 「接下来」引导：第一个还没走完的段下标（找不到返回 -1）
export function firstPendingIndex(cards, doneMap) {
  const list = cards || []
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (!c) continue
    const k = c.segId != null && c.segId !== '' ? String(c.segId) : 'i' + i
    if (!(doneMap && doneMap[k])) return i
  }
  return -1
}

// 勾完某一段之后，接下来该看哪一段：从 fromIndex+1 起第一个没走完的
export function nextPendingAfter(cards, doneMap, fromIndex) {
  const list = cards || []
  for (let i = fromIndex + 1; i < list.length; i++) {
    const c = list[i]
    if (!c) continue
    const k = c.segId != null && c.segId !== '' ? String(c.segId) : 'i' + i
    if (!(doneMap && doneMap[k])) return i
  }
  return -1
}

// 该弹窗的那些段：落在 [出发前 60 分钟, 出发后 5 分钟] 区间内，按紧急度升序
export function upcomingList(cards, now = new Date(), { leadMin = LEAD_MIN, secondMin = SECOND_MIN, graceMin = GRACE_MIN } = {}) {
  const today = localDate(now)
  const out = []
  ;(cards || []).forEach((c, i) => {
    if (!c || c.kind === 'stay' || c.manualConfirm) return
    if (c.date !== today) return
    const at = parseDepartAt(c)
    if (!at) return
    const left = minutesUntil(at, now)
    if (left > leadMin || left < -graceMin) return
    const stage = left <= secondMin ? 'second' : 'lead'
    out.push({ segId: keyOf(c, i), card: c, departAt: at, minutesLeft: left, stage })
  })
  out.sort((a, b) => a.minutesLeft - b.minutesLeft)
  return out
}

// 这个 stage 是否还没被点掉
export function shouldRemind(state, item, now = new Date()) {
  if (!item || !item.segId) return false
  const d = (state && state.dismissed) || {}
  return !d[item.segId + ':' + item.stage]
}

// 弹窗要展示的标题：`G7102 北京南 → 上海虹桥`
export function noticeTitle(item) {
  const c = (item && item.card) || {}
  const head = c.code ? c.code + ' ' : ''
  if (c.kind === 'stay') return head + (c.to || '住宿')
  return head + (c.from || '') + ' → ' + (c.to || '')
}

// 与 elder-shared.cardKey 保持同一套规则：有 segId 用 segId，没有就退回下标
function keyOf(c, i) {
  return c && c.segId != null && c.segId !== '' ? String(c.segId) : 'i' + i
}