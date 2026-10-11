import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIcs } from '../../src/core/export.js'
import { runPipeline } from '../../src/core/agents.js'

test('unconfirmed parse has no calendar alarm or invented arrival', () => {
  const result = runPipeline('10月12号 G1 上海虹桥站 到 北京南站 09:00发车 25:70到', { today: '2026-10-11' })
  assert.equal(result.segments[0].manualConfirm, true)
  const ics = buildIcs(result)
  assert.doesNotMatch(ics, /BEGIN:VALARM/)
  assert.match(ics, /DTSTART;VALUE=DATE:20261012/)
  assert.doesNotMatch(ics, /DTEND:.*T/)
})

test('known departure and unknown arrival creates no fabricated duration', () => {
  const segment = { id: 'departure', type: 'train', date: '2026-10-12', departTime: '23:30', arriveTime: null, manualConfirm: false }
  const ics = buildIcs({ segments: [segment] })
  assert.match(ics, /DTSTART:20261012T233000/)
  assert.doesNotMatch(ics, /DTEND:/)
  assert.match(ics, /BEGIN:VALARM/)
})
