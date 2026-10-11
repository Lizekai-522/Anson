// 同步服务端：房间内存态（事件环形上限 / 只留最新位置 / 脏输入拦下）+ 三个接口的真 HTTP 往返。
// 直接调 createSyncStore 测纯逻辑；再用 createServer + listen(0) 拿随机端口跑一遍接口契约。
import test from 'node:test'
import assert from 'node:assert/strict'

const { createSyncStore, createServer, ARRIVE_GRACE_MS } = await import('../../server/app.mjs')

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

const ev = (id, type = 'card-done') => ({ id, type, segId: 'seg0', at: 1000, data: { index: 0 } })

test('createSyncStore：push 增量 / pull 游标正确', () => {
  const s = createSyncStore()
  const r1 = s.push('room0000', [ev('a'), ev('b')])
  ok(r1.ok === true && r1.cursor === 2, 'push 后游标 = 2')
  const p0 = s.pull('room0000', 0)
  ok(p0.events.length === 2, 'since=0 拿全量')
  const p1 = s.pull('room0000', 1)
  ok(p1.events.length === 1 && p1.events[0].id === 'b', 'since=1 只拿增量')
  ok(p1.cursor === 2, '游标仍为最新')
  const p2 = s.pull('room0000', 2)
  ok(p2.events.length === 0, 'since=最新 → 空')
})

test('createSyncStore：脏事件被丢（缺 id / 缺 type / 非对象）', () => {
  const s = createSyncStore()
  s.push('room0001', [{ id: '', type: 'x' }, { id: 'ok1' }, null, 'nope', ev('good')])
  const p = s.pull('room0001', 0)
  ok(p.events.length === 1 && p.events[0].id === 'good', '只留一条合法事件: ' + p.events.length)
})

test('createSyncStore：事件环形上限 200，保留最新的', () => {
  const s = createSyncStore()
  for (let i = 1; i <= 250; i++) s.push('room0002', [ev('e' + i)])
  const p = s.pull('room0002', 0)
  ok(p.events.length === 200, '最多 200 条: ' + p.events.length)
  ok(p.events[0].id === 'e51', '最旧的是第 51 条: ' + p.events[0].id)
  ok(p.events[199].id === 'e250', '最新的是第 250 条')
})

test('createSyncStore：位置只保留最新一份，非法坐标被丢', () => {
  const s = createSyncStore()
  s.push('room0003', [], { lat: 31.1, lng: 121.1, acc: 40, at: 1000 })
  s.push('room0003', [], { lat: 31.2, lng: 121.2, acc: 25, at: 2000 })
  const p = s.pull('room0003', 0)
  ok(p.presence.lat === 31.2 && p.presence.acc === 25, '只留最新: ' + JSON.stringify(p.presence))
  // 非法坐标：纬度越界 / 非数字 → 不覆盖已有位置
  s.push('room0003', [], { lat: 200, lng: 0 })
  s.push('room0003', [], { lat: 'x', lng: 'y' })
  ok(s.pull('room0003', 0).presence.lat === 31.2, '非法坐标不覆盖')
})

test('createSyncStore：闲置超 24h 会被 sweep 清掉', () => {
  let t = 1_000_000
  const s = createSyncStore({ now: () => t })
  s.push('room0004', [ev('x')])
  ok(s.size() === 1, '有一个房间')
  t += 25 * 60 * 60 * 1000
  s.sweep()
  ok(s.size() === 0, '闲置 25h 后清掉')
})

// ---- 第六轮：平安到达（presence.eta + pull 惰性 alerts）----

test('cleanPresence：eta 白名单校验（合法保留，缺字段/坏值丢掉该字段）', () => {
  const s = createSyncStore()
  s.push('roometa0', [], { lat: 30, lng: 120, at: 1000, eta: { segId: 'seg1', at: 5000 } })
  ok(s.pull('roometa0', 0).presence.eta.segId === 'seg1', '合法 eta 保留')
  s.push('roometa1', [], { lat: 30, lng: 120, at: 1000, eta: { segId: '', at: 5000 } })
  ok(s.pull('roometa1', 0).presence.eta === undefined, '缺 segId 丢掉 eta')
  s.push('roometa2', [], { lat: 30, lng: 120, at: 1000, eta: { segId: 's', at: 'x' } })
  ok(s.pull('roometa2', 0).presence.eta === undefined, 'at 不是数字丢掉 eta')
  s.push('roometa3', [], { lat: 30, lng: 120, at: 1000 })
  ok(s.pull('roometa3', 0).presence.eta === undefined, '本来没有就没有')
})

