// 导出：把行程变成「日历文件」和「一张长图」。
// 两个都零依赖：.ics 手写 RFC5545；长图用 canvas 2D 手绘（不引 html2canvas）。
//
// 时间策略：.ics 一律写"浮点本地时间"（DTSTART:20261008T093000，不带 Z、不带 TZID）。
// 家庭行程基本在同城/邻城，浮点时间足以让手机日历显示正确；这样也避开了时区库依赖。

const pad2 = (n) => String(n).padStart(2, '0')
const TYPE_NAME = { train: '列车', flight: '航班', hotel: '酒店', taxi: '接送' }

function addDays(s, n) {
  const [y, m, d] = String(s).split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
}
const compactDate = (s) => String(s || '').replace(/-/g, '')
const compactTime = (t) => {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  if (!Number.isFinite(h)) return ''
  return pad2(h) + pad2(m || 0) + '00'
}
function stampUTC(date) {
  const d = date || new Date()
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
// RFC5545 转义：反斜杠、分号、逗号、换行
const esc = (v) => String(v == null ? '' : v)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
// 长行折行（RFC5545 建议每 75 字节折一次）
function fold(line) {
  if (line.length <= 74) return line
  const out = []
  let s = line
  out.push(s.slice(0, 74))
  s = s.slice(74)
  while (s.length > 73) { out.push(' ' + s.slice(0, 73)); s = s.slice(73) }
  if (s.length) out.push(' ' + s)
  return out.join('\r\n')
}

function segTitle(seg) {
  const t = (seg.plain && seg.plain.title) || TYPE_NAME[seg.type] || '行程'
  return seg.code && !t.includes(seg.code) ? `${seg.code} ${t}`.trim() : t
}
function segDesc(seg) {
  const bits = []
  if (seg.plain && seg.plain.voice) bits.push(seg.plain.voice)
  const tips = (seg.plain && seg.plain.tips) || []
  for (const tip of tips) bits.push('· ' + tip)
  if (seg.note) bits.push('备注：' + seg.note)
  return bits.join('\n')
}

function eventLines(seg, stamp) {
  const uid = `${seg.id || 'seg'}@ancheng`
  const head = ['BEGIN:VEVENT', `UID:${esc(uid)}`, `DTSTAMP:${stamp}`]
  const tail = ['END:VEVENT']
  const ride = seg.type === 'train' || seg.type === 'flight' || seg.type === 'taxi'

  if (seg.type === 'hotel') {
    const start = seg.date || ''
    if (!start) return null
    const nights = Math.max(1, Number(seg.hotelNights) || 1)
    const lines = [
      ...head,
      `DTSTART;VALUE=DATE:${compactDate(start)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(start, nights))}`,
      fold(`SUMMARY:${esc('住 · ' + ((seg.plain && seg.plain.title) || seg.to || '酒店'))}`),
    ]
    if (seg.to) lines.push(fold(`LOCATION:${esc(seg.to)}`))
    const d = segDesc(seg)
    if (d) lines.push(fold(`DESCRIPTION:${esc(d)}`))
    return [...lines, ...tail]
  }

  if (seg.manualConfirm || !seg.date || !seg.departTime || !ride) {
    // 缺时刻：退化成全天事件，保证能导进去（不硬编一个假时间）
    if (!seg.date) return null
    const lines = [
      ...head,
      `DTSTART;VALUE=DATE:${compactDate(seg.date)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(seg.date, 1))}`,
      fold(`SUMMARY:${esc(segTitle(seg))}`),
    ]
    const loc = [seg.from, seg.to].filter(Boolean).join(' → ')
    if (loc) lines.push(fold(`LOCATION:${esc(loc)}`))
    const d = segDesc(seg)
    if (d) lines.push(fold(`DESCRIPTION:${esc(d)}`))
    return [...lines, ...tail]
  }

  const startStamp = compactDate(seg.date) + 'T' + compactTime(seg.departTime)
  let endDate = seg.date
  if (seg.arriveTime) {
    if (seg.arriveNextDay) endDate = addDays(seg.date, 1)
    else if (seg.arriveTime < seg.departTime) endDate = addDays(seg.date, 1)
  }
  const endStamp = seg.arriveTime ? compactDate(endDate) + 'T' + compactTime(seg.arriveTime) : null

  const lines = [
    ...head,
    `DTSTART:${startStamp}`,
    ...(endStamp ? [`DTEND:${endStamp}`] : []),
    fold(`SUMMARY:${esc(segTitle(seg))}`),
  ]
  const loc = [seg.from, seg.to].filter(Boolean).join(' → ')
  if (loc) lines.push(fold(`LOCATION:${esc(loc)}`))
  const d = segDesc(seg)
  if (d) lines.push(fold(`DESCRIPTION:${esc(d)}`))
  // 火车/飞机：出发前 2 小时提醒（提醒语用 keep it short）
  if (seg.type === 'train' || seg.type === 'flight') {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${esc('快出发了：' + segTitle(seg))}`),
      'TRIGGER:-PT2H',
      'END:VALARM',
    )
  }
  return [...lines, ...tail]
}

// 纯函数：给单测直接断言字符串结构
export function buildIcs(trip, { now } = {}) {
  const stamp = stampUTC(now)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ancheng//Trip//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  for (const seg of ((trip && trip.segments) || [])) {
    const ev = eventLines(seg, stamp)
    if (ev) lines.push(...ev)
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

function fileBase(trip) {
  const d = (trip && trip.startDate) || ''
  return `安程-${(trip && trip.title) || '行程'}${d ? '-' + d : ''}`.replace(/[\\/:*?"<>|]/g, '_')
}
function triggerDownload(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function downloadIcs(trip, { now } = {}) {
  const blob = new Blob([buildIcs(trip, { now })], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  triggerDownload(url, fileBase(trip) + '.ics')
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---- 行程长图：canvas 2D 手绘，视觉对齐长辈端卡片（大字、硬边、等宽数字）----
// 统一走「行数组」这一层：子女端从 segment 取行，长辈端从卡片取行，绘制逻辑只有一份。
export function posterRowsFromSegments(trip) {
  return ((trip && trip.segments) || []).map((seg) => ({
    title: segTitle(seg),
    route: [seg.from, seg.to].filter(Boolean).join('  →  '),
    line: `${seg.date || '日期待定'}${seg.departTime ? '  ' + seg.departTime + ' 出发' : ''}${seg.arriveTime ? '  ' + seg.arriveTime + ' 到' : ''}`,
  }))
}

// 长辈端卡片 → 长图行（卡片字段是给长辈看的口径，直接复用）
export function posterRowsFromCards(cards) {
  return (cards || []).map((c) => {
    const bits = []
    if (c.date) bits.push(c.date)
    if (c.depart && c.arrive) bits.push(`${c.depart} - ${c.arrive}${c.arriveNextDay ? '（次日）' : ''}`)
    else if (c.depart) bits.push(`${c.depart} 出发`)
    else if (c.arrive) bits.push(`${c.arrive} 到`)
    return {
      title: [c.title, c.to && !String(c.title || '').includes(c.to) ? c.to : ''].filter(Boolean).join('  ') || '行程',
      route: c.from ? `${c.from}  →  ${c.to || ''}` : (c.to || ''),
      line: bits.join('  '),
    }
  })
}

// 通用绘制：一份 canvas，两种数据来源共用（子女端 / 长辈端）
export function renderPoster({ title, sub, rows, foot } = {}) {
  const W = 1080
  const PAD = 64
  const list = rows || []
  const headH = 260
  const rowH = 168
  const footH = 96
  const H = headH + Math.max(1, list.length) * rowH + footH
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#F6F7F5'
  ctx.fillRect(0, 0, W, H)

  // 页头
  ctx.fillStyle = '#0B6B45'
  ctx.fillRect(0, 0, W, 12)
  ctx.fillStyle = '#101210'
  ctx.font = '700 60px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillText(title || '家人出行', PAD, 130)
  ctx.fillStyle = '#5E635A'
  ctx.font = '400 30px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillText(sub || `一共 ${list.length} 段`, PAD, 186)

  // 分段卡片
  let y = headH
  for (const r of list) {
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(PAD, y, W - PAD * 2, rowH - 24)
    ctx.fillStyle = '#0B6B45'
    ctx.fillRect(PAD, y, 8, rowH - 24)
    ctx.fillStyle = '#101210'
    ctx.font = '700 40px "PingFang SC","Microsoft YaHei",sans-serif'
    ctx.fillText(r.title || '', PAD + 32, y + 60)
    ctx.fillStyle = '#3E423C'
    ctx.font = '400 32px "PingFang SC","Microsoft YaHei",sans-serif'
    if (r.route) ctx.fillText(r.route, PAD + 32, y + 106)
    ctx.fillStyle = '#5E635A'
    ctx.font = '400 28px ui-monospace,Menlo,Consolas,monospace'
    if (r.line) ctx.fillText(r.line, PAD + 32, y + 140)
    y += rowH
  }

  ctx.fillStyle = '#5E635A'
  ctx.font = '400 24px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillText(foot || '安程 · 长按保存到相册，给长辈看', PAD, H - 40)
  return canvas
}

export function renderTripPoster(trip) {
  return renderPoster({
    title: (trip && trip.title) || '家人出行',
    sub: `一共 ${posterRowsFromSegments(trip).length} 段 · ${(trip && trip.startDate) || ''}`,
    rows: posterRowsFromSegments(trip),
  })
}

export function downloadTripPoster(trip) {
  const canvas = renderTripPoster(trip)
  triggerDownload(canvas.toDataURL('image/png'), fileBase(trip) + '.png')
}

// 长辈端「存成长图」：数据来自卡片，标题沿用同一套文件名规则
export function downloadCardsPoster(cards, { title } = {}) {
  const rows = posterRowsFromCards(cards)
  const canvas = renderPoster({ title: title || '家人出行', sub: `一共 ${rows.length} 段`, rows })
  const name = `安程-${title || '行程'}.png`.replace(/[\\/:*?"<>|]/g, '_')
  triggerDownload(canvas.toDataURL('image/png'), name)
  return canvas
}
