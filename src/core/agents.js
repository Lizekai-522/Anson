// 三智能体串行管线：① 解析（口语中文 → 结构化）→ ② 翻译（黑话 → 人话）→ ③ 合理性检查。
// 这是整个应用的心脏。解析和翻译可以尽力而为，
// 但合理性检查是产品唯一的道德底线：
//   错误的行程信息，可能让 70 岁的老人凌晨 3 点站在火车站等一趟不存在的车。
//   宁可标「待人工确认」，也不给一个看起来很确定的错误答案。
//
// 纯 JS、零 import —— node 可直接测试。时间钳制但不替用户做语义决定：
// 平年 2 月 29 日保留字面日期，绝不悄悄改成 3 月 1 日。

// ---------- 基础工具 ----------
const pad2 = (n) => String(n).padStart(2, '0')
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const fmtYMD = (y, m, dd) => `${y}-${pad2(m)}-${pad2(dd)}`

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 }
function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}
function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return dateStr(dt)
}
function weekdayCN(d) { return '日一二三四五六'[d.getDay()] }
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
function timeCN(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return m ? `${h}点${m}分` : `${h}点整`
}
const CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const WEEK_MAP = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

// ---------- ① 解析智能体：日期 ----------
// 返回 { date:'YYYY-MM-DD'|null, literal, invalid } | null
export function parseDatePhrase(text, today) {
  const [ty, tm, td] = today.split('-').map(Number)

  // 相对日：明天/后天/大后天
  const rel = text.match(/大后天|后天|明天/)
  if (rel) {
    const n = rel[0] === '明天' ? 1 : rel[0] === '后天' ? 2 : 3
    return { date: addDays(today, n), literal: rel[0], invalid: false }
  }

  // 周X / 星期X / 礼拜X / 下周X
  const wk = text.match(/(下(?:下)?(?:周|星期|礼拜))?[周星期礼拜]([日天一二三四五六])/)
  if (wk) {
    const target = WEEK_MAP[wk[2]]
    const dow = new Date(ty, tm - 1, td).getDay()
    let diff = (target - dow + 7) % 7
    if (diff === 0) diff = 7
    if (wk[1]) diff += 7
    if (wk[1] && wk[1].startsWith('下下')) diff += 7
    return { date: addDays(today, diff), literal: wk[0], invalid: false }
  }

  // 完整年：2026年10月8日 / 2026-10-08 / 2026.10.8
  let m = text.match(/(\d{4})[年.\-/](\d{1,2})[月.\-/](\d{1,2})[日号]?/)
  if (m) return makeDate(+m[1], +m[2], +m[3], m[0])

  // 月日：10月8号 / 10月8日（年份取 today 所在年）
  m = text.match(/(\d{1,2})月(\d{1,2})[日号]?/)
  if (m) return makeDate(ty, +m[1], +m[2], m[0])

  // 小数式：10.8。刻意不用后行/前行断言 —— Safari <16.4 不支持 lookbehind，
  // 会让整条日期解析静默失效。改用「前一个非数字字符」捕获组 + 结尾边界。
  m = text.match(/(^|[^\d.])(\d{1,2})\.(\d{1,2})(?=$|[^\d.])/)
  if (m) return makeDate(ty, +m[2], +m[3], m[2] + '.' + m[3])

  // 只有几号：8号（结合上下文取今天月份，已过则推下月）
  m = text.match(/(^|[^\d])(\d{1,2})[号](?=$|[^\d])/)
  if (m) {
    const dayN = +m[2]
    let mo = tm
    if (dayN < td) mo = tm === 12 ? 1 : tm + 1
    const yy = tm === 12 && mo === 1 ? ty + 1 : ty
    return makeDate(yy, mo, dayN, m[2] + '号')
  }

  // 农历口语：初八 —— 识别但换算不了，保留字面并标记，绝不编一个公历日期
  m = text.match(/[七八九]?月?初([一二三四五六七八九十])/)
  if (m) return { date: null, literal: m[0], invalid: true }

  return null
}

function makeDate(y, mo, d, literal) {
  const okLen = mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
  if (!okLen) {
    // 平年 2 月 29 日等：保留字面，date 置空，绝不静默改成 3 月 1 日
    return { date: null, literal, invalid: true }
  }
  return { date: fmtYMD(y, mo, d), literal, invalid: false }
}

// ---------- ① 解析智能体：时刻 ----------
// 内部版：返回 { time:'HH:MM'|null, clamped, literal }
function parseTimeFull(text) {
  const re = /(?:(凌晨|早上|清晨|上午|中午|下午|午后|傍晚|晚上|夜里))?\s*(\d{1,2})[点:：时](\d{1,2})?分?(半)?/g
  let m
  while ((m = re.exec(text))) {
    let h = +m[2]
    let min = m[4] ? 30 : (m[3] != null ? +m[3] : 0)
    const p = m[1]
    if (p === '下午' || p === '午后' || p === '傍晚') { if (h < 12) h += 12 }
    else if (p === '晚上' || p === '夜里') { if (h < 12) h += 12; else if (h === 12) h = 0 }
    else if (p === '中午') { if (h <= 2) h += 12 }
    // 凌晨/早上/上午：原样
    const clamped = h > 23 || min > 59
    if (h > 23) { h = 23; min = 59 }
    if (min > 59) min = 59
    return { time: `${pad2(h)}:${pad2(min)}`, clamped, literal: m[0] }
  }
  return { time: null, clamped: false, literal: null }
}

export function parseTimePhrase(s) {
  return parseTimeFull(s).time
}