test('pull 惰性 alerts：过宽限期且没收到「走完」才提醒；收到就不提醒', () => {
  let t = 1_000_000
  const s = createSyncStore({ now: () => t })
  ok(ARRIVE_GRACE_MS === 60 * 60 * 1000, '宽限期 1 小时')

  // 刚上报到达点：还没到宽限期 → 不带 alerts
  s.push('roomalert', [], { lat: 30, lng: 120, at: t, eta: { segId: 'seg1', at: t } })
  ok(s.pull('roomalert', 0).alerts === undefined, '没过宽限期不提醒')

  // 过了 1 小时 30 分，仍没收到该段 card-done → 提醒
  t += 90 * 60 * 1000
  const p = s.pull('roomalert', 0)
  ok(Array.isArray(p.alerts) && p.alerts.length === 1, '超时提醒一次')
  const a = p.alerts[0]
  ok(a.type === 'arrive-missed' && a.segId === 'seg1', '形状: ' + JSON.stringify(a))
  ok(a.data.minutes === 90, '逾期分钟数: ' + a.data.minutes)
  ok(typeof a.id === 'string' && a.id.length > 0, '带稳定 id（前端按 id 去重）')

  // 长辈补勾了「走完」（时间晚于到达点）→ 不再提醒
  s.push('roomalert', [{ id: 'done1', type: 'card-done', segId: 'seg1', at: t, data: { index: 0 } }])
  ok(s.pull('roomalert', 0).alerts === undefined, '确认过就不再提醒')
})

test('pull 惰性 alerts：早于到达点的「走完」不算数（那是上一段的操作）', () => {
  let t = 1_000_000
  const s = createSyncStore({ now: () => t })
  s.push('roomalert2', [{ id: 'old', type: 'card-done', segId: 'seg1', at: t - 5000, data: { index: 0 } }])
  s.push('roomalert2', [], { lat: 30, lng: 120, at: t, eta: { segId: 'seg1', at: t } })
  t += 61 * 60 * 1000
  const p = s.pull('roomalert2', 0)
  ok(Array.isArray(p.alerts) && p.alerts.length === 1, '到达点之前勾的不算确认')
})

test('HTTP 接口：/api/weather 缺城市名 400；同源校验放行同源 GET', async () => {
  const server = createServer({})
  await new Promise((res) => server.listen(0, '127.0.0.1', res))
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  try {
    const r = await fetch(base + '/api/weather')
    ok(r.status === 400, '缺 city 返回 400，实际 ' + r.status)
    const body = await r.json()
    ok(body.ok === false && body.reason === 'missing_city', '给得出原因: ' + JSON.stringify(body))
  } finally {
    await new Promise((res) => server.close(res))
  }
})

test('HTTP 接口：ping / push / pull 往返 + 非法房间名 400', async () => {
  const server = createServer({})
  await new Promise((res) => server.listen(0, '127.0.0.1', res))
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  try {
    const ping = await (await fetch(base + '/api/sync/ping')).json()
    ok(ping.ok === true && typeof ping.rooms === 'number', 'ping 返回 ok + rooms')

    const pushRes = await fetch(base + '/api/sync/abcdefgh/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [ev('h1'), ev('h2')], presence: { lat: 30, lng: 120, acc: 12, at: 5000 } }),
    })
    const pushed = await pushRes.json()
    ok(pushRes.status === 200 && pushed.ok === true && pushed.cursor === 2, 'push 成功且游标 = 2')

    const pulled = await (await fetch(base + '/api/sync/abcdefgh/pull?since=1')).json()
    ok(pulled.ok === true && pulled.events.length === 1 && pulled.events[0].id === 'h2', 'pull 增量正确')
    ok(pulled.presence && pulled.presence.lat === 30, 'pull 带出最新位置')

    const bad = await fetch(base + '/api/sync/BAD_room/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    })
    ok(bad.status === 400, '非法房间名返回 400，实际 ' + bad.status)
  } finally {
    await new Promise((res) => server.close(res))
  }
})