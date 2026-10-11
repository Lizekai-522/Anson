// 出发提醒纯函数：解析出发时刻 / 今天待出发排序 / 两档提醒分级 / 去重与过期不弹。
// 纯函数，显式传 now，保证任何时区跑都一致。
import test from 'node:test'
import assert from 'node:assert/strict'

const {
  parseDepartAt, parseArriveAt, minutesUntil, futureList, nextUpcoming, upcomingList,
  countdownText, durationText, nextDepartText, arrivalCheckpoints, nextArrivalCheckpoint,
  firstPendingIndex, nextPendingAfter, shouldRemind, noticeTitle, localDate, ARRIVE_GRACE_MIN,
} = await import('../../src/core/upcoming.js')

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

// 本地时区的固定"现在"：2026-05-20 07:30
const NOW = new Date(2026, 4, 20, 7, 30, 0)
function card(over = {}) {
  return { kind: 'ride', date: '2026-05-20', depart: '08:00', arrive: '11:00', code: 'G1', from: 'A站', to: 'B站', segId: 's1', ...over }
}

test('parseDepartAt：正常写法换算成本地时刻', () => {
  const d = parseDepartAt({ date: '2026-05-20', depart: '08:00' })
  ok(d instanceof Date, '返回 Date')
  ok(d.getFullYear() === 2026 && d.getMonth() === 4 && d.getDate() === 20 && d.getHours() === 8 && d.getMinutes() === 0, '逐字段对上: ' + d)
  ok(parseDepartAt({ date: '2026-05-20', depart: '8:05' }) !== null, '单位数小时也能解析')
})

test('parseDepartAt：缺时间 / 缺日期 / 非法日期 / 格式不对都返回 null', () => {
  ok(parseDepartAt(null) === null, 'null')
  ok(parseDepartAt({ date: '2026-05-20' }) === null, '缺出发时刻')
  ok(parseDepartAt({ depart: '08:00' }) === null, '缺日期')
  ok(parseDepartAt({ date: '2026-02-30', depart: '08:00' }) === null, '2 月 30 日不该被静默滚动')
  ok(parseDepartAt({ date: '2026/05/20', depart: '08:00' }) === null, '斜杠日期不认')
  ok(parseDepartAt({ date: '2026-05-20', depart: '25:00' }) === null, '非法小时')
})

test('futureList：只收今天、非住宿、还没出发的段，并按剩余时间升序', () => {
  const cards = [
    card({ segId: 'late', depart: '09:00' }),
    card({ segId: 'soon', depart: '07:40' }),
    card({ segId: 'stay', kind: 'stay', depart: '' }),
    card({ segId: 'past', depart: '07:00' }),
    card({ segId: 'tmr', date: '2026-05-21', depart: '08:00' }),
  ]
  const list = futureList(cards, NOW)
  ok(list.length === 2, '只留两段: ' + list.map((x) => x.segId).join(','))
  ok(list[0].segId === 'soon' && list[1].segId === 'late', '升序排列')
  ok(list[0].minutesLeft === 10, 'soon 还有 10 分钟: ' + list[0].minutesLeft)
  ok(nextUpcoming(cards, NOW).segId === 'soon', 'nextUpcoming 取最近一段')
  ok(nextUpcoming([], NOW) === null, '空列表返回 null')
})

test('upcomingList：出发前 60 分钟进 lead，20 分钟进 second，过期超 5 分钟不进', () => {
  const cards = [
    card({ segId: 'lead', depart: '08:20' }),   // 还有 50 分钟 → lead
    card({ segId: 'second', depart: '07:45' }), // 还有 15 分钟 → second
    card({ segId: 'grace', depart: '07:26' }),  // 已过 4 分钟 → 仍在 grace 内
    card({ segId: 'tooOld', depart: '07:00' }), // 已过 30 分钟 → 不弹
    card({ segId: 'far', depart: '10:00' }),    // 还有 150 分钟 → 不弹
  ]
  const list = upcomingList(cards, NOW)
  const ids = list.map((x) => x.segId)
  ok(ids.includes('lead') && ids.includes('second') && ids.includes('grace'), '三个入选: ' + ids.join(','))
  ok(ids.length === 3, '只该有三个: ' + ids.join(','))
  ok(!ids.includes('tooOld'), '过期太久不入选')
  ok(!ids.includes('far'), '离得还远不入选')
  ok(list.find((x) => x.segId === 'lead').stage === 'lead', 'lead 分级')
  ok(list.find((x) => x.segId === 'second').stage === 'second', 'second 分级')
  ok(list[0].minutesLeft <= list[list.length - 1].minutesLeft, '按紧急度升序')
})

test('countdownText：三档说法都通顺', () => {
  ok(countdownText(-1) === '该出发了', '已到点')
  ok(countdownText(0) === '该出发了', '0 分钟')
  ok(countdownText(12) === '还有 12 分钟', '不足一小时')
  ok(countdownText(60) === '还有 1 小时', '整点小时')
  ok(countdownText(65) === '还有 1 小时 5 分钟', '小时 + 分钟')
})

test('shouldRemind：同一 segId+stage 点过就不再弹，另一档仍可弹', () => {
  const item = { segId: 's1', stage: 'lead' }
  ok(shouldRemind({ dismissed: {} }, item) === true, '没记过 → 弹')
  ok(shouldRemind({ dismissed: { 's1:lead': 1 } }, item) === false, 'lead 记过 → 不弹')
  ok(shouldRemind({ dismissed: { 's1:second': 1 } }, item) === true, '只记了 second，lead 仍弹')
  ok(shouldRemind({}, null) === false, '空 item 不弹')
})