// ---------- 站名 / 城市 ----------
const STATION_ALIAS = {
  '虹桥': '上海虹桥站', '虹桥站': '上海虹桥站', '上海虹桥': '上海虹桥站',
  '浦东': '上海浦东国际机场', '浦东机场': '上海浦东国际机场', '浦东国际机场': '上海浦东国际机场',
  '首都机场': '北京首都国际机场', '大兴机场': '北京大兴国际机场',
  '白云机场': '广州白云国际机场', '宝安机场': '深圳宝安国际机场',
  '萧山机场': '杭州萧山国际机场', '双流机场': '成都双流国际机场', '天府机场': '成都天府国际机场',
  '北京南': '北京南站', '北京西': '北京西站', '北京朝阳': '北京朝阳站', '北京丰台': '北京丰台站',
  '上海南': '上海南站', '上海西': '上海西站',
  '杭州东': '杭州东站', '南京南': '南京南站', '广州南': '广州南站', '深圳北': '深圳北站',
  '西安北': '西安北站', '成都东': '成都东站', '重庆北': '重庆北站', '武汉站': '武汉站',
  '长沙南': '长沙南站', '郑州东': '郑州东站', '天津西': '天津西站', '济南西': '济南西站',
  '合肥南': '合肥南站', '福州南': '福州南站', '厦门北': '厦门北站', '昆明南': '昆明南站',
  // 常见机场：用户往往只写机场简称（不以"机场"结尾也能认出来）
  '长水机场': '昆明长水国际机场', '龙洞堡机场': '贵阳龙洞堡国际机场',
  '咸阳机场': '西安咸阳国际机场', '胶东机场': '青岛胶东国际机场',
  '新郑机场': '郑州新郑国际机场', '天河机场': '武汉天河国际机场',
  '黄花机场': '长沙黄花国际机场', '禄口机场': '南京禄口国际机场',
  '桃仙机场': '沈阳桃仙国际机场', '周水子机场': '大连周水子国际机场',
  '地窝堡机场': '乌鲁木齐地窝堡国际机场', '龙嘉机场': '长春龙嘉国际机场',
  '滨海机场': '天津滨海国际机场', '两江机场': '桂林两江国际机场',
  // 常见车站：站名不带方位字，补站规则兜不住
  '武昌': '武昌站', '汉口': '汉口站', '广州白云': '广州白云站', '深圳坪山': '深圳坪山站',
}
const CITIES = [
  '乌鲁木齐', '呼和浩特', '石家庄', '哈尔滨', '齐齐哈尔', '鄂尔多斯', '西双版纳',
  '北京', '上海', '天津', '重庆', '广州', '深圳', '杭州', '南京', '成都', '武汉', '西安',
  '长沙', '郑州', '苏州', '无锡', '合肥', '福州', '厦门', '济南', '青岛', '南昌', '南宁',
  '昆明', '贵阳', '兰州', '西宁', '银川', '拉萨', '海口', '三亚', '大连', '沈阳', '长春',
  '宁波', '温州', '绍兴', '嘉兴', '常州', '镇江', '南通', '徐州', '烟台', '潍坊', '洛阳',
  '太原', '珠海', '佛山', '东莞', '泉州', '漳州', '桂林', '绵阳', '宜昌', '襄阳', '岳阳',
].sort((a, b) => b.length - a.length)

export function normalizeStation(name) {
  if (!name) return ''
  let s = String(name).trim().replace(/\s+/g, '')
  if (STATION_ALIAS[s]) return STATION_ALIAS[s]
  if (!/[站场]$/.test(s) && /(东|西|南|北|虹桥|朝阳|丰台)$/.test(s)) s += '站'
  return s
}

export function guessCity(text) {
  if (!text) return null
  const t0 = String(text).trim()
  const t = STATION_ALIAS[t0] || t0
  for (const c of CITIES) if (t.startsWith(c) || t.includes(c)) return c
  return null
}

// ---------- 逐行解析 ----------
const RE_FLIGHT_CODE = /\b([A-Z0-9]{2}\d{3,4})\b/
const RE_TRAIN_CODE = /\b([GDCKTZY]\d{1,4})\s*次?/
const RE_ARROW = /\s*(?:→|->|—>|=>|－>|—|–|至)\s*/

function extractFromTo(line) {
  // 关系词（返程/回程/去程/往返）只表达方向语义，不参与站点文本，先剥掉再抽站点
  const work = line.replace(/返程|回程|去程|往返/g, '')
  let from = null, to = null
  let m = work.match(/从\s*([^\s到→至，,。;；]{2,16}?)\s*(?:到|→|->|至)\s*([^\s，,。;；]{2,16}?)(?=[\s，,。;；]|$|发|开|起飞|到)/)
  if (m) { from = m[1]; to = m[2] }
  else if (RE_ARROW.test(work)) {
    const parts = work.split(RE_ARROW)
    if (parts.length >= 2) {
      from = cleanSpot(parts[parts.length - 2])
      to = cleanSpot(parts[parts.length - 1])
    }
  } else {
    m = work.match(/(?:^|[\s，,])([^\s到→至，,]{2,16}?)\s*到\s*([^\s，,。;；]{2,16}?)(?=[\s，,。;；]|$|发|开|到)/)
    if (m) { from = m[1]; to = m[2] }
  }
  return { from: from ? cleanSpot(from) : null, to: to ? cleanSpot(to) : null }
}

function cleanSpot(s) {
  if (!s) return null
  let t = s
    .replace(/\d{4}[年.\-/]\d{1,2}[月.\-/]\d{1,2}[日号]?/g, '')
    .replace(/\d{1,2}月\d{1,2}[日号]?/g, '')
    .replace(/\d{1,2}[点:：时]\d{0,2}分?半?/g, '')
    .replace(/\d{1,2}:\d{2}/g, '')
    .replace(/\d{1,2}[号]/g, '')
    .replace(/\d{1,2}\.\d{1,2}/g, '')
    .replace(/(明天|后天|大后天|今天|次日|当天|第[一二三四五六七八九十\d]+天|下?[周星期礼拜][日天一二三四五六])/g, '')
    .replace(/[GDCKTZY]\d{1,4}次?/g, '')
    .replace(/[A-Z0-9]{2}\d{3,4}/g, '')
    .replace(/(早上|上午|中午|下午|晚上|凌晨|高铁|动车|航班|火车|列车|次|发车|起飞|到达|降落|入住|住一晚|两晚|\d晚)/g, '')
    .replace(/^[到从去飞返\s\-—>]+|[到从去飞返\s\-—>]+$/g, '')
  // 站名里不该有空格（「上海 虹桥」→「上海虹桥」），统一收掉
  t = t.replace(/\s+/g, '').trim()
  return t || null
}

