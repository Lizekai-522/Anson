// AI 补漏层（可选）：规则解析跑完之后，用用户自己的模型补"规则没抽到的空"。
//
// 铁律（和 agents.js 的产品底线一脉相承）：
//   1. AI 只填空，绝不覆盖规则已经确认的非空值。
//   2. 补完必须重跑 sanityCheck —— 不信任模型输出，最后一道检查永远由规则把关。
//   3. 补过的段仍标 manualConfirm，让用户照旧能一眼看到"这条是补出来的，请再核对"。
//
// 依赖：model.js（chat / 配置 / 多模态），agents.js（空段契约 / 人话重算 / 合理性检查）。
import { chat, loadModelConfig, isConfigured, imageContent } from './model.js'
import { createBlankSegment, refreshPlain, sanityCheck, normalizeStation, guessCity } from './agents.js'

// 一段里"缺失且可补"的字段。hotel 只需要日期；train/flight 还要时刻与班次号。
export function missingFields(seg) {
  if (!seg) return []
  const miss = []
  if (!seg.date) miss.push('date')
  if (seg.type === 'hotel') return miss
  if (!seg.from) miss.push('from')
  if (!seg.to) miss.push('to')
  if (seg.type === 'train' || seg.type === 'flight') {
    if (!seg.departTime) miss.push('departTime')
    if (!seg.arriveTime) miss.push('arriveTime')
    if (!seg.code) miss.push('code')
  }
  return miss
}

// 需要 AI 出手的对象：有缺字段的段 / 待人工确认的段 + 没看懂的行
export function assistTargets(result) {
  const segs = (result && result.segments) || []
  const unparsed = ((result && result.unparsed) || []).filter((l) => String(l || '').trim())
  const need = []
  for (const s of segs) {
    const miss = missingFields(s)
    if (miss.length || s.manualConfirm) {
      need.push({ segId: s.id, type: s.type, missing: miss, sourceLine: s.sourceLine || '' })
    }
  }
  return { need, unparsed }
}

// 有没有活可干（决定「AI 补全」按钮是否可点）
export function hasWork(result) {
  const t = assistTargets(result)
  return t.need.length > 0 || t.unparsed.length > 0
}

const ASSIST_SYSTEM = [
  '你是「安程」的行程补全助手。用户给你一批"缺字段的行程段"和"没看懂的行"，',
  '你的唯一任务是从 sourceLine（和 unparsed 行）里把缺失信息抽出来补上。',
  '规则：',
  '- 日期一律 YYYY-MM-DD；相对日期（明天/后天/次日等）以 givenToday 为基准换算。',
  '- 时间一律 24 小时制 HH:MM。',
  '- 车站/机场保留常见写法（如「上海虹桥站」「上海浦东国际机场」）。',
  '- 抽不出确定值就留空字符串，绝不编造。',
  '- 只输出 JSON，不要解释、不要 Markdown 围栏。',
  '输出结构：',
  '{"segments":[{"segId":"原 segId","date":"","departTime":"","arriveTime":"","from":"","to":"","code":""}],',
  ' "newSegments":[{"type":"train|flight|hotel|taxi","date":"","departTime":"","arriveTime":"","from":"","to":"","code":"","hotelNights":null,"sourceLine":"原始那一行"}]}',
  '只补 segments 里列出的字段；没有把握的字段留空。',
].join('\n')

// 组装请求：把"要补什么"和"原文线索"如实交给模型，不给答案、不给示例数据。
export function buildAssistMessages(result, { today, fallbackDate } = {}) {
  const { need, unparsed } = assistTargets(result)
  const payload = {
    givenToday: today || null,
    fallbackDate: fallbackDate || null,
    segments: need,
    unparsed,
  }
  return [
    { role: 'system', content: ASSIST_SYSTEM },
    { role: 'user', content: JSON.stringify(payload) },
  ]
}

// 宽容解析：剥离 ```json 围栏、截取首个花括号块；解析失败返回 null（不抛）
export function parseJsonLoose(text) {
  if (typeof text !== 'string') return null
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(s.slice(start, end + 1))
    return obj && typeof obj === 'object' ? obj : null
  } catch { return null }
}

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/
const RE_TIME = /^\d{1,2}:\d{2}$/
const RE_FLIGHT_CODE = /^[A-Za-z0-9]{2}\d{3,4}$/
const RE_TRAIN_CODE = /^[GDCKTZY]\d{1,4}$/i
const SEG_TYPES = ['train', 'flight', 'hotel', 'taxi']