test('noticeTitle：车次 + 出发地 → 到达地', () => {
  ok(noticeTitle({ card: card() }) === 'G1 A站 → B站', '普通行程: ' + noticeTitle({ card: card() }))
  ok(noticeTitle({ card: { kind: 'stay', to: '如家酒店' } }) === '如家酒店', '住宿段: ' + noticeTitle({ card: { kind: 'stay', to: '如家酒店' } }))
  ok(noticeTitle({ card: { kind: 'stay', code: 'H1', to: '如家酒店' } }) === 'H1 如家酒店', '住宿段带编号')
})

test('localDate：本地时区 YYYY-MM-DD', () => {
  ok(localDate(NOW) === '2026-05-20', '格式正确: ' + localDate(NOW))
  ok(minutesUntil(new Date(2026, 4, 20, 8, 30), NOW) === 60, 'minutesUntil 60')
})

// ---- 第六轮：绝对时刻倒计时 / 平安到达 / 接下来引导 ----

test('parseArriveAt：跨天到达要把日期 +1；缺时刻返回 null', () => {
  const a = parseArriveAt({ date: '2026-05-20', arrive: '06:30', arriveNextDay: true })
  ok(a instanceof Date && a.getDate() === 21 && a.getHours() === 6, '次日到达: ' + a)
  const b = parseArriveAt({ date: '2026-05-20', arrive: '06:30', arriveNextDay: false })
  ok(b.getDate() === 20, '当天到达不 +1')
  ok(parseArriveAt({ date: '2026-05-20' }) === null, '缺到达时刻')
})

test('durationText：不带「还有」前缀，供绝对时刻句式复用', () => {
  ok(durationText(12) === '12 分钟', '分钟')
  ok(durationText(60) === '1 小时', '整小时')
  ok(durationText(135) === '2 小时 15 分钟', '小时 + 分钟')
  ok(durationText(0) === '不到 1 分钟', '归零')
})

test('nextDepartText：绝对时刻 + 相对剩余，「离 08:00 出发还有 30 分钟」', () => {
  const cards = [card({ segId: 'a', depart: '08:00' }), card({ segId: 'b', depart: '09:30' })]
  ok(nextDepartText(cards, NOW) === '离 08:00 出发还有 30 分钟', nextDepartText(cards, NOW))
  ok(nextDepartText([], NOW) === '', '没有待出发的段返回空串')
  // 没有时刻的卡片退化成相对说法
  const noTime = [card({ segId: 'x', depart: '', arrive: '' })]
  ok(nextDepartText(noTime, NOW) === '', '没有出发时刻就不显示倒计时')
})

test('arrivalCheckpoints：过点超时且没勾完成才提醒；勾了就撤', () => {
  // NOW = 07:30。a 还没到点；fresh 只过了 15 分钟（不到宽限期）；over 过了 2.5 小时
  const cards = [
    card({ segId: 'a', depart: '07:00', arrive: '09:12' }),
    card({ segId: 'fresh', depart: '06:50', arrive: '07:15' }),
    card({ segId: 'over', depart: '03:00', arrive: '05:00' }),
    card({ segId: 'stay', kind: 'stay', arrive: '' }),
  ]
  const list = arrivalCheckpoints(cards, {}, NOW)
  ok(list.length === 1 && list[0].segId === 'over', '只提醒真的超时的那一段: ' + list.map((x) => x.segId).join(','))
  ok(list[0].overdueMin === 150, '逾期分钟数: ' + list[0].overdueMin)
  ok(arrivalCheckpoints(cards, { over: Date.now() }, NOW).length === 0, '勾了「走完」就不再提醒')
  // 宽限期边界：07:15 到达的段，08:14 只有 59 分钟（不算），08:20 是 65 分钟（算）
  ok(arrivalCheckpoints(cards, {}, new Date(2026, 4, 20, 8, 14, 0)).every((x) => x.segId !== 'fresh'), '59 分钟还不算超时')
  ok(arrivalCheckpoints(cards, {}, new Date(2026, 4, 20, 8, 20, 0)).some((x) => x.segId === 'fresh'), '65 分钟算超时')
  ok(ARRIVE_GRACE_MIN === 60, '宽限期 1 小时')
})

test('nextArrivalCheckpoint：只挑还没到点、也没走完的最近一个', () => {
  const cards = [
    card({ segId: 'a', arrive: '09:12' }),
    card({ segId: 'b', arrive: '11:00' }),
  ]
  const n = nextArrivalCheckpoint(cards, {}, NOW)
  ok(n && n.segId === 'a', '取最近的: ' + (n && n.segId))
  ok(nextArrivalCheckpoint(cards, { a: 1 }, NOW).segId === 'b', '走完的跳过')
  ok(nextArrivalCheckpoint([], {}, NOW) === null, '没有返回 null')
})

test('firstPendingIndex / nextPendingAfter：勾完自动指向下一段', () => {
  const cards = [card({ segId: 'a' }), card({ segId: 'b' }), card({ segId: 'c' })]
  ok(firstPendingIndex(cards, {}) === 0, '第一个未完成')
  ok(nextPendingAfter(cards, { a: 1 }, 0) === 1, '勾完 a → b')
  ok(nextPendingAfter(cards, { a: 1, b: 1 }, 1) === 2, '再勾 b → c')
  ok(nextPendingAfter(cards, { a: 1, b: 1, c: 1 }, 2) === -1, '全走完 → -1')
  ok(nextPendingAfter([], {}, -1) === -1, '空列表 -1')
})