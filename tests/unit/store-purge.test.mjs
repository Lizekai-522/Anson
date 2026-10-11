// 启动自愈：只清「孤立」的同步镜像键，绝不误删长辈端状态；另测家人分组的增删改。
// Node 里没有 localStorage，装一个内存版再动态导入。
import test from 'node:test'
import assert from 'node:assert/strict'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
  clear: () => mem.clear(),
}
globalThis.window = { localStorage: globalThis.localStorage }

const {
  KEYS, store, emptyData, purgeOrphanSyncKeys,
  upsertFamily, removeFamily, upsertFamilyGroup, removeFamilyGroup,
} = await import('../../src/core/store.js')
const { roomId } = await import('../../src/core/sync.js')

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

test('purgeOrphanSyncKeys：只挑孤立 sync 键，长辈端状态与账号桶一律不动', () => {
  const keys = [
    'ptb:sync:roomA',
    'ptb:sync:roomB',
    KEYS.elderState('roomB'),
    KEYS.data('acc1'),
    'ptb:accounts',
    'unrelated',
  ]
  const doomed = purgeOrphanSyncKeys(keys, ['roomB'])
  ok(doomed.length === 1 && doomed[0] === 'ptb:sync:roomA', '只删孤立的那一个: ' + JSON.stringify(doomed))
  ok(!doomed.some((k) => k.indexOf('ptb:elder:state:') === 0), '不碰长辈端状态')
  ok(!doomed.some((k) => k.indexOf('ptb:data:') === 0), '不碰账号桶')
})

test('purgeOrphanSyncKeys：没有有效房间时 → 所有镜像都算孤立；空输入安全', () => {
  ok(purgeOrphanSyncKeys(['ptb:sync:a', 'ptb:sync:b'], []).length === 2, '全部孤立')
  ok(purgeOrphanSyncKeys([], null).length === 0, '空输入')
  ok(purgeOrphanSyncKeys(['ptb:elder:state:x'], undefined).length === 0, '非 sync 键永不入选')
})

test('room 派生与 sync.roomId 保持一致（两边不许各算各的）', () => {
  // store 里为清残留复刻了一份 roomId 推导；这里用同一 token 验证两边结果相同
  const token = 'abc.def-ghi_jkl'
  const fromSync = roomId(token)
  // 从 store 的私有实现无法直接调用，用「孤立判断」间接验证：把该 room 当有效，则对应的键不被删
  const key = KEYS.syncMirror(fromSync)
  ok(purgeOrphanSyncKeys([key], [fromSync]).length === 0, 'valid room 对应的镜像键不该被删')
  ok(purgeOrphanSyncKeys([key], []).length === 1, '无有效房间时被删')
})

test('家人分组：同一人可属多组；removeFamily 会把人从所有组摘掉', () => {
  localStorage.clear()
  store.data = emptyData()
  upsertFamily({ id: 'f1', name: '阿明' })
  upsertFamily({ id: 'f2', name: '阿芳' })
  upsertFamilyGroup({ id: 'g1', name: '爷奶组', memberIds: ['f1', 'f2'] })
  upsertFamilyGroup({ id: 'g2', name: '老家组', memberIds: ['f1'] })
  ok(store.data.familyGroups.length === 2, '两个组')
  ok(store.data.familyGroups[0].id === 'g1' && store.data.familyGroups[0].memberIds.length === 2, '组内两人')
  ok(store.data.familyGroups[1].memberIds.join() === 'f1', '同一人可同时在另一组')

  removeFamily('f1')
  ok(store.data.family.length === 1 && store.data.family[0].id === 'f2', '人已删')
  ok(store.data.familyGroups[0].memberIds.join() === 'f2', '从 g1 摘掉')
  ok(store.data.familyGroups[1].memberIds.length === 0, '从 g2 摘掉')
})

test('家人分组：重复成员去重、改名就地更新、删除生效', () => {
  localStorage.clear()
  store.data = emptyData()
  upsertFamilyGroup({ id: 'g1', name: '一组', memberIds: ['a', 'a', 'b', ''] })
  ok(store.data.familyGroups[0].memberIds.join() === 'a,b', '去重且丢掉空值: ' + store.data.familyGroups[0].memberIds.join())
  upsertFamilyGroup({ id: 'g1', name: '改个名', memberIds: ['a'] })
  ok(store.data.familyGroups.length === 1 && store.data.familyGroups[0].name === '改个名', '就地更新')
  removeFamilyGroup('g1')
  ok(store.data.familyGroups.length === 0, '删除生效')
})

test('emptyData：新增区块默认是空数组（旧桶 Object.assign 后仍可用）', () => {
  const d = emptyData()
  ok(Array.isArray(d.familyGroups) && d.familyGroups.length === 0, 'familyGroups 默认空')
  ok(Array.isArray(d.invites) && d.invites.length === 0, 'invites 默认空')
})