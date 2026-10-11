// 自定义模型配置 + AI 补漏层 + 导出 + 行前清单的核心规则测试。
// 全是纯函数：不发网络、不碰 DOM（downloadXxx 才用到 DOM，不在这里测）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MODEL_PRESETS, emptyModelConfig, normalizeModelConfig, applyPreset,
  isConfigured, supportsVision, reasonText,
} from '../../src/core/model.js'
import {
  missingFields, assistTargets, hasWork, buildAssistMessages,
  parseJsonLoose, summarizePatches, applyAssist,
} from '../../src/core/ai.js'
import { buildIcs } from '../../src/core/export.js'
import { buildChecklist, checklistGroups, toggleChecklistItem, checklistProgress } from '../../src/core/checklist.js'

const TODAY = '2026-03-15'

test('配置白名单：脏数据被收回，越界温度被钳制', () => {
  const c = normalizeModelConfig({ presetId: 'nope', baseUrl: '  https://x/v1  ', apiKey: ' sk-1 ', model: ' m ', vision: 1, temperature: 9, useProxy: 'yes', timeoutMs: 10 })
  assert.equal(c.presetId, 'custom', '未知预设回落 custom')
  assert.equal(c.baseUrl, 'https://x/v1', 'trim 掉空格')
  assert.equal(c.apiKey, 'sk-1')
  assert.equal(c.model, 'm')
  assert.equal(c.vision, true)
  assert.equal(c.temperature, 2, '温度钳到上限 2')
  assert.equal(c.useProxy, true)
  assert.equal(c.timeoutMs, 3000, '超时钳到下限 3000')
  assert.deepEqual(normalizeModelConfig(null), emptyModelConfig(), '非对象回落默认')
})

test('选预设：填地址与模型名，但保留用户已填的 key', () => {
  const before = normalizeModelConfig({ presetId: 'custom', baseUrl: '', model: '', apiKey: 'sk-mine' })
  const after = applyPreset(before, 'deepseek')
  assert.equal(after.presetId, 'deepseek')
  assert.equal(after.baseUrl, MODEL_PRESETS.find((p) => p.id === 'deepseek').baseUrl)
  assert.equal(after.model, 'deepseek-chat')
  assert.equal(after.apiKey, 'sk-mine', '手填的 key 不被预设覆盖')
})

test('isConfigured / supportsVision：有地址+模型名即算配好，本机模型不要 key', () => {
  assert.equal(isConfigured({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', apiKey: '' }), true)
  assert.equal(isConfigured({ baseUrl: '', model: 'x' }), false)
  assert.equal(isConfigured({ baseUrl: 'x', model: '' }), false)
  assert.equal(supportsVision({ vision: true }), true)
  assert.equal(supportsVision({ vision: false }), false)
  assert.equal(reasonText('no-vision').includes('支持图片'), true)
  assert.equal(reasonText('http-401').includes('API Key'), true)
})

test('parseJsonLoose：剥围栏、截首块、失败返回 null 不抛', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonLoose('好的，结果是：{"a":1} 以上。'), { a: 1 })
  assert.equal(parseJsonLoose('没有花括号'), null)
  assert.equal(parseJsonLoose('{坏的'), null)
  assert.equal(parseJsonLoose(null), null)
})

test('missingFields / assistTargets / hasWork', () => {
  const train = { id: 'a', type: 'train', date: '2026-10-08', from: '', to: '北京南站', departTime: null, arriveTime: null, code: null }
  assert.deepEqual(missingFields(train), ['from', 'departTime', 'arriveTime', 'code'])
  const hotel = { id: 'b', type: 'hotel', date: null }
  assert.deepEqual(missingFields(hotel), ['date'], '酒店只补日期')

  const result = { segments: [train, { id: 'c', type: 'train', date: '2026-10-08', from: 'a', to: 'b', departTime: '09:00', arriveTime: '10:00', code: 'G1', manualConfirm: false }], unparsed: ['  ', '一行没看懂'] }
  const t = assistTargets(result)
  assert.equal(t.need.length, 1, '只有缺字段的那段进 need')
  assert.equal(t.unparsed.length, 1, '空行被过滤')
  assert.equal(hasWork(result), true)
  assert.equal(hasWork({ segments: [], unparsed: [] }), false)
})

test('buildAssistMessages：把线索如实交给模型，不含答案', () => {
  const result = { segments: [{ id: 's1', type: 'train', date: null, from: '上海虹桥站', to: '北京南站', departTime: '09:30', arriveTime: '13:45', code: 'G7102', sourceLine: '10月8号 G7102 上海虹桥到北京南' }], unparsed: [] }
  const msgs = buildAssistMessages(result, { today: TODAY, fallbackDate: null })
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].role, 'system')
  assert.ok(msgs[0].content.includes('只输出 JSON'))
  const payload = JSON.parse(msgs[1].content)
  assert.equal(payload.givenToday, TODAY)
  assert.equal(payload.segments[0].segId, 's1')
  assert.deepEqual(payload.segments[0].missing, ['date'])
})

