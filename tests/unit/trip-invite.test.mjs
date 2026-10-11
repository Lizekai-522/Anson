// 子女之间分享行程：自包含「邀请包」（v3）的编码 / 解码 / 篡改 / 过期 / 段重建。
// 与长辈链接共用校验和，但形状不同 —— 两边互不串味（decodeShare 拒收 v3，见 codec-v2）。
import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.location = { origin: 'https://example.com', pathname: '/' }

const { runPipeline, buildInviteTrip } = await import('../../src/core/agents.js')
const {
  encodeTripInvite, decodeTripInvite, makeInviteCode, extractToken, buildInviteUrl,
} = await import('../../src/core/share-codec.js')

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

const TODAY = '2026-03-15'

function tripOf() {
  const raw = [
    '10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到',
    '下午去城东公园逛逛',
    '10月9号 住两晚 城中酒店',
  ].join('\n')
  return runPipeline(raw, { today: TODAY })
}

function payloadOf(exp = Date.now() + 7 * 86400000) {
  const trip = tripOf()
  return { eid: 'inv_test', gen: 1700000000000, title: trip.title, startDate: trip.startDate, exp, segments: trip.segments }
}

test('往返：标题 / 起始日 / 段数与类型都还原', () => {
  const res = decodeTripInvite(encodeTripInvite(payloadOf()), { today: TODAY })
  ok(res.ok === true, '能解: ' + JSON.stringify(res.reason || ''))
  const p = res.payload
  ok(p.segments.length === 3, '三段: ' + p.segments.length)
  ok(p.segments.map((s) => s.type).join(',') === 'train,activity,hotel', '类型顺序: ' + p.segments.map((s) => s.type).join(','))
  ok(p.startDate === '2026-10-08', '起始日: ' + p.startDate)
  ok(typeof p.title === 'string' && p.title.length > 0, '标题非空')
})

test('重建后的段是「可编辑的完整段」：城市、人话、原文字段都在', () => {
  const res = decodeTripInvite(encodeTripInvite(payloadOf()), { today: TODAY })
  const t0 = res.payload.segments[0]
  ok(t0.fromCity === '上海' && t0.toCity === '北京', '城市重算: ' + t0.fromCity + '/' + t0.toCity)
  ok(t0.plain && t0.plain.voice.includes('G7102'), '人话重算')
  ok(typeof t0.id === 'string' && t0.id.length > 0, '有 id')
  ok(res.payload.segments[1].type === 'activity' && res.payload.segments[1].timeOfDay === '下午', '游玩段时间段还原')
})

test('todos 过邀请包后仍可读（子女端清单能带给对方）', () => {
  const p = payloadOf()
  p.segments[0].todos = [{ id: 'x', text: '买瓶水', level: 'high' }, { id: 'y', text: '拍张合影', level: 'low' }]
  const res = decodeTripInvite(encodeTripInvite(p), { today: TODAY })
  const todos = res.payload.segments[0].todos
  ok(todos.length === 2, '两条')
  ok(todos[0].text === '买瓶水' && todos[0].level === 'high', 'high 还原')
  ok(todos[1].level === 'low', 'low 还原')
})

test('篡改一个字符 → malformed（校验和挡住）', () => {
  const token = encodeTripInvite(payloadOf())
  const broken = token.slice(0, token.length - 2) + (token.endsWith('AA') ? 'BB' : 'AA')
  ok(decodeTripInvite(broken).ok === false, '改字符判坏')
  ok(decodeTripInvite('').ok === false, '空值判坏')
  ok(decodeTripInvite('nonsense').ok === false, '没有分隔符判坏')
})

test('过期 → expired，但仍带出载荷（页面可提示重新要一条）', () => {
  const res = decodeTripInvite(encodeTripInvite(payloadOf(Date.now() - 1000)), { today: TODAY })
  ok(res.ok === false && res.reason === 'expired', '判过期')
  ok(!!res.payload && res.payload.segments.length === 3, '仍带出段')
})

test('6 位码：稳定、随 eid 变化', () => {
  const p = payloadOf()
  const a = makeInviteCode(p)
  ok(/^\d{6}$/.test(a), '是 6 位数字: ' + a)
  ok(a === makeInviteCode(p), '同载荷稳定')
  ok(a !== makeInviteCode({ ...p, eid: 'other' }), '换 eid 就变')
})

test('extractToken：认 /receive/ 链接、也是裸 token，认不出 6 位码', () => {
  const token = encodeTripInvite(payloadOf())
  ok(extractToken(buildInviteUrl(token)) === token, '从接收链接里取出 token')
  ok(extractToken('  ' + token + '  ') === token, '裸 token 也认')
  ok(extractToken('https://x/#/e/' + token) === token, '长辈链接也能取出（同一条容错逻辑）')
  ok(extractToken('123456') === null, '纯 6 位码不当作 token')
})

test('空包不崩：没有段时也能重建出空行程', () => {
  const trip = buildInviteTrip({ t: 'x', g: [] }, { today: TODAY })
  ok(trip.segments.length === 0, '没有段')
  ok(trip.startDate === null, '起始日为 null')
  ok(trip.title === 'x', '标题沿用')
})