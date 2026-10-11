// 安程 · 可选通知服务的核心（零依赖：只用 node:http / node:fs）。
// 为什么需要它：浏览器自己发不出短信和邮件。前端默认走本机 App（sms:/mailto:），
// 配了服务商密钥后就走这里，由服务端真实送达。
//
//   GET  /api/notify/config  → { sms: 'aliyun'|'twilio'|'webhook'|null, email: 'resend'|'webhook'|null }
//   POST /api/notify         → { channel, to, text, subject } → { ok, via, detail }
//   POST /api/model          → { baseUrl, apiKey, model, messages, temperature } → { ok, content | reason }
//                              （可选）模型请求代理：解决浏览器直连被 CORS 挡住的情况
//   GET  /api/sync/ping              → { ok, rooms }   —— 前端探测同步服务是否在这儿
//   POST /api/sync/:room/push        → { events, presence } → { ok, cursor }
//   GET  /api/sync/:room/pull?since= → { ok, cursor, events, presence }
//                              （可选）长辈端 ↔ 子女端的同步通道：长辈的动作与位置回传
//
// 安全：密钥只在服务端；默认只接受同源请求；
// 设了 NOTIFY_TOKEN / MODEL_PROXY_TOKEN / SYNC_TOKEN 才要求 Bearer。
// 隐私：同步房间只存内存（重启即清），位置只保留最新一份，不留轨迹。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import aliyun from './providers/aliyun.mjs'
import twilio from './providers/twilio.mjs'
import resend from './providers/resend.mjs'
import webhook from './providers/webhook.mjs'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const SMS_CHAIN = [aliyun, twilio, webhook]
const EMAIL_CHAIN = [resend, webhook]

// 谁配了用谁（链上有顺序：专用服务商优先于通用网关）
export function activeProviders(env = process.env) {
  const pick = (chain) => chain.find((p) => p.configured(env)) || null
  return { sms: pick(SMS_CHAIN), email: pick(EMAIL_CHAIN) }
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

// 同源校验：Origin 存在时必须与 Host 一致（curl/同源 GET 可能不带 Origin）
function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > limit) req.destroy()
    })
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

// ---------- 同步房间（内存态） ----------
// 为什么是内存：这是个"顺手就能起"的可选服务，不该要求数据库；
// 代价是重启后房间清空 —— 前端文案如实说「仅同设备可见 / 位置已 X 分钟没更新」，不假装持久。
const ROOM_RE = /^[a-z0-9-]{8,32}$/
const SYNC_MAX_EVENTS = 200        // 每个房间最多留 200 条事件（环形）
const SYNC_ROOM_TTL_MS = 24 * 60 * 60 * 1000
const SYNC_MAX_ROOMS = 1000
// 平安到达：过了预计到达时刻这么久还没收到「走完」，就在 pull 时合成一条提醒
export const ARRIVE_GRACE_MS = 60 * 60 * 1000

function cleanEvent(e) {
  if (!e || typeof e !== 'object') return null
  const id = typeof e.id === 'string' ? e.id.slice(0, 64) : ''
  const type = typeof e.type === 'string' ? e.type.slice(0, 64) : ''
  if (!id || !type) return null
  const at = Number(e.at)
  return {
    id,
    type,
    segId: e.segId == null ? '' : String(e.segId).slice(0, 64),
    at: Number.isFinite(at) ? at : Date.now(),
    data: e.data && typeof e.data === 'object' ? e.data : null,
  }
}

// 「最近一个该到了的到达点」：长辈上报的打卡点（只用于平安到达比对，不做轨迹）
function cleanEta(e) {
  if (!e || typeof e !== 'object') return null
  const segId = typeof e.segId === 'string' ? e.segId.slice(0, 64) : ''
  const at = Number(e.at)
  if (!segId || !Number.isFinite(at)) return null
  return { segId, at }
}

