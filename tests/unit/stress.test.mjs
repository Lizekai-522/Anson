// 压力：解析吞吐与稳定性（纯 node，无浏览器）
import test from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline } from '../../src/core/agents.js'

const ok = (c, m) => { if (typeof c !== 'boolean') throw new TypeError('ck: ' + m); assert.ok(c, m) }

test('10KB 混排文本：解析完整、耗时可接受', () => {
  const lines = []
  for (let i = 0; i < 120; i++) {
    lines.push(`10月${(i % 28) + 1}号 G${7100 + i} 上海虹桥 -> 北京南 09:3${i % 10}发车 13:45到 二等座`)
    lines.push(`住${['一', '两', '三'][i % 3]}晚 如家酒店(北京南站店${i})`)
    lines.push(`妈妈说到了打电话${i}`)
  }
  const raw = lines.join('\n')
  ok(raw.length > 8000, '文本超过 8KB: ' + raw.length)
  const t0 = performance.now()
  const trip = runPipeline(raw, { today: '2026-03-15' })
  const ms = performance.now() - t0
  ok(trip.segments.length === 240, `360 行 → 240 段（120 车 + 120 住），实际 ${trip.segments.length}`)
  ok(trip.unparsed.length === 120, '噪声行进 unparsed')
  ok(ms < 5000, '解析 10KB < 5s，实际 ' + ms.toFixed(0) + 'ms')
})

test('连续 200 次完整管线：不崩、不泄漏式变慢', () => {
  const raw = '10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到\n住一晚 如家酒店\n第二天 G104 上海虹桥 -> 杭州东'
  const t0 = performance.now()
  for (let i = 0; i < 200; i++) runPipeline(raw, { today: '2026-03-15' })
  const avg = (performance.now() - t0) / 200
  ok(avg < 30, '平均单次 < 30ms，实际 ' + avg.toFixed(2) + 'ms')
})

test('极端单行：10 万字符不崩', () => {
  const raw = 'G7102 上海虹桥站 到 北京南站 '.repeat(3000)
  const trip = runPipeline(raw, { today: '2026-03-15' })
  ok(trip.segments.length >= 1, '至少解析出一段')
})