test('summarizePatches：只统计真正会被填上的项', () => {
  const result = { segments: [{ id: 's1', type: 'train', date: null, from: '上海虹桥站', to: '北京南站', departTime: null, arriveTime: null, code: null }] }
  const patches = {
    segments: [{ segId: 's1', date: '2026-10-08', departTime: '09:30', arriveTime: '13:45', code: 'G7102', from: '杭州东站' }],
    newSegments: [],
  }
  const s = summarizePatches(result, patches)
  assert.equal(s.count, 1, '一段一行')
  assert.ok(s.items[0].text.includes('日期'))
  assert.ok(s.items[0].text.includes('出发时间'))
  // 值非法 → 不计入
  const bad = summarizePatches(result, { segments: [{ segId: 's1', date: '2026-13-99' }], newSegments: [] })
  assert.equal(bad.count, 0)
})

test('applyAssist：只填空不覆盖、加新段走契约、卸掉被认领的 unparsed 行', () => {
  const result = {
    segments: [{ id: 's1', type: 'train', date: null, departTime: null, arriveTime: null, from: '上海虹桥站', to: '北京南站', code: null }],
    issues: [],
    unparsed: ['10月9号 住一晚 如家酒店'],
  }
  const patches = {
    segments: [{ segId: 's1', date: '2026-10-08', departTime: '09:30', arriveTime: '13:45', code: 'G7102', from: '杭州东站' }],
    newSegments: [{ type: 'hotel', date: '2026-10-09', to: '如家酒店', hotelNights: 1, sourceLine: '10月9号 住一晚 如家酒店' }],
  }
  // today 设在行程之后 → sanityCheck 应该报出 past-date，以此证明它确实重跑过
  const r = applyAssist(result, patches, { today: '2027-01-01' })
  assert.equal(r.ok, true)
  assert.equal(r.filled, 4, 'date/departTime/arriveTime/code 四项')
  assert.equal(r.added, 1)
  const seg = result.segments[0]
  assert.equal(seg.from, '上海虹桥站', '已有值不被 AI 覆盖（铁律）')
  assert.equal(seg.date, '2026-10-08')
  assert.equal(seg.aiAssisted, true)
  assert.equal(seg.manualConfirm, true, '补出来的仍要人工核对')
  assert.equal(result.segments.length, 2)
  assert.equal(result.segments[1].type, 'hotel')
  assert.equal(result.segments[1].hotelNightsExplicit, true)
  assert.deepEqual(result.unparsed, [], '被认领的那行从"没看懂"里移除')
  assert.ok(result.issues.some((i) => i.code === 'past-date'), '重跑过 sanityCheck')
  assert.ok(result.segments[0].plain.title, '重算过人话')
})