function extractHotelName(line) {
  const m = line.match(/(?:入住|住)\s*([^\s，,。;；]+)/)
  if (m && !/^[一两二三四五六七八九十\d]+晚$/.test(m[1])) return m[1]
  const bare = line.match(/([\u4e00-\u9fa5A-Za-z0-9]+(?:酒店|宾馆|民宿|旅馆)[^\s，,。;；]*)/)
  return bare ? bare[1] : null
}

function extractNights(line) {
  const m = line.match(/([一两二三四五六七八九十\d])晚/)
  if (!m) return null
  const c = m[1]
  return CN_NUM[c] != null ? CN_NUM[c] : (+c || null)
}

const OCR_RE = /截图|照片|图片|票图|ocr/i

// ---------- 游玩 / 安排（activity）的通用识别 ----------
// 只用**结构性词汇**：时段、动作、方位。示例里的具体景点/街区/酒店名一律不进代码。
const TIME_OF_DAY_WORDS = ['清晨', '早上', '上午', '中午', '下午', '午后', '傍晚', '晚上', '夜里', '凌晨']
const RE_TIME_OF_DAY = new RegExp(TIME_OF_DAY_WORDS.join('|'))
// 这些词出现就说明不是"游玩安排"（交通/住宿/接送），交给原有分支
const RE_TRANSPORT_WORD = /火车|高铁|动车|列车|乘车|车次|航班|飞机|航空|航站楼|登机|起飞|降落|机场|酒店|宾馆|民宿|旅馆|入住|打车|出租车|网约车|接站|接机|送机|送站|站/
// 动作结构词：说明这一行在讲"到了之后做什么"
const RE_ACT_VERB = /去|前往|逛|游|玩|参观|打卡|散步|休息|吃饭|午餐|晚餐|入住后|到[^，,。;；]{0,8}后/

// 取首个时段词（'午后' 归一为 '下午'，与卡片展示口径一致）
function matchTimeOfDay(text) {
  const m = String(text || '').match(RE_TIME_OF_DAY)
  if (!m) return ''
  return m[0] === '午后' ? '下午' : m[0]
}

// 「小标题：说明」形态（分隔符 ：/:/·），冒号后非空才算
function splitSubtitle(text) {
  const m = String(text || '').match(/^([^：:·]{1,12})[：:·]\s*(.+)$/)
  if (!m) return null
  const head = m[1].trim()
  const tail = m[2].trim()
  if (!head || !tail) return null
  if (RE_TRANSPORT_WORD.test(tail)) return null
  return { head, tail }
}

// 从「去 X / 到 X / 在 X / 逛 X」这类通用结构里抽地点；抽不到返回 ''
function extractActivityPlace(text) {
  const m = String(text || '').match(/(?:去|前往|至|到|在|逛|游|玩|参观|打卡)\s*([^\s，,。;；、]{2,16})/)
  if (!m) return null
  const t = m[1]
    .replace(/(之后|以后|后|看看|逛逛|玩玩|散步|游玩|玩|吃饭|午餐|晚餐|打卡|参观)?$/,'')
    .replace(/[的了着]/g, '')
    .trim()
  return t || null
}