// 位置只留最新一份：不存轨迹，降低隐私风险
function cleanPresence(p) {
  if (!p || typeof p !== 'object') return null
  const lat = Number(p.lat)
  const lng = Number(p.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  const acc = Number(p.acc)
  const at = Number(p.at)
  const out = {
    lat,
    lng,
    acc: Number.isFinite(acc) ? Math.max(0, Math.round(acc)) : null,
    at: Number.isFinite(at) ? at : Date.now(),
  }
  const eta = cleanEta(p.eta)
  if (eta) out.eta = eta
  return out
}

export function createSyncStore({ now = () => Date.now() } = {}) {
  const rooms = new Map()

  function evictIfNeeded() {
    if (rooms.size < SYNC_MAX_ROOMS) return
    let oldestKey = null
    let oldestAt = Infinity
    for (const [k, v] of rooms) {
      if (v.lastAt < oldestAt) { oldestAt = v.lastAt; oldestKey = k }
    }
    if (oldestKey) rooms.delete(oldestKey)
  }

  function get(room) {
    let r = rooms.get(room)
    if (!r) {
      evictIfNeeded()
      r = { seq: 0, events: [], presence: null, lastAt: now() }
      rooms.set(room, r)
    }
    return r
  }

  // 平安到达：惰性比对（在 pull 时算，不引入后台定时器）。
  // 三条同时成立才提醒：长辈上报了到达点 + 已过宽限期 + 期间没收到该段的「走完」。
  // 带稳定 id，前端按 id 去重，同一次会话只提醒一次。
  function arriveAlerts(r) {
    const eta = r.presence && r.presence.eta
    if (!eta) return []
    const t = now()
    if (t < eta.at + ARRIVE_GRACE_MS) return []
    const acked = r.events.some((e) => e.type === 'card-done' && e.segId === eta.segId && e.at >= eta.at)
    if (acked) return []
    return [{
      id: `arrive-missed:${eta.segId}:${eta.at}`,
      type: 'arrive-missed',
      segId: eta.segId,
      at: eta.at,
      data: { minutes: Math.round((t - eta.at) / 60000), eta: eta.at },
    }]
  }

  return {
    rooms,
    size() { return rooms.size },
    push(room, events, presence) {
      const r = get(room)
      for (const raw of Array.isArray(events) ? events : []) {
        const e = cleanEvent(raw)
        if (!e) continue
        r.seq += 1
        r.events.push({ ...e, seq: r.seq })
      }
      if (r.events.length > SYNC_MAX_EVENTS) r.events = r.events.slice(r.events.length - SYNC_MAX_EVENTS)
      const p = cleanPresence(presence)
      if (p) r.presence = p
      r.lastAt = now()
      return { ok: true, cursor: r.seq }
    },
    pull(room, since) {
      const r = get(room)
      const s = Number.isFinite(Number(since)) ? Number(since) : 0
      r.lastAt = now()
      const alerts = arriveAlerts(r)
      const out = {
        ok: true,
        cursor: r.seq,
        events: r.events.filter((e) => e.seq > s),
        presence: r.presence,
      }
      // 只在真的超时才带上，正常情况响应保持原样（前端无感）
      if (alerts.length) out.alerts = alerts
      return out
    },
    sweep() {
      const cut = now() - SYNC_ROOM_TTL_MS
      for (const [k, v] of rooms) {
        if (v.lastAt < cut) rooms.delete(k)
      }
    },
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

// 顺带把 dist 当静态站点发出去：前端与接口同源，省掉反向代理，也免了 CORS
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  let file = path.join(DIST, rel)
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html')
    if (!fs.existsSync(file)) return json(res, 404, { error: 'dist 还没构建，先跑 npm run build' })
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  res.end(fs.readFileSync(file))
}

// ---------- 天气（可选增强：Open-Meteo，免 key） ----------
// 只接受城市名，不接受坐标 —— 目的地天气不需要知道长辈在哪。
// 文案在客户端统一拼（src/core/weather.js），服务端只回原始数值，避免两处措辞不一致。
const WEATHER_TTL_MS = 30 * 60 * 1000
const WEATHER_TIMEOUT_MS = 5000

// 城市名 → geocoding 结果（含经纬度）。
// Open-Meteo 的中文索引对部分城市要带「市」才命中（如「厦门」查不到、「厦门市」能查到），
// 所以首次没命中时补一次「市」重试 —— 一个便宜的兜底，别让地图/天气凭空少一个目的地。
async function geocodeCity(city, signal) {
  const lookup = async (name) => {
    const g = await fetch(
      'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) + '&count=1&language=zh&format=json',
      { signal },
    )
    const gj = await g.json().catch(() => null)
    return gj && Array.isArray(gj.results) ? gj.results[0] : null
  }
  let first = await lookup(city)
  if (!first && !/市$/.test(city)) first = await lookup(city + '市')
  return first
}

export async function fetchWeatherFor(city) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), WEATHER_TIMEOUT_MS)
  try {
    const first = await geocodeCity(city, ctl.signal)
    if (!first || !Number.isFinite(Number(first.latitude))) return { ok: false, reason: 'city_not_found' }
    const f = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(first.latitude) +
      '&longitude=' + encodeURIComponent(first.longitude) +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=Asia%2FShanghai&forecast_days=1',
      { signal: ctl.signal },
    )
    const fj = await f.json().catch(() => null)
    const d = fj && fj.daily
    if (!d || !Array.isArray(d.time) || !d.time.length) return { ok: false, reason: 'no_forecast' }
    const pick = (k) => (Array.isArray(d[k]) && d[k].length ? Number(d[k][0]) : null)
    return {
      ok: true,
      city: String(first.name || city),
      date: String(d.time[0] || ''),
      tmax: pick('temperature_2m_max'),
      tmin: pick('temperature_2m_min'),
      rain: pick('precipitation_probability_max'),
      code: pick('weathercode'),
    }
  } catch (e) {
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

// 城市 → 坐标（复用与天气同一份 Open-Meteo geocoding）。只收城市名，不给坐标出入口。
export async function fetchGeocodeFor(city) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), WEATHER_TIMEOUT_MS)
  try {
    const first = await geocodeCity(city, ctl.signal)
    const lat = first ? Number(first.latitude) : NaN
    const lng = first ? Number(first.longitude) : NaN
    if (!first || !Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, reason: 'city_not_found' }
    return { ok: true, city: String(first.name || city), lat, lng }
  } catch (e) {
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

// 城市名查询值：兼容「b64_<base64url>」（客户端默认，纯 ASCII）与原始明文（老写法 / curl）。
// 有些前置网关会 400 掉 URL 里的非 ASCII 字节，所以客户端把城市名编成 ASCII 再传。
function decodeCityParam(raw) {
  const s = String(raw || '')
  if (!s.startsWith('b64_')) return s
  const body = s.slice(4)
  if (!body || !/^[A-Za-z0-9_-]+$/.test(body)) return ''
  try {
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - b64.length % 4) : ''
    const text = Buffer.from(b64 + pad, 'base64').toString('utf8')
    return text.includes('\uFFFD') ? '' : text
  } catch {
    return ''
  }
}

