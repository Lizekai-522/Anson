// 长图「行」的纯函数：子女端从 segment 取行，长辈端从卡片取行，绘制逻辑共用一份。
// 只测纯函数（canvas 绘制要 DOM，交给 e2e 验）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { posterRowsFromSegments, posterRowsFromCards } from '../../src/core/export.js'

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

test('posterRowsFromSegments：标题 / 路线 / 时间行', () => {
  const rows = posterRowsFromSegments({ segments: [
    { type: 'train', code: 'G1', date: '2026-10-08', departTime: '09:30', arriveTime: '13:45', from: 'A站', to: 'B站', plain: { title: 'G1 高铁' } },
  ] })
  ok(rows.length === 1, '一行')
  ok(rows[0].title === 'G1 高铁', '标题: ' + rows[0].title)
  ok(rows[0].route === 'A站  →  B站', '路线: ' + rows[0].route)
  ok(rows[0].line.includes('2026-10-08') && rows[0].line.includes('09:30'), '时间行: ' + rows[0].line)
  ok(posterRowsFromSegments(null).length === 0, 'null 安全')
})

test('posterRowsFromCards：长辈卡口径（标题 + 目的地），缺字段不产生脏行', () => {
  const rows = posterRowsFromCards([
    { title: '高铁', to: 'B站', from: 'A站', date: '2026-10-08', depart: '09:30', arrive: '13:45' },
    { title: '游玩', kind: 'play', to: '公园', date: '2026-10-08', timeOfDay: '下午' },
    { kind: 'stay', to: '如家酒店' },
  ])
  ok(rows[0].title === '高铁  B站', '路线卡标题带目的地: ' + rows[0].title)
  ok(rows[0].route === 'A站  →  B站', '路线: ' + rows[0].route)
  ok(rows[0].line === '2026-10-08  09:30 - 13:45', '时间行: ' + rows[0].line)
  ok(rows[1].route === '公园', '没有出发地时只写目的地: ' + rows[1].route)
  ok(rows[2].title === '如家酒店', '住宿用目的地当标题: ' + rows[2].title)
  ok(rows[2].line === '', '没有时间就是空行（不塞「日期待定」）')
  ok(posterRowsFromCards([]).length === 0, '空数组')
})

test('posterRowsFromCards：跨天到达标出「次日」', () => {
  const rows = posterRowsFromCards([{ title: '卧铺', from: 'A', to: 'B', date: '2026-10-08', depart: '19:00', arrive: '06:30', arriveNextDay: true }])
  ok(rows[0].line.includes('次日'), '标出次日: ' + rows[0].line)
})