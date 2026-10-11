// 目的地天气 / 穿衣提示：把「明天去厦门」这类需求翻成一句长辈看得懂的话。
//
// 设计取舍：
// - 只做「服务端可选增强」：前端只调本应用的 /api/weather，拿不到就静默没有天气（不阻断分享）。
// - 只传城市名，不上报长辈坐标（隐私）。
// - weatherAdvice 是纯函数：文案规则可单测，不依赖网络与 DOM。

// WMO weather code → 中文
const CODE_TEXT = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '有雾凇',
  51: '毛毛雨',
  53: '小雨',
  55: '中雨',
  56: '冻雨',
  57: '冻雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '阵雪',
  86: '阵雪',
  95: '雷阵雨',
  96: '雷阵雨夹冰雹',
  99: '雷阵雨夹冰雹',
}

export function weatherText(code) {
  const n = Number(code)
  return CODE_TEXT[n] || ''
}

function isRainCode(code) {
  const n = Number(code)
  return (n >= 51 && n <= 67) || (n >= 80 && n <= 82) || (n >= 95 && n <= 99)
}
function isSnowCode(code) {
  const n = Number(code)
  return (n >= 71 && n <= 77) || n === 85 || n === 86
}

// 返回一句「24℃ 多云，带件外套」；数据不全返回 ''
export function weatherAdvice(data) {
  const { tmax, tmin, rain, code } = data || {}
  // null / 空串 不能当成 0℃：那是「没数据」，不是「0 度」
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v))
  const hi = num(tmax)
  const lo = num(tmin)
  if (!Number.isFinite(hi) && !Number.isFinite(lo)) return ''
  const desc = weatherText(code)
  const temp = Number.isFinite(hi)
    ? `${Math.round(hi)}℃`
    : `${Math.round(lo)}℃`
  const head = [temp, desc].filter(Boolean).join(' ')

  const tips = []
  const rainPct = num(rain)
  if (isSnowCode(code)) tips.push('有雪，穿厚点，鞋子要防滑')
  else if (isRainCode(code) || (Number.isFinite(rainPct) && rainPct >= 50)) tips.push('有雨，记得带伞')
  else if (Number.isFinite(rainPct) && rainPct >= 30) tips.push('可能会下雨，带把伞稳妥')

  if (Number.isFinite(lo) && lo <= 5) tips.push('很冷，穿厚外套')
  else if (Number.isFinite(lo) && lo <= 12) tips.push('早晚凉，带件外套')

  if (Number.isFinite(hi) && hi >= 33) tips.push('很热，多喝水，别在太阳底下久站')
  else if (Number.isFinite(hi) && hi >= 28) tips.push('偏热，注意补水')

  if (!tips.length) tips.push('穿得舒服就行')
  return head + '，' + tips.slice(0, 2).join('；')
}

// 校验并规整服务端返回：形状不对就当作没有天气
export function normalizeWeather(data) {
  if (!data || typeof data !== 'object' || data.ok !== true) return null
  const advice = typeof data.advice === 'string' && data.advice ? data.advice : weatherAdvice(data)
  if (!advice) return null
  return {
    city: String(data.city || ''),
    date: String(data.date || ''),
    advice,
  }
}

// 城市名 → URL 查询值：编成纯 ASCII 的 base64url（带 b64_ 前缀）。
// 有些前置网关/预览代理会直接 400 掉 URL 里含非 ASCII 字节的请求（正是「查不到天气」的元凶），
// 编成 ASCII 就能安全穿过；服务端两种写法都认（见 server/app.mjs 的 decodeCityParam）。
export function encodeCityParam(name) {
  const s = String(name || '')
  try {
    const bytes = new TextEncoder().encode(s)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return 'b64_' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    return s
  }
}

// 查一个城市的天气：失败/超时/服务端没配 → 返回 null（调用方静默）
export async function fetchWeather(city, { fetchImpl, timeoutMs = 5000, base = '' } = {}) {
  const name = String(city || '').trim()
  if (!name) return null
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  if (!doFetch) return null
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  try {
    const r = await doFetch(base + '/api/weather?city=' + encodeCityParam(name), { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) })
    if (!r || !r.ok) return null
    const data = await r.json().catch(() => null)
    return normalizeWeather(data)
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