// parseSegments：逐行归段。返回 { segments, unparsed, issues }
export function parseSegments(rawText, { today, fallbackDate = null } = {}) {
  const lines = String(rawText || '').split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const segments = []
  const unparsed = []
  const issues = []
  let seq = 0

  for (const line of lines) {
    // 关系词：第二天/次日 → 相对上一段日期。第 N 天 = 从上一段当天算第 N 天，即 +（N-1）
    let work = line
    let relOffset = 0
    const rel = work.match(/^(第([一二三四五六七八九十\d]+)天|次日|隔天|当天|同天|Day\s*(\d+))/i)
    if (rel) {
      if (rel[0] === '次日' || rel[0] === '隔天') relOffset = 1
      else if (rel[0] === '当天' || rel[0] === '同天') relOffset = 0
      else if (rel[3] != null) relOffset = Math.max(1, (+rel[3] || 1) - 1)
      else {
        const nDay = CN_NUM[rel[2]] != null ? CN_NUM[rel[2]] : (+rel[2] || 1)
        relOffset = Math.max(1, nDay - 1)
      }
      work = work.slice(rel[0].length)
    }

    const dateInfo = parseDatePhrase(work, today)
    const { time: t1, clamped, literal: t1lit } = parseTimeFull(work)
    let times = [t1]
    if (t1) {
      // 找第二个时刻（到达）
      const rest = work.indexOf(t1lit) >= 0 ? work.slice(work.indexOf(t1lit) + t1lit.length) : ''
      const second = rest ? parseTimeFull(rest) : { time: null }
      times = [t1, second.time]
    }

    const mentionsOcr = OCR_RE.test(work)
    const isFlight = /航班|飞机|航空|航站楼|机场|起飞|降落|登机/.test(work) || (RE_FLIGHT_CODE.test(work) && !RE_TRAIN_CODE.test(work) && /机场|航站楼/.test(work))
    // 打车优先于酒店判断：『到站后打车去酒店』里出现"酒店"不代表这是住宿段
    const isTaxi = /打车|出租车|网约车|接站|接机|送机|送站/.test(work) && !isFlight
    const isHotel = /酒店|宾馆|民宿|旅馆|入住|住[一两二三四五六七八九十\d]?晚/.test(work) && !isFlight && !isTaxi

    // ---- 游玩 / 安排（activity）：交通与住宿优先，剩下的才看这里 ----
    // 有「时段词」且通篇没有任何交通/住宿词 → 这是在讲"到了之后做什么"，
    // 不能被 isTrain 的时间兜底（\d点）抢走变成一段空站名的"列车"。
    const timeOfDay = matchTimeOfDay(work)
    const subtitle = splitSubtitle(work)
    const noTransportWord = !RE_TRANSPORT_WORD.test(work)
    const activityish = noTransportWord && (timeOfDay !== '' || !!subtitle || RE_ACT_VERB.test(work))

    const isTrain = !isFlight && !isHotel && !isTaxi && !activityish && (/火车|高铁|动车|列车|乘车|车次/.test(work) || RE_TRAIN_CODE.test(work) || /站/.test(work) || /\d{1,2}[点:：时]/.test(work))

    let seg = null
    let mergedProse = false
    const { from, to } = extractFromTo(work)

    if (isFlight) {
      const codeM = work.match(RE_FLIGHT_CODE)
      seg = baseSeg('flight', ++seq, line)
      seg.code = codeM ? codeM[1] : null
      seg.from = normalizeStation(from || findAirport(work, true) || '')
      seg.to = normalizeStation(to || findAirport(work, false) || '')
      const term = work.match(/T([1-3])/)
      if (term) seg.note = `航站楼 T${term[1]}`
      const seat = work.match(/(经济舱|公务舱|商务舱|头等舱)/)
      seg.seatClass = seat ? seat[1] : null
    } else if (isTaxi) {
      seg = baseSeg('taxi', ++seq, line)
      // 『到杭州东站后打车去西湖』：站/机场为出发点，打车目的地为到达点
      const taxiFrom = work.match(/([^\s，,。]{2,12}(?:站|机场))/)
      const taxiTo = work.match(/打车(?:去|到|前往)\s*([^\s，,。]{2,12})/)
      seg.from = normalizeStation(taxiFrom ? taxiFrom[1] : (from || ''))
      seg.to = taxiTo ? taxiTo[1] : (to ? normalizeStation(to) : '')
    } else if (isHotel) {
      seg = baseSeg('hotel', ++seq, line)
      const nights = extractNights(work)
      seg.hotelNights = nights ?? 1
      seg.hotelNightsExplicit = nights != null
      seg.to = extractHotelName(work) || ''
      seg.from = ''
    } else if (isTaxi) {
      seg = baseSeg('taxi', ++seq, line)
      seg.from = from ? normalizeStation(from) : ''
      seg.to = to ? normalizeStation(to) : ''
    } else if (isTrain) {
      const codeM = work.match(RE_TRAIN_CODE)
      seg = baseSeg('train', ++seq, line)
      seg.code = codeM ? codeM[1] : null
      seg.from = normalizeStation(from || '')
      seg.to = normalizeStation(to || '')
      const seat = work.match(/(商务座|一等座|二等座|软卧|硬卧|硬座|站票)/)
      seg.seatClass = seat ? seat[1] : null
    } else if (activityish) {
      // 游玩 / 安排：讲的是"到这里做什么"，不是"从哪到哪"
      seg = baseSeg('activity', ++seq, line)
      seg.timeOfDay = timeOfDay
      seg.from = ''
      seg.to = extractActivityPlace(work) || ''
      // 找得到小标题就用它当卡片标题；找不到就退回地点
      seg.titleHint = (subtitle && subtitle.head) || ''
      // 攻略原文原样留档，长辈端"展开看"能读到
      seg.note = (subtitle && subtitle.tail) || work
      // 既没地点也没标题 → 让用户手工补
      if (!seg.to && !seg.titleHint) seg.manualConfirm = true
    }

    if (seg) {
      // 日期：行内 > 关系词 > 继承上一段 > fallbackDate > 缺失
      if (dateInfo) {
        seg.dateLiteral = dateInfo.literal
        seg.dateInvalid = dateInfo.invalid
        seg.date = dateInfo.date
        if (dateInfo.invalid) {
          seg.manualConfirm = true
          issues.push(issue('warn', 'date-invalid', `「${dateInfo.literal}」这种日期写法换算不出确定的公历日期，已保留你的写法，请确认。`, seg.id))
        }
      } else if (relOffset && segments.length) {
        const base = lastDated(segments)
        if (base && base.date) seg.date = addDays(base.date, relOffset)
        else seg.date = fallbackDate
      } else if (segments.length) {
        const base = lastDated(segments)
        seg.date = base && base.date ? base.date : fallbackDate
      } else if (fallbackDate) {
        seg.date = fallbackDate
      } else {
        issues.push(issue('info', 'missing-date', '这一条没看出日期，导入后请补上。', seg.id))
      }

      // 时刻
      if (seg.type !== 'hotel') {
        seg.departTime = times[0]
        seg.arriveTime = times[1] || null
      }
      if (clamped && seg.type !== 'hotel') {
        seg.departTime = '23:59'
        seg.manualConfirm = true
        issues.push(issue('warn', 'time-clamped', `「${t1lit}」不是合法时刻，已钳制为 23:59，请人工确认真实时间。`, seg.id))
      }
      if (mentionsOcr) {
        seg.manualConfirm = true
        issues.push(issue('warn', 'manual-confirm', '原文提到截图/照片，当前没有配置图像识别，请人工核对这一条。', seg.id))
      }
      if (seg.type === 'train' || seg.type === 'flight') {
        seg.fromCity = guessCity(seg.from)
        seg.toCity = guessCity(seg.to)
      }
      segments.push(seg)
    } else {
      // 长句散文（没有交通/住宿特征、也不是明确的安排句，只是较长的一句说明）：
      // 不丢原文 —— 并进上一段「游玩安排」的说明里；上一段不是安排就单开一段待确认。
      if (noTransportWord && work.length >= 12) {
        const prev = segments[segments.length - 1]
        if (prev && prev.type === 'activity') {
          prev.note = prev.note ? prev.note + '；' + work : work
          mergedProse = true
        } else {
          const s = baseSeg('activity', ++seq, line)
          s.note = work
          s.manualConfirm = true
          seg = s
        }
      }

      // 中转/经停行：归一后附加到上一段
      const transfer = mergedProse || seg ? null : work.match(/中转(?:\s*(\d+)\s*小时)?(?:\s*(\d+)\s*分钟?)?|经停\s*([^\s，,]{2,10})?/)
      if (transfer && segments.length) {
        const prev = segments[segments.length - 1]
        let label
        if (transfer[0].startsWith('经停')) label = `经停${transfer[3] || ''}`
        else {
          const h = transfer[1] ? +transfer[1] : 0
          const mi = transfer[2] ? +transfer[2] : 0
          label = h || mi ? `中转${h ? h + '小时' : ''}${mi ? mi + '分钟' : ''}` : '中转'
        }
        prev.note = (prev.note ? prev.note + '；' : '') + label
      } else if (!seg && !mergedProse) {
        unparsed.push(line)
      }
    }
  }

  return { segments, unparsed, issues }
}

