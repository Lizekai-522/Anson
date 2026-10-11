// 长辈端本机任务状态：脏数据回落、按 room 隔离、完成/折叠/提醒去重的幂等性。
// Node 环境没有 localStorage，先装内存版再动态导入被测模块。
import test from 'node:test'
import assert from 'node:assert/strict'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
  clear: () => mem.clear(),
}

const { KEYS } = await import('../../src/core/store.js')
const { loadElderState, saveElderState, toggleDone, toggleCollapsed, markDismissed, toggleTodo, todoKey, isTodoDone } =
  await import('../../src/core/elderState.js')

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}
const emptyMap = (m) => Object.keys(m || {}).length === 0
const emptyState = (s) => emptyMap(s.done) && emptyMap(s.collapsed) && emptyMap(s.dismissed) && emptyMap(s.todos)

test('没存过 → 三个空表；空 room → 同样空表', () => {
  localStorage.clear()
  ok(emptyState(loadElderState('room1')), '没数据返回空三表')
  ok(emptyState(loadElderState('')), '空 room 返回空三表')
})

test('脏数据被白名单拦下：数组/字符串/非数字值一律丢掉', () => {
  localStorage.clear()
  localStorage.setItem(KEYS.elderState('room1'), JSON.stringify({
    done: [],                       // 不是普通对象
    collapsed: 'oops',              // 不是对象
    dismissed: { 's1:lead': 'soon', 's2:lead': 123 }, // 值必须能转成有限数字
  }))
  const s = loadElderState('room1')
  ok(emptyMap(s.done) && emptyMap(s.collapsed), '非对象区块回落空表')
  ok(s.dismissed['s2:lead'] === 123 && !('s1:lead' in s.dismissed), '只留合法项: ' + JSON.stringify(s.dismissed))
})

test('存 → 读 往返一致，并按 room 隔离', () => {
  localStorage.clear()
  saveElderState('roomA', { done: { s1: 111 }, collapsed: {}, dismissed: {} })
  saveElderState('roomB', { done: { s9: 999 }, collapsed: {}, dismissed: {} })
  ok(loadElderState('roomA').done.s1 === 111, 'A 房间读到自己的')
  ok(!('s9' in loadElderState('roomA').done), 'A 房间看不到 B 房间的')
  ok(loadElderState('roomB').done.s9 === 999, 'B 房间独立')
})

test('toggleDone：点一次走完，再点改回没走完；不修改入参', () => {
  localStorage.clear()
  const a = loadElderState('r')
  const b = toggleDone(a, 's1', 5000)
  ok(b.done.s1 === 5000, '标记走完')
  ok(Object.keys(a.done).length === 0, '入参不被改（纯函数）')
  const c = toggleDone(b, 's1')
  ok(!('s1' in c.done), '再点还原')
  ok(Object.keys(toggleDone(a, '').done).length === 0, '空 segId 不动')
})

test('toggleCollapsed：收起 / 展开', () => {
  const a = loadElderState('r')
  const b = toggleCollapsed(a, 's2')
  ok(b.collapsed.s2 === 1, '收起')
  const c = toggleCollapsed(b, 's2')
  ok(!('s2' in c.collapsed), '展开')
})

test('markDismissed：按 segId + stage 记账，另一档不受影响', () => {
  const a = loadElderState('r')
  const b = markDismissed(a, 's1', 'lead', 7777)
  ok(b.dismissed['s1:lead'] === 7777, 'lead 记下')
  ok(!('s1:second' in b.dismissed), 'second 不受影响')
  const c = markDismissed(b, 's1', 'second')
  ok('s1:lead' in c.dismissed && 's1:second' in c.dismissed, '两档各自独立')
  const d = markDismissed(a, 's3')
  ok('s3:lead' in d.dismissed, '缺省 stage 按 lead')
})

test('saveElderState 出口也做净化（脏值不落盘）', () => {
  localStorage.clear()
  const saved = saveElderState('r', { done: { good: 5, bad: 'x' }, collapsed: null, dismissed: [] })
  ok(saved.done.good === 5 && !('bad' in saved.done), '只落合法项')
  ok(emptyMap(saved.collapsed) && emptyMap(saved.dismissed), '非法区块回落空表')
})

// ---- 第六轮：「到了之后做什么」清单打勾 ----

test('todos：键 = 卡片键:todo:序号；打勾 / 取消；不修改入参', () => {
  localStorage.clear()
  const a = loadElderState('r')
  ok(emptyMap(a.todos), '初始空表')
  ok(todoKey('seg0', 2) === 'seg0:todo:2', '键格式: ' + todoKey('seg0', 2))

  const b = toggleTodo(a, 'seg0', 2, 4242)
  ok(b.todos['seg0:todo:2'] === 4242, '打勾记时间戳')
  ok(emptyMap(a.todos), '入参不被改（纯函数）')
  ok(isTodoDone(b, 'seg0', 2), 'isTodoDone 命中')
  ok(!isTodoDone(b, 'seg0', 3) && !isTodoDone(b, 'seg1', 2), '其它序号/其它段不受影响')

  const c = toggleTodo(b, 'seg0', 2)
  ok(!('seg0:todo:2' in c.todos), '再点取消')
  ok(emptyMap(toggleTodo(a, 'seg0', null).todos) && emptyMap(toggleTodo(a, '', 0).todos), '缺参数不动')
})

test('todos：脏数据被白名单拦下；toggle 不会连带丢掉其它三类状态', () => {
  localStorage.clear()
  localStorage.setItem(KEYS.elderState('r'), JSON.stringify({
    done: { s1: 1 },
    collapsed: {},
    dismissed: {},
    todos: { 'seg0:todo:0': 9, 'seg0:todo:1': 'x', bad: {} },
  }))
  const s = loadElderState('r')
  ok(Object.keys(s.todos).length === 1 && s.todos['seg0:todo:0'] === 9, '只留合法项: ' + JSON.stringify(s.todos))

  // toggleDone 走 cloneState：todos 必须被带上，否则长辈的勾选会被悄悄清空
  const after = toggleDone(s, 's2')
  ok(after.todos['seg0:todo:0'] === 9, 'toggleDone 后 todos 仍在: ' + JSON.stringify(after.todos))
  ok(after.done.s1 === 1 && after.done.s2 != null, 'done 也正确')
})