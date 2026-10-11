// 备份恢复纯函数：形状校验 / 按 id 去重 / 计数准确 / 不改动入参。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeBackup } from '../../src/core/store.js'

const trip = (id) => ({ id, title: '行程' + id, segments: [] })

function current() {
  return { trips: [trip('a')], family: [], shares: [], draft: null }
}

test('形状不符：非对象 / 无任何数组区块 → ok:false，数据保持原样', () => {
  for (const bad of [null, undefined, 'hello', 42, {}, { trips: 'no' }, { foo: 1 }]) {
    const res = mergeBackup(current(), bad)
    assert.equal(res.ok, false, '应判为形状不符: ' + JSON.stringify(bad))
    assert.equal(res.reason, 'shape')
    assert.equal(res.data.trips.length, 1, '不得改动现有数据')
  }
})

test('合并：重复跳过、新增计入，计数准确', () => {
  const incoming = {
    trips: [trip('a'), trip('b'), trip('c')], // a 已存在
    family: [{ id: 'f1', name: '女儿' }],
    shares: [],
  }
  const res = mergeBackup(current(), incoming)
  assert.equal(res.ok, true)
  assert.deepEqual(res.added, { trips: 2, family: 1, shares: 0, familyGroups: 0 })
  assert.equal(res.skipped, 1, '重复的 a 计一次')
  assert.equal(res.data.trips.length, 3)
  assert.equal(res.data.family.length, 1)
})

test('缺 id / 非对象项：跳过并计数，不污染数据', () => {
  const incoming = { trips: [{ title: '没有 id' }, null, 'x', trip('b')] }
  const res = mergeBackup(current(), incoming)
  assert.equal(res.ok, true)
  assert.equal(res.added.trips, 1)
  assert.equal(res.skipped, 3)
  assert.deepEqual(res.data.trips.map((t) => t.id), ['a', 'b'])
})

test('备份只有 family 区块：其余区块保持现有', () => {
  const res = mergeBackup(current(), { family: [{ id: 'f9', name: '儿子' }] })
  assert.equal(res.ok, true)
  assert.equal(res.data.trips.length, 1, 'trips 不受影响')
  assert.equal(res.data.family.length, 1)
})

test('纯函数：不改动入参（current 与 incoming 都不被写脏）', () => {
  const cur = current()
  const inc = { trips: [trip('b')] }
  const curSnap = JSON.stringify(cur)
  const incSnap = JSON.stringify(inc)
  const res = mergeBackup(cur, inc)
  assert.equal(JSON.stringify(cur), curSnap, 'current 被改动')
  assert.equal(JSON.stringify(inc), incSnap, 'incoming 被改动')
  res.data.trips.push(trip('zzz'))
  assert.equal(JSON.stringify(cur), curSnap, '返回值与入参不共享引用')
})

test('空备份（三个空数组）：ok:true，什么也不加', () => {
  const res = mergeBackup(current(), { trips: [], family: [], shares: [] })
  assert.equal(res.ok, true)
  assert.deepEqual(res.added, { trips: 0, family: 0, shares: 0, familyGroups: 0 })
  assert.equal(res.skipped, 0)
})

test('current 为 null / 缺区块：按空桶处理不崩', () => {
  const res = mergeBackup(null, { trips: [trip('n1')] })
  assert.equal(res.ok, true)
  assert.equal(res.data.trips.length, 1)
  assert.equal(res.data.family.length, 0)
  assert.equal(res.data.shares.length, 0)
})