function baseSeg(type, seq, sourceLine) {
  return {
    id: `seg${seq}_${Date.now().toString(36)}${seq}`,
    type, date: null, dateLiteral: null, dateInvalid: false,
    departTime: null, arriveTime: null, arriveNextDay: false,
    from: '', to: '', fromCity: null, toCity: null,
    code: null, seatClass: null, hotelNights: null, hotelNightsExplicit: false, note: null,
    // 时段（早上/下午…）与「到了之后做什么」清单：所有段都有，交通段一般留空
    timeOfDay: '', todos: [],
    // 「出站后往哪走」到达指引：子女填，长辈端卡片展开区置顶显示
    guide: '',
    // 游玩段的小标题（「小标题：说明」里的前半句）：只在生成人话标题时用，不进链接
    titleHint: '',
    sourceLine, manualConfirm: false,
    plain: { title: '', depart: '', arrive: '', voice: '', tips: [] },
  }
}
function lastDated(segs) { for (let i = segs.length - 1; i >= 0; i--) if (segs[i].date) return segs[i]; return null }
function issue(level, code, message, segId = null) { return { level, code, message, segId } }

// 问题码 → 中文短标签。码是给程序看的，页面上一律显示中文标签
// （以前直接把 'past-date' 'missing-time' 印在界面上，用户看不懂）。
const ISSUE_LABEL = {
  'date-invalid': '日期写法',
  'missing-date': '缺日期',
  'time-clamped': '时刻有误',
  'manual-confirm': '需人工核对',
  'past-date': '日期已过',
  'arrival-gap-suspicious': '到达异常',
  'cross-midnight': '次日到达',
  'late-arrival': '凌晨到达',
  'same-city': '同城往返',
  'missing-time': '缺时间',
  'hotel-range': '住宿冲突',
  'hotel-nights-unspecified': '住宿天数',
  'activity-place-missing': '缺地点',
}
export function issueLabel(code) { return ISSUE_LABEL[code] || '' }

function findAirport(line, first) {
  const list = line.match(/[\u4e00-\u9fa5]{2,10}机场/g) || []
  const s = first ? list[0] : list[1]
  return s ? normalizeStation(s) : null
}

// ---------- ② 翻译智能体：黑话 → 人话 ----------
const CODE_TIPS = {
  G: '高铁比较快，车厢里有空调和开水，记得提前到站候车。',
  D: '动车比高铁稍慢一点，也是对号入座，放心坐。',
  C: '城际列车，就在附近城市之间跑，行程短。',
  K: '普速火车，慢一些但便宜，注意保管好行李。',
  T: '普速火车，慢一些但便宜，注意保管好行李。',
  Z: '直达火车，晚上坐可以睡一觉，保管好铺位。',
  Y: '旅游列车，沿途风景不错，看好随身的包。',
  L: '临时加开的列车，留意车站大屏确认检票口。',
}
const SEAT_TIPS = {
  二等座: '普通座位，够坐，靠窗能看到风景。',
  一等座: '更宽的座位，安静一些。',
  商务座: '最宽的座位，能躺平休息。',
  硬座: '普通座位，坐久了会累，多活动活动腿。',
  硬卧: '睡觉的铺位，分上中下铺，值钱东西放身边。',
  软卧: '更宽敞的睡觉铺位，四人间，门能关上。',
  站票: '没有固定座位，可能得站着，找列车员补卧铺试试。',
  经济舱: '普通座位，腿能伸直。',
  公务舱: '座位更宽，能半躺。',
  头等舱: '最宽的座位，服务最好。',
}
const TYPE_NAME = { train: '列车', flight: '航班', hotel: '酒店', taxi: '接送', activity: '游玩安排' }

