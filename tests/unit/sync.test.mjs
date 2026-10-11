// 同步通道客户端：room 派生稳定 / 事件去重 / 同设备镜像铺底 / 服务端探测失败静默回落。
// 全程不真发网络：fetch 用注入的 stub，BroadcastChannel 在 Node 里不存在（自动走镜像一侧）。
import test from 'node:test'
import assert from 'node:assert/strict'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
  clear: () => mem.clear(),
}

// 让服务端探测永远失败，逼出「同设备」这一轨
globalThis.fetch = () => Promise.reject(new Error('no server in unit test'))

const { KEYS } = await import('../../src/core/store.js')
const { roomId, makeEvent, push, subscribe, probeSync, syncMode, resetSyncCache } =
  await import('../../src/core/sync.js')

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}
const mirror = (room) => {
  const raw = localStorage.getItem(KEYS.syncMirror(room))
  return raw ? JSON.parse(raw) : null
}

test('roomId：同一 token 恒定、不同 token 不同、空值给空串', () => {
  const a = roomId('token-abc')
  ok(a === roomId('token-abc'), '同 token 恒定')
  ok(a !== roomId('token-abd'), '不同 token 不同')
  ok(typeof a === 'string' && a.length === 14, '14 字符（两段 7 位 base36）: ' + a)
  ok(/^[a-z0-9]{14}$/.test(a), '只含小写字母与数字（服务端白名单要求）: ' + a)
  ok(roomId('') === '' && roomId(null) === '', '空值给空串')
})

test('makeEvent：形状固定，id 唯一', () => {
  const e = makeEvent('card-done', 'seg0', { index: 0 }, 1000)
  ok(e.type === 'card-done' && e.segId === 'seg0' && e.at === 1000, '字段就位')
  ok(e.data && e.data.index === 0, 'data 带上')
  ok(typeof e.id === 'string' && e.id.length > 0, '有 id')
  ok(makeEvent('x', 's').id !== makeEvent('x', 's').id, '两次生成 id 不同')
})

test('probeSync：服务端探测失败 → 静默回落，syncMode 为 device', async () => {
  resetSyncCache()
  const okk = await probeSync({ now: Date.now() })
  ok(okk === false, '探测失败返回 false（不抛异常）')
  ok(syncMode() === 'device', '模式落到 device')
})

test('push：事件落进同设备镜像，服务端不可用不抛异常', async () => {
  localStorage.clear()
  resetSyncCache()
  const room = roomId('t1')
  const returned = await push(room, [makeEvent('trip-open', '', null, 1000)])
  ok(returned === false, '服务端不可用 → 返回 false（不抛）')
  const m = mirror(room)
  ok(m && m.events.length === 1 && m.events[0].type === 'trip-open', '镜像里有这条事件')
})

test('push：重复事件按 id 去重，不会越堆越多', async () => {
  localStorage.clear()
  const room = roomId('t2')
  const a = makeEvent('card-done', 'seg0', { index: 0 }, 2000)
  const b = makeEvent('card-open', 'seg1', { index: 1 }, 3000)
  await push(room, [a])
  await push(room, [a, b])
  const m = mirror(room)
  ok(m.events.length === 2, '去重后只剩两条: ' + m.events.length)
  ok(m.events.map((e) => e.id).filter((id) => id === a.id).length === 1, 'a 只出现一次')
})

test('push：只带 presence 也能落进镜像（位置走了独立分支）', async () => {
  localStorage.clear()
  const room = roomId('t3')
  await push(room, [], { lat: 31.2, lng: 121.4, acc: 30, at: 4000 })
  const m = mirror(room)
  ok(m && m.presence && m.presence.lat === 31.2, 'presence 落盘: ' + JSON.stringify(m && m.presence))
})

test('subscribe：先用镜像里的历史铺底，再接收后续；取消订阅不抛', async () => {
  localStorage.clear()
  const room = roomId('t4')
  await push(room, [makeEvent('trip-open', '', null, 5000)])
  const got = []
  const unsub = subscribe(room, ({ events }) => { got.push(...events) })
  ok(got.length === 1 && got[0].type === 'trip-open', '订阅时立刻收到镜像历史: ' + got.length)
  unsub()
  ok(typeof unsub === 'function', 'unsub 可重复调用不炸')
  unsub()
})

test('subscribe：同一条事件不重复投递（去重）', async () => {
  localStorage.clear()
  const room = roomId('t5')
  const e = makeEvent('card-done', 'seg0', { index: 0 }, 6000)
  await push(room, [e])
  const seen = []
  const unsub = subscribe(room, ({ events }) => { seen.push(...events.map((x) => x.id)) })
  // 再次推送同一 id：镜像去重 + 订阅侧去重，都不该再冒出来
  await push(room, [e])
  unsub()
  ok(seen.filter((id) => id === e.id).length === 1, '同一 id 只投一次: ' + seen.length)
})