function normalizeCity(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
}

export function createServer(env = process.env, { serveDist = false } = {}) {
  const sync = createSyncStore()
  const sweeper = setInterval(() => sync.sweep(), 5 * 60 * 1000)
  if (typeof sweeper.unref === 'function') sweeper.unref()
  const weatherCache = new Map()
  const geoCache = new Map()

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'))

    // ---- 同步通道 ----
    if (url.pathname === '/api/sync/ping') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' })
      return json(res, 200, { ok: true, rooms: sync.size() })
    }

    const syncMatch = url.pathname.match(/^\/api\/sync\/([^/]+)\/(push|pull)$/)
    if (syncMatch) {
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' })
      if (env.SYNC_TOKEN && req.headers.authorization !== 'Bearer ' + env.SYNC_TOKEN) {
        return json(res, 401, { ok: false, reason: 'unauthorized' })
      }
      const room = decodeURIComponent(syncMatch[1])
      if (!ROOM_RE.test(room)) return json(res, 400, { ok: false, reason: 'bad_room' })

      if (syncMatch[2] === 'pull') {
        if (req.method !== 'GET') return json(res, 405, { error: 'method' })
        return json(res, 200, sync.pull(room, url.searchParams.get('since')))
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'method' })
      const body = await readBody(req, 32 * 1024)
      return json(res, 200, sync.push(room, body.events, body.presence))
    }

    if (url.pathname === '/api/weather') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' })
      if (req.method !== 'GET') return json(res, 405, { error: 'method' })
      const city = normalizeCity(decodeCityParam(url.searchParams.get('city')))
      if (!city) return json(res, 400, { ok: false, reason: 'missing_city' })
      const hit = weatherCache.get(city)
      if (hit && Date.now() - hit.at < WEATHER_TTL_MS) return json(res, 200, hit.value)
      const out = await fetchWeatherFor(city)
      if (out && out.ok) weatherCache.set(city, { at: Date.now(), value: out })
      return json(res, out && out.ok ? 200 : 502, out || { ok: false, reason: 'unavailable' })
    }

    if (url.pathname === '/api/geocode') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' })
      if (req.method !== 'GET') return json(res, 405, { error: 'method' })
      const city = normalizeCity(decodeCityParam(url.searchParams.get('city')))
      if (!city) return json(res, 400, { ok: false, reason: 'missing_city' })
      const hit = geoCache.get(city)
      if (hit && Date.now() - hit.at < WEATHER_TTL_MS) return json(res, 200, hit.value)
      const out = await fetchGeocodeFor(city)
      if (out && out.ok) geoCache.set(city, { at: Date.now(), value: out })
      return json(res, out && out.ok ? 200 : 502, out || { ok: false, reason: 'unavailable' })
    }

    if (url.pathname === '/api/notify/config') {
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' })
      const act = activeProviders(env)
      return json(res, 200, { sms: act.sms ? act.sms.id : null, email: act.email ? act.email.id : null })
    }

    if (url.pathname === '/api/notify') {
      if (req.method !== 'POST') return json(res, 405, { error: 'method' })
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' })
      if (env.NOTIFY_TOKEN && req.headers.authorization !== 'Bearer ' + env.NOTIFY_TOKEN) {
        return json(res, 401, { ok: false, reason: 'unauthorized' })
      }
      const body = await readBody(req)
      const channel = body.channel === 'email' ? 'email' : 'sms'
      const to = String(body.to || '').trim()
      const text = String(body.text || '')
      if (!to || !text) return json(res, 400, { ok: false, reason: 'missing_to_or_text' })

      const provider = activeProviders(env)[channel]
      if (!provider) return json(res, 501, { ok: false, reason: 'not_configured' })
      try {
        const out = await provider.send({ to, text, subject: body.subject, channel, env })
        if (!out.ok) return json(res, 502, { ok: false, reason: out.reason, via: provider.id })
        return json(res, 200, { ok: true, via: provider.id, detail: out.detail || '' })
      } catch (e) {
        return json(res, 502, { ok: false, reason: String((e && e.message) || e), via: provider.id })
      }
    }

    if (url.pathname === '/api/model') {
      if (req.method !== 'POST') return json(res, 405, { error: 'method' })
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' })
      if (env.MODEL_PROXY_TOKEN && req.headers.authorization !== 'Bearer ' + env.MODEL_PROXY_TOKEN) {
        return json(res, 401, { ok: false, reason: 'unauthorized' })
      }
      // 多模态消息里带 base64 图片，正文可能到几 MB，限额放宽
      const body = await readBody(req, 8 * 1024 * 1024)
      const baseUrl = String(body.baseUrl || '').trim()
      const model = String(body.model || '').trim()
      const messages = Array.isArray(body.messages) ? body.messages : null
      if (!baseUrl || !model || !messages) return json(res, 400, { ok: false, reason: 'missing_params' })
      // 只允许 http(s)：避免被当成 SSRF 跳板去读 file:// 或内网协议
      if (!/^https?:\/\//i.test(baseUrl)) return json(res, 400, { ok: false, reason: 'bad_base_url' })

      const headers = { 'content-type': 'application/json' }
      if (body.apiKey) headers.authorization = 'Bearer ' + String(body.apiKey)
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 60000)
      try {
        const up = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, messages, temperature: body.temperature }),
          signal: ctl.signal,
        })
        const text = await up.text()
        let data = null
        try { data = JSON.parse(text) } catch { data = null }
        if (!up.ok) {
          const detail = data && data.error && data.error.message ? String(data.error.message).slice(0, 200) : text.slice(0, 200)
          return json(res, 502, { ok: false, reason: 'http-' + up.status, detail })
        }
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        if (typeof content !== 'string' || !content) return json(res, 502, { ok: false, reason: 'bad-response' })
        return json(res, 200, { ok: true, content })
      } catch (e) {
        return json(res, 502, { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' })
      } finally {
        clearTimeout(timer)
      }
    }

    if (serveDist) return serveStatic(res, url.pathname)
    return json(res, 404, { error: 'not found' })
  })
}