export function translateSegment(seg) {
  const p = seg.plain
  const tips = []
  const code0 = seg.code ? seg.code[0] : null

  if (seg.type === 'train') {
    const kind = { G: '高铁', D: '动车', C: '城际', K: '快车', T: '特快', Z: '直达车', Y: '旅游列车', L: '临客' }[code0] || '列车'
    p.title = seg.code ? `${seg.code} ${kind}` : kind
    if (code0 && CODE_TIPS[code0]) tips.push(CODE_TIPS[code0])
  } else if (seg.type === 'flight') {
    p.title = seg.code ? `${seg.code} 航班` : '航班'
    tips.push('提前 2 小时到机场，带好身份证，到了先取登机牌。')
  } else if (seg.type === 'hotel') {
    p.title = `入住 ${seg.to || '酒店'}`
    tips.push('到了先办入住，报预订人姓名就能拿房卡。')
    if (seg.hotelNights && seg.hotelNights > 1) tips.push(`连住 ${seg.hotelNights} 晚，不用每天搬家。`)
  } else if (seg.type === 'activity') {
    // 标题 = 时段 + （地点 / 小标题）；两个都没有就退回通用名
    const head = seg.to || seg.titleHint || ''
    p.title = (seg.timeOfDay ? seg.timeOfDay + ' ' : '') + (head || '游玩安排')
    tips.push('照着安排走就行，走完了记得点「走完了」。')
  } else {
    p.title = '打车 / 接送'
    tips.push('上车前核对车牌号，到地方再付钱。')
  }
  if (seg.seatClass && SEAT_TIPS[seg.seatClass]) tips.push(SEAT_TIPS[seg.seatClass])
  if (seg.note && /中转/.test(seg.note)) {
    const m = seg.note.match(/中转(?:(\d+)小时)?(\d+)?分钟?/)
    const mins = m && (m[1] || m[2]) ? (+(m[1] || 0) * 60 + +(m[2] || 0)) : null
    tips.push(mins ? `要下车换乘，等 ${mins} 分钟，可能得站着。` : '要中转换乘，跟着站内「换乘」指示牌走。')
  }
  if (seg.note && /经停/.test(seg.note)) tips.push('中途停一站，不用下车，看好自己的行李。')

  p.title = p.title.trim()
  p.depart = seg.type === 'hotel'
    ? (seg.date ? `${seg.date} 办理入住` : '入住日期待确认')
    : seg.type === 'activity'
      ? (seg.departTime ? `${seg.timeOfDay || ''} ${timeCN(seg.departTime)}`.trim() : (seg.timeOfDay || ''))
      : (seg.departTime ? `${timeCN(seg.departTime)} 从 ${seg.from || '出发地'} 出发` : '出发时间待确认')
  p.arrive = seg.type === 'hotel'
    ? (seg.hotelNights ? `住 ${seg.hotelNights} 晚` : '')
    : seg.type === 'activity'
      ? (seg.to ? `在 ${seg.to}` : '')
      : (seg.arriveTime ? `${seg.arriveNextDay ? '次日 ' : ''}${timeCN(seg.arriveTime)} 到 ${seg.to || '目的地'}` : '到达时间待确认')

  p.voice = seg.type === 'hotel'
    ? `今天入住${seg.to || '酒店'}。到了先办入住，报预订人姓名就能拿房卡。`
    : seg.type === 'taxi'
      ? `${seg.date || ''} 打车从${seg.from || '出发地'}到${seg.to || '目的地'}。上车前核对车牌号。`
      : seg.type === 'activity'
        ? `这一段是安排：${seg.timeOfDay || ''}${seg.to ? '去' + seg.to : (seg.titleHint || '')}。${seg.note || ''}`
        : `你${seg.code ? '坐 ' + seg.code : '出发'}，${seg.departTime ? timeCN(seg.departTime) : '时间待定'}从${seg.from || '出发地'}出发，${seg.arriveTime ? timeCN(seg.arriveTime) : '时间待定'}到${seg.to || '目的地'}。${tips[0] || ''}`

  if (seg.manualConfirm) tips.push('这一条还需要人工确认一下，再对照原短信看看。')
  p.tips = tips
  return seg
}

// 手动新增的空段：契约与解析产物完全一致（下游长辈端/分享页无需特判）。
export function createBlankSegment(type = 'train', today) {
  const seg = baseSeg(type, 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), '手动添加')
  seg.date = today || null
  return translateSegment(seg)
}

// 手动修正后重算人话（标题/出发到达/语音/提示），保证长辈端与子女端看到的一致。
export function refreshPlain(seg) {
  if (!seg.plain || typeof seg.plain !== 'object') {
    seg.plain = { title: '', depart: '', arrive: '', voice: '', tips: [] }
  }
  return translateSegment(seg)
}

// ---------- ③ 合理性检查（道德底线，规则不许弱化） ----------
export function sanityCheck(segments, { today } = {}) {
  const issues = []
  const hotels = []
  segments.forEach((seg) => {
    if (seg.dateInvalid) {
      seg.manualConfirm = true
      issues.push(issue('warn', 'date-invalid', `「${seg.dateLiteral || ''}」这个日期不存在（比如平年没有 2 月 29 日）。已保留你的写法，请确认真实日期。`, seg.id))
    }
    if (seg.date && today && seg.date < today) {
      issues.push(issue('warn', 'past-date', `这一条的日期（${seg.date}）在过去，请确认是不是写错了。`, seg.id))
    }
    if (seg.type === 'train' || seg.type === 'flight') {
      if (seg.departTime && seg.arriveTime && toMin(seg.arriveTime) <= toMin(seg.departTime)) {
        seg.arriveNextDay = true
        const gap = 1440 - toMin(seg.departTime) + toMin(seg.arriveTime)
        if (gap > 14 * 60) {
          seg.manualConfirm = true
          issues.push(issue('warn', 'arrival-gap-suspicious', '到达比出发晚超过 14 个小时，多半是解析错了，请人工核对。', seg.id))
        } else {
          issues.push(issue('info', 'cross-midnight', '到达时间是第二天，已按过夜行程理解。', seg.id))
        }
      }
      const h = seg.arriveTime ? +seg.arriveTime.split(':')[0] : -1
      if (seg.arriveTime && h >= 0 && h < 6) {
        issues.push(issue('warn', 'late-arrival', `到达时间是凌晨 ${h} 点，长辈赶路辛苦，建议改签到白天到，或提前一天出发。`, seg.id))
      }
      if (seg.fromCity && seg.toCity && seg.fromCity === seg.toCity) {
        issues.push(issue('warn', 'same-city', '出发和到达看起来是同一个城市，请确认是不是要跨城出行。', seg.id))
      }
      if (!seg.departTime || !seg.arriveTime) {
        issues.push(issue('info', 'missing-time', '这一条缺出发或到达时间，导入后请补上。', seg.id))
      }
    }
    if (seg.type === 'hotel') {
      hotels.push(seg)
      // 原文没写明住几晚时，之前是静默按 1 晚算；现在明确提示，让用户有机会改
      if (!seg.hotelNightsExplicit) {
        issues.push(issue('info', 'hotel-nights-unspecified', '这条住宿没写住几晚，暂按 1 晚算，请确认。', seg.id))
      }
    }
    if (seg.type === 'activity') {
      // 「日期 + 地点/标题」都拿到了才算能直接给长辈看；缺地点就如实标出来
      if (!seg.to) {
        issues.push(issue('info', 'activity-place-missing', '这一段没看出具体去哪儿，导入后请补上地点。', seg.id))
      }
      if (!seg.to || !seg.date) seg.manualConfirm = true
    }
  })

  // 酒店区间冲突：下一段入住日早于上一段该退房的日期
  hotels.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  for (let i = 1; i < hotels.length; i++) {
    const prev = hotels[i - 1], cur = hotels[i]
    if (prev.date && cur.date && prev.hotelNights) {
      const checkout = addDays(prev.date, prev.hotelNights)
      if (cur.date < checkout) {
        issues.push(issue('error', 'hotel-range', `两段酒店时间对不上：上一段 ${prev.date} 住 ${prev.hotelNights} 晚，${checkout} 才退房，但下一段 ${cur.date} 就入住了。`, cur.id))
      }
    }
  }
  return issues
}