test('applyAssist：非法补丁一律不收（不写坏数据）', () => {
  const result = { segments: [{ id: 's1', type: 'train', date: null, departTime: null, arriveTime: null, from: '', to: '', code: null }], issues: [], unparsed: [] }
  const r = applyAssist(result, { segments: [{ segId: 's1', date: '2026-13-99', departTime: '99:99', code: '!!!' }], newSegments: [{ type: 'wormhole', from: 'x' }] }, { today: TODAY })
  assert.equal(r.ok, true)
  assert.equal(r.filled, 0)
  assert.equal(r.added, 0, '未知类型不建段')
  assert.equal(result.segments[0].date, null)
  assert.equal(applyAssist(result, null).ok, false)
})

test('buildIcs：结构、全天住宿、跨天、VALARM、转义', () => {
  const trip = {
    title: '去北京', startDate: '2026-10-08',
    segments: [
      { id: 's1', type: 'train', date: '2026-10-08', departTime: '09:30', arriveTime: '13:45', code: 'G7102', from: '上海虹桥站', to: '北京南站', plain: { title: 'G7102 高铁', voice: 'v', tips: ['早点到'] } },
      { id: 's2', type: 'hotel', date: '2026-10-08', hotelNights: 2, to: '如家酒店', plain: { title: '入住 如家酒店', voice: '', tips: [] } },
      { id: 's3', type: 'train', date: '2026-10-10', departTime: '23:30', arriveTime: '01:10', arriveNextDay: true, code: 'G1', from: '北京南站', to: '上海虹桥站', plain: { title: 'G1 高铁', voice: '', tips: [] } },
    ],
  }
  const ics = buildIcs(trip, { now: new Date('2026-10-01T00:00:00Z') })
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'))
  assert.ok(ics.includes('DTSTART:20261008T093000'))
  assert.ok(ics.includes('DTEND:20261008T134500'))
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261008'))
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261010'), '住 2 晚 → 退房日 +2')
  assert.ok(ics.includes('TRIGGER:-PT2H'), '火车提前 2 小时提醒')
  assert.ok(ics.includes('DTEND:20261011T011000'), '次日到达：结束日 +1')
  assert.ok(ics.includes('DTSTAMP:20261001T000000Z'))
  // 转义
  const esc = buildIcs({ segments: [{ id: 'x', type: 'train', date: '2026-10-08', departTime: '09:00', arriveTime: '10:00', from: 'A', to: 'B', plain: { title: 'A, B; C', voice: '', tips: [] } }] })
  assert.ok(esc.includes('SUMMARY:A\\, B\\; C'))
})

test('buildChecklist：按段类型派生，分组与勾选态可持久', () => {
  const trip = { segments: [
    { type: 'flight', date: '2026-10-08', departTime: '09:00', arriveTime: '11:00' },
    { type: 'hotel', date: '2026-10-08' },
    { type: 'taxi', date: '2026-10-09' },
  ] }
  const items = buildChecklist(trip)
  const ids = items.map((i) => i.id)
  assert.ok(ids.includes('id-card'))
  assert.ok(ids.includes('early-airport'), '有航班 → 提前到机场')
  assert.ok(ids.includes('plate'), '有接送 → 核对车牌')
  assert.ok(!ids.includes('early-station'), '没火车就不出火车条目')
  const groups = checklistGroups(items)
  assert.deepEqual(groups.map((g) => g.key), ['证件', '时间', '随身', '联络'])
  assert.equal(groups.every((g) => g.items.length > 0), true)

  // 勾选态：写进 trip.checklist，重建后仍为 done
  const on = toggleChecklistItem(trip, 'id-card')
  assert.equal(on, true)
  assert.equal(buildChecklist(trip).find((i) => i.id === 'id-card').done, true)
  toggleChecklistItem(trip, 'id-card')
  assert.equal(buildChecklist(trip).find((i) => i.id === 'id-card').done, false)

  const p = checklistProgress(buildChecklist(trip))
  assert.equal(p.total, items.length)
  assert.equal(p.done, 0)
})