function pickStr(v, max = 60) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}
function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 }
function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}
// 只认"真实存在的日期"：2026-13-99 这种格式对但日子不存在的必须挡掉
function pickDate(v) {
  const s = pickStr(v, 10)
  if (!RE_DATE.test(s)) return ''
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return ''
  return s
}
function pickTime(v) {
  const s = pickStr(v, 5)
  if (!RE_TIME.test(s)) return ''
  const [h, m] = s.split(':').map(Number)
  if (h > 23 || m > 59) return ''
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
}
function pickCode(v, type) {
  const s = pickStr(v, 10).toUpperCase()
  if (type === 'flight') return RE_FLIGHT_CODE.test(s) ? s : ''
  if (type === 'train') return RE_TRAIN_CODE.test(s) ? s : ''
  return ''
}

// 把一段的补丁写进 seg：只写空字段；非空的一律不动（铁律 1）
function fillSegment(seg, patch) {
  if (!seg || !patch || typeof patch !== 'object') return 0
  let n = 0
  const put = (key, val) => {
    if (val && !seg[key]) { seg[key] = val; n++ }
  }
  put('date', pickDate(patch.date))
  put('from', normalizeStation(pickStr(patch.from, 40)))
  put('to', seg.type === 'hotel' ? pickStr(patch.to, 60) : normalizeStation(pickStr(patch.to, 40)))
  if (seg.type === 'train' || seg.type === 'flight') {
    put('departTime', pickTime(patch.departTime))
    put('arriveTime', pickTime(patch.arriveTime))
    put('code', pickCode(patch.code, seg.type))
  }
  if (n) {
    seg.aiAssisted = true
    seg.manualConfirm = true // 补出来的仍要人工核对
    if (seg.type === 'train' || seg.type === 'flight') {
      seg.fromCity = guessCity(seg.from)
      seg.toCity = guessCity(seg.to)
    }
  }
  return n
}

// 新段必须走 baseSeg 契约（createBlankSegment），下游长辈端/分享页才能直接消费
function buildFromPatch(patch, today) {
  if (!patch || typeof patch !== 'object') return null
  const type = SEG_TYPES.includes(patch.type) ? patch.type : ''
  if (!type) return null
  const seg = createBlankSegment(type, pickDate(patch.date) || today || null)
  let n = 0
  const put = (key, val) => { if (val && !seg[key]) { seg[key] = val; n++ } }
  put('date', pickDate(patch.date))
  if (type === 'hotel') {
    put('to', pickStr(patch.to, 60))
    const nights = Number(patch.hotelNights)
    if (Number.isFinite(nights) && nights >= 1 && nights <= 60) {
      seg.hotelNights = Math.floor(nights)
      seg.hotelNightsExplicit = true
      n++
    }
  } else {
    put('from', normalizeStation(pickStr(patch.from, 40)))
    put('to', normalizeStation(pickStr(patch.to, 40)))
    put('departTime', pickTime(patch.departTime))
    put('arriveTime', pickTime(patch.arriveTime))
    put('code', pickCode(patch.code, type))
  }
  if (!n) return null // 一个字段都没抽到，就别塞一段空卡添乱
  seg.sourceLine = pickStr(patch.sourceLine, 200) || seg.sourceLine
  seg.aiAssisted = true
  seg.manualConfirm = true
  if (type === 'train' || type === 'flight') {
    seg.fromCity = guessCity(seg.from)
    seg.toCity = guessCity(seg.to)
  }
  return seg
}