// ---------- 管线入口 ----------
export function runPipeline(rawText, opts = {}) {
  const today = opts.today || dateStr(new Date())
  const fallbackDate = opts.fallbackDate || null
  const { segments, unparsed, issues } = parseSegments(String(rawText || ''), { today, fallbackDate })
  // 先做合理性检查（它会写 arriveNextDay/manualConfirm），再做翻译 ——
  // 这样「次日到达」「待人工确认」才会烘进给人看的人话里
  const all = [...issues, ...sanityCheck(segments, { today })]
  segments.forEach(translateSegment)
  const firstDated = segments.find((s) => s.date)
  const startDate = segments.reduce((min, s) => (!s.date ? min : !min || s.date < min ? s.date : min), null)
  const title = (firstDated && firstDated.plain.title) || (segments[0] && segments[0].plain.title) || '家人出行'
  return { title, raw: String(rawText || ''), segments, issues: all, unparsed, startDate }
}

// ---------- 文本净化 ----------
// 粘贴来的短信/群消息原文常带零宽字符（U+200B~200D）、替换字符（U+FFFD）、全角空格与控制字符，
// 不净化就进卡片，长辈端看到的就是「乱码」。只净化展示与打包，不改用户原始输入。
export function sanitizeText(v) {
  if (v == null) return ''
  return String(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// ---------- 「到了之后做什么」清单：单一编解码实现 ----------
// 优先级三档，编成 0/1/2 只占一个字符；普通档（0）可以省掉不写。
export const TODO_LEVELS = ['high', 'normal', 'low']
const TODO_LEVEL_IDX = { normal: 0, high: 1, low: 2 }
const TODO_LEVEL_BY_IDX = ['normal', 'high', 'low']

function expandLevel(v) {
  const n = Number(v)
  return TODO_LEVEL_BY_IDX[Number.isInteger(n) && n >= 0 && n < 3 ? n : 0]
}

export function packTodos(todos) {
  return (todos || [])
    .map((t) => {
      const text = sanitizeText(t && t.text)
      if (!text) return null
      const lv = TODO_LEVEL_IDX[(t && t.level) || 'normal']
      const idx = lv == null ? 0 : lv
      const row = [text]
      if (idx !== 0 || (t.id && t.stableId !== false)) row.push(idx)
      if (t.id && t.stableId !== false) row.push(sanitizeText(t.id))
      return row
    })
    .filter(Boolean)
}

export function expandTodos(rows) {
  return (rows || [])
    .map((r, i) => ({
      id: Array.isArray(r) && r[2] ? sanitizeText(r[2]) : 'todo' + i,
      stableId: !!(Array.isArray(r) && r[2]),
      text: sanitizeText(Array.isArray(r) ? r[0] : r),
      level: expandLevel(Array.isArray(r) ? r[1] : 0),
    }))
    .filter((t) => t.text)
}

// ---------- 长辈端卡片（分享/长辈页共用） ----------
// 卡片同时保留结构化来源字段（type/note/hotelNights/…）：分享时它们要进链接，
// 解码后由这些字段重新推导标题、图标、播报词与提示（见下方 packCards/expandCards）。
export function buildElderCards(trip, family) {
  return (trip.segments || []).map((seg) => {
    const rawTitle = (seg.plain && seg.plain.title) || TYPE_NAME[seg.type] || ''
    // code 有独立展示位（card-code），标题里的重复车次号去掉，避免「车 G7102 G7102 高铁」
    const title = seg.code && rawTitle.startsWith(seg.code) ? rawTitle.slice(seg.code.length).trim() : rawTitle
    const code = sanitizeText(seg.code)
    return {
      kind: seg.type === 'activity' ? 'play' : seg.type === 'hotel' ? 'stay' : 'ride',
      type: seg.type,
      icon: seg.type === 'activity' ? '玩' : seg.type === 'flight' ? '飞' : seg.type === 'hotel' ? '住' : '车',
      code,
      title: sanitizeText(title),
      from: sanitizeText(seg.from),
      to: sanitizeText(seg.to),
      date: seg.date,
      depart: seg.departTime || '',
      arrive: seg.arriveTime || '',
      arriveNextDay: !!seg.arriveNextDay,
      manualConfirm: !!seg.manualConfirm,
      note: sanitizeText(seg.note),
      hotelNights: seg.hotelNights || null,
      seatClass: seg.seatClass || null,
      timeOfDay: seg.timeOfDay || '',
      todos: packTodos(seg.todos).map((r) => ({ text: r[0], level: expandLevel(r[1]), ...(r[2] ? { id: r[2], stableId: true } : {}) })),
      guide: sanitizeText(seg.guide),
      // 天气是「卡片级」信息：由子女端查好、随分享下发，放到这里只为统一字段形状
      weather: '',
      voice: (seg.plain && seg.plain.voice) || '',
      tips: (seg.plain && seg.plain.tips) || [],
      segId: seg.id,
    }
  })
}

// ---------- 分享链接用的紧凑卡（v2） ----------
// 为什么要有这一层：链接要变成二维码，码里每个字符都占模块；而播报词、提示、标题、图标
// 全都能由结构化字段重新推导 —— 它们进链接纯粹是浪费容量。实测（2 段行程）旧的完整载荷
// 链接长 1630 字符，直接超出二维码引擎上限导致"二维码不显示"。丢掉可推导字段后回到可扫范围。
//
// 字段顺序（打包/解包共用，改这里就够）：
//   [type, code, from, to, date, depart, arrive, flags, note, hotelNights, seatClass, timeOfDay, todos, guide, weather]
//   flags 位：1 = 次日到达，2 = 待人工确认
const CARD_TYPES = ['train', 'flight', 'hotel', 'taxi', 'activity']

// 尾部空格子（空串/0/空数组/空对象）裁掉，避免在 JSON 里白占字符
function isEmptyCell(v) {
  if (v === '' || v === 0 || v == null) return true
  if (Array.isArray(v)) return v.length === 0
  return false
}

export function packCards(cards) {
  return (cards || []).map((c) => {
    const row = [
      Math.max(0, CARD_TYPES.indexOf(c.type || (c.kind === 'stay' ? 'hotel' : 'train'))),
      sanitizeText(c.code),
      sanitizeText(c.from),
      sanitizeText(c.to),
      c.date || '',
      c.depart || '',
      c.arrive || '',
      (c.arriveNextDay ? 1 : 0) | (c.manualConfirm ? 2 : 0),
      sanitizeText(c.note),
      c.hotelNights || '',
      sanitizeText(c.seatClass),
      sanitizeText(c.timeOfDay),
      packTodos(c.todos),
      sanitizeText(c.guide),
      sanitizeText(c.weather),
    ]
    // 尾部空位不写进链接（数组末尾的空值在 JSON 里是纯浪费）
    while (row.length > 7 && isEmptyCell(row[row.length - 1])) row.pop()
    return row
  })
}

// 紧凑卡 → 完整卡：把字段还原成"段"的结构，再走一遍既有的 translateSegment + buildElderCards。
// 刻意不另写一套推导逻辑 —— 复用同一条管线，才不会出现"编码前和解码后不一样"。
export function expandCards(rows, ids = []) {
  const segs = (rows || []).map((c, i) => {
    const seg = baseSeg(CARD_TYPES[c[0]] || 'train', i, '')
    seg.id = typeof ids[i] === 'string' && ids[i] ? sanitizeText(ids[i]) : 'seg' + i
    seg.code = c[1] || ''
    seg.from = c[2] || ''
    seg.to = c[3] || ''
    seg.date = c[4] || null
    seg.departTime = c[5] || ''
    seg.arriveTime = c[6] || ''
    seg.arriveNextDay = !!(c[7] & 1)
    seg.manualConfirm = !!(c[7] & 2)
    seg.note = c[8] || ''
    seg.hotelNights = c[9] || null
    seg.seatClass = c[10] || null
    // 旧链接（没有这两列）解出来就是空值，行为与从前一致
    seg.timeOfDay = c[11] || ''
    seg.todos = expandTodos(c[12] || [])
    seg.guide = c[13] || ''
    return seg
  })
  segs.forEach(translateSegment)
  const cards = buildElderCards({ segments: segs })
  // 天气是卡片级字段：解码时按行号贴回卡片
  return cards.map((card, i) => ({ ...card, weather: sanitizeText((rows[i] && rows[i][14]) || '') }))
}

// ---------- 子女之间的行程「邀请包」（v3） ----------
// 与长辈卡分开：这里要的是**完整可编辑**的段，好让接收方复制成自己的新行程。
// 仍走同一套紧凑行编码 + sanitizeText，避免把脏字符带进别人的账号。
// 行：[type, code, from, to, date, depart, arrive, flags, note, hotelNights, seatClass, timeOfDay, todos, dateLiteral, guide]
// flags 位：1 = 次日到达，2 = 待人工确认，4 = 日期写法无效，8 = 住宿天数已写明
export function packInviteSegments(segments) {
  return (segments || []).map((s) => {
    const idx = CARD_TYPES.indexOf(s.type || 'train')
    const flags = (s.arriveNextDay ? 1 : 0) | (s.manualConfirm ? 2 : 0) | (s.dateInvalid ? 4 : 0) | (s.hotelNightsExplicit ? 8 : 0)
    const row = [
      Math.max(0, idx),
      sanitizeText(s.code),
      sanitizeText(s.from),
      sanitizeText(s.to),
      s.date || '',
      s.departTime || '',
      s.arriveTime || '',
      flags,
      sanitizeText(s.note),
      s.hotelNights || '',
      sanitizeText(s.seatClass),
      sanitizeText(s.timeOfDay),
      packTodos(s.todos),
      sanitizeText(s.dateLiteral),
      sanitizeText(s.guide),
    ]
    while (row.length > 7 && isEmptyCell(row[row.length - 1])) row.pop()
    return row
  })
}

// invite（{ title, startDate, segments:slimRows }）→ 与 runPipeline 同契约的 trip
// 逐条用 baseSeg 重建，重算城市与人话，再跑一遍 sanityCheck。
export function buildInviteTrip(invite, { today } = {}) {
  const rows = (invite && invite.g) || []
  const segments = rows.map((c, i) => {
    const seg = baseSeg(CARD_TYPES[c[0]] || 'train', i, '')
    seg.id = `seg${i}_${Date.now().toString(36)}${i}`
    seg.code = c[1] || null
    seg.from = c[2] || ''
    seg.to = c[3] || ''
    seg.date = c[4] || null
    seg.departTime = c[5] || null
    seg.arriveTime = c[6] || null
    const f = Number(c[7]) || 0
    seg.arriveNextDay = !!(f & 1)
    seg.manualConfirm = !!(f & 2)
    seg.dateInvalid = !!(f & 4)
    seg.hotelNightsExplicit = !!(f & 8)
    seg.note = c[8] || null
    seg.hotelNights = isEmptyCell(c[9]) ? null : Number(c[9])
    seg.seatClass = c[10] || null
    seg.timeOfDay = c[11] || ''
    seg.todos = expandTodos(c[12] || [])
    seg.dateLiteral = c[13] || null
    seg.guide = c[14] || ''
    if (seg.type === 'train' || seg.type === 'flight') {
      seg.fromCity = guessCity(seg.from)
      seg.toCity = guessCity(seg.to)
    }
    return seg
  })
  const issues = sanityCheck(segments, { today })
  segments.forEach(translateSegment)
  const startDate = segments.reduce((min, s) => (!s.date ? min : !min || s.date < min ? s.date : min), null)
  const firstDated = segments.find((s) => s.date)
  const title = (invite && invite.t) || (firstDated && firstDated.plain.title) || (segments[0] && segments[0].plain.title) || '家人出行'
  return { title, startDate, segments, issues, unparsed: [], raw: '' }
}