// 预览：把补丁翻译成"将补全 N 项"的中文清单，供用户确认后再落地
const FIELD_CN = {
  date: '日期', departTime: '出发时间', arriveTime: '到达时间',
  from: '出发地', to: '到达地', code: '车次/航班号',
}
export function summarizePatches(result, patches) {
  const segs = (result && result.segments) || []
  const byId = new Map(segs.map((s) => [s.id, s]))
  const items = []
  for (const p of ((patches && patches.segments) || [])) {
    const seg = byId.get(p && p.segId)
    if (!seg) continue
    const miss = missingFields(seg)
    const got = []
    if (miss.includes('date') && pickDate(p.date)) got.push(FIELD_CN.date)
    if (miss.includes('from') && pickStr(p.from, 40)) got.push(FIELD_CN.from)
    if (miss.includes('to') && pickStr(p.to, 60)) got.push(FIELD_CN.to)
    if (miss.includes('departTime') && pickTime(p.departTime)) got.push(FIELD_CN.departTime)
    if (miss.includes('arriveTime') && pickTime(p.arriveTime)) got.push(FIELD_CN.arriveTime)
    if (miss.includes('code') && pickCode(p.code, seg.type)) got.push(FIELD_CN.code)
    if (got.length) items.push({ segId: seg.id, text: `第 ${segs.indexOf(seg) + 1} 段：补上 ${got.join('、')}` })
  }
  const news = []
  for (const p of ((patches && patches.newSegments) || [])) {
    if (p && SEG_TYPES.includes(p.type) && (pickStr(p.from, 40) || pickStr(p.to, 60) || pickDate(p.date))) {
      news.push({ text: `新增一段：${pickStr(p.sourceLine, 60) || (pickStr(p.from, 40) + ' → ' + pickStr(p.to, 60))}` })
    }
  }
  return { items, news, count: items.length + news.length }
}

// 落地：按 segId 只填空 → 新增段走契约 → 重算人话 → 重跑 sanityCheck（铁律 2）
// 返回 { ok, filled, added, result } | { ok:false, reason, result }
export function applyAssist(result, patches, { today } = {}) {
  if (!result || !patches || typeof patches !== 'object') return { ok: false, reason: 'bad-patches', result }
  const segs = result.segments || []
  const byId = new Map(segs.map((s) => [s.id, s]))
  let filled = 0
  for (const p of (patches.segments || [])) {
    const seg = byId.get(p && p.segId)
    if (seg) filled += fillSegment(seg, p)
  }
  let added = 0
  const handledLines = new Set()
  for (const p of (patches.newSegments || [])) {
    const seg = buildFromPatch(p, today)
    if (seg) {
      segs.push(seg)
      added++
      const line = pickStr(p && p.sourceLine, 200)
      if (line) handledLines.add(line)
    }
  }
  // 被 AI 认领成新段的那几行，从"没看懂"里移除；其余原样留着
  if (handledLines.size) {
    result.unparsed = (result.unparsed || []).filter((l) => !handledLines.has(String(l || '').trim()))
  }
  segs.forEach(refreshPlain)
  result.segments = segs
  result.issues = sanityCheck(segs, { today })
  return { ok: true, filled, added, result }
}

// 截图识字（多模态）：结果文本交给调用方填进输入框，不自动解析
export async function extractTextFromImage(dataUrl, { cfg } = {}) {
  const conf = cfg || loadModelConfig()
  if (!isConfigured(conf)) return { ok: false, reason: 'not-configured' }
  if (!conf.vision) return { ok: false, reason: 'no-vision' }
  const messages = [
    { role: 'system', content: '你是 OCR 助手。只输出图片里的文字，按行原样抄录，不要解释、不要翻译、不要加任何评论。' },
    { role: 'user', content: [
      { type: 'text', text: '把这张车票 / 行程截图里的文字逐行抄出来。' },
      imageContent(dataUrl),
    ] },
  ]
  const r = await chat(messages, { cfg: conf, temperature: 0 })
  if (!r.ok) return r
  return { ok: true, text: String(r.content || '').trim() }
}

// 统一入口：跑一次模型补全，返回 { ok, patches, summary } | { ok:false, reason }
export async function runAssist(result, { cfg, today, fallbackDate } = {}) {
  const conf = cfg || loadModelConfig()
  if (!isConfigured(conf)) return { ok: false, reason: 'not-configured' }
  if (!hasWork(result)) return { ok: false, reason: 'nothing-to-do' }
  const messages = buildAssistMessages(result, { today, fallbackDate })
  const r = await chat(messages, { cfg: conf, temperature: 0 })
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail }
  const patches = parseJsonLoose(r.content)
  if (!patches) return { ok: false, reason: 'bad-json' }
  const summary = summarizePatches(result, patches)
  if (!summary.count) return { ok: false, reason: 'nothing-found' }
  return { ok: true, patches, summary, via: r.via }
}