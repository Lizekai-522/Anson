// 长辈端 ↔ 子女端的同步通道（双轨）：
//
//   轨道一（有服务端时）：POST /api/sync/<room>/push + 每 4s GET /api/sync/<room>/pull?since=<n>
//   轨道二（没服务端时）：BroadcastChannel + localStorage 镜像 —— 同一浏览器跨标签可见
//
// 两条轨道都尽力而为：任何失败都静默，不抛异常，由 UI 如实说明「已接入同步服务 / 仅同设备可见」。
// 事件按 id 去重，所以「既广播又上报」不会产生重复条目。
//
// 服务端侧还会在 pull 时惰性算出 alerts（如「平安到达超时」），这里并入同一条事件流 ——
// 页面无需区分「长辈的动作」与「服务端的提醒」，两者都是「长辈动态」里的一行。
//
// 隐私：位置只作为 presence 上报，服务端只保留最新一份，不落轨迹。
import { KEYS, safeGet, safeSet } from './store.js'
import { fnv1a } from './share-codec.js'
import { minimizeSyncEvent } from './locationPrivacy.js'

const CH_PREFIX = 'ptb-sync-'
const POLL_MS = 4000
const PING_TTL_MS = 30000
const MIRROR_CAP = 100
const PING_TIMEOUT_MS = 1500

// ---- room：由分享 token 派生，不占分享载荷（二维码有容量上限）----
function pad36(n) { return n.toString(36).padStart(7, '0') }
export function roomId(token) {
  const t = String(token || '')
  if (!t) return ''
  return pad36(fnv1a(t)) + pad36(fnv1a('r' + t))
}

// ---- 事件 ----
export function makeEvent(type, segId, data, now = Date.now()) {
  return {
    id: now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    type: String(type || ''),
    segId: segId == null ? '' : String(segId),
    at: now,
    data: data || null,
  }
}

// ---- 服务端可用性（缓存 30s，避免每个页面都打一次）----
let pingCache = { at: 0, ok: false }
export function syncMode() { return pingCache.ok ? 'server' : 'device' }

export async function probeSync({ now = Date.now(), force = false } = {}) {
  if (!force && now - pingCache.at < PING_TTL_MS) return pingCache.ok
  let ok = false
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), PING_TIMEOUT_MS)
    const r = await fetch('/api/sync/ping', { headers: { accept: 'application/json' }, signal: ctl.signal })
    clearTimeout(timer)
    const data = await r.json().catch(() => null)
    ok = !!(r.ok && data && data.ok)
  } catch { ok = false }
  pingCache = { at: now, ok }
  return ok
}

// 测试用：把可用性探针的缓存重置掉
export function resetSyncCache() { pingCache = { at: 0, ok: false } }

// ---- 同设备镜像 ----
function readMirror(room) {
  const raw = safeGet(KEYS.syncMirror(room), null)
  if (!raw || typeof raw !== 'object') return { events: [], presence: null }
  return {
    events: Array.isArray(raw.events) ? raw.events.filter((e) => e && typeof e.id === 'string').map(minimizeSyncEvent) : [],
    presence: raw.presence && typeof raw.presence === 'object' ? raw.presence : null,
  }
}

function mergeIntoMirror(room, events, presence) {
  const cur = readMirror(room)
  const seen = new Set(cur.events.map((e) => e.id))
  const next = cur.events.slice()
  for (const e of events || []) {
    if (!e || typeof e.id !== 'string' || seen.has(e.id)) continue
    seen.add(e.id)
    next.push(minimizeSyncEvent(e))
  }
  const trimmed = next.slice(Math.max(0, next.length - MIRROR_CAP))
  safeSet(KEYS.syncMirror(room), { events: trimmed, presence: presence || cur.presence })
}

const channels = new Map()
function channel(room) {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel === 'undefined') return null
  if (channels.has(room)) return channels.get(room)
  let ch = null
  try { ch = new window.BroadcastChannel(CH_PREFIX + room) } catch { ch = null }
  if (ch) channels.set(room, ch)
  return ch
}

// ---- 上报（尽力而为）----
export async function push(room, events, presence) {
  const list = (events || []).filter(Boolean).map(minimizeSyncEvent)
  if (!room || !list.length) { if (presence) await pushPresence(room, presence); return false }
  mergeIntoMirror(room, list, presence)
  const ch = channel(room)
  if (ch) { try { ch.postMessage({ events: list, presence: presence || null }) } catch {} }
  if (pingCache.at === 0) await probeSync()
  if (!syncMode()) return false
  try {
    await fetch('/api/sync/' + encodeURIComponent(room) + '/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: list, presence: presence || null }),
    })
    return true
  } catch { return false }
}

async function pushPresence(room, presence) {
  if (!room || !presence) return false
  mergeIntoMirror(room, [], presence)
  const ch = channel(room)
  if (ch) { try { ch.postMessage({ events: [], presence }) } catch {} }
  if (pingCache.at === 0) await probeSync()
  if (!syncMode()) return false
  try {
    await fetch('/api/sync/' + encodeURIComponent(room) + '/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [], presence }),
    })
    return true
  } catch { return false }
}

// ---- 订阅 ----
// onChange({ events, presence, mode })。返回取消订阅函数。
export function subscribe(room, onChange) {
  if (!room || typeof onChange !== 'function') return () => {}
  const seen = new Set()
  let cursor = 0
  let timer = null
  let stopped = false

  const deliver = (events, presence) => {
    const fresh = []
    for (const e of events || []) {
      if (!e || typeof e.id !== 'string' || seen.has(e.id)) continue
      seen.add(e.id)
      fresh.push(minimizeSyncEvent(e))
    }
    if (!fresh.length && !presence) return
    try { onChange({ events: fresh, presence: presence || null, mode: syncMode() }) } catch {}
  }

  // 先用同设备镜像里的历史铺底，新开的标签不至于空白
  const seed = readMirror(room)
  if (seed.events.length) deliver(seed.events, seed.presence)

  const ch = channel(room)
  const onMsg = (ev) => {
    const d = ev && ev.data
    if (!d) return
    if (Array.isArray(d.events)) mergeIntoMirror(room, d.events, d.presence)
    deliver(d.events, d.presence)
  }
  if (ch) { try { ch.addEventListener('message', onMsg) } catch {} }

  const poll = async () => {
    // 只有确认接上了服务端才轮询；同设备轨靠 BroadcastChannel，不必去打无效请求
    if (stopped || syncMode() !== 'server') return
    try {
      const r = await fetch('/api/sync/' + encodeURIComponent(room) + '/pull?since=' + cursor, {
        headers: { accept: 'application/json' },
      })
      const data = await r.json().catch(() => null)
      if (data && data.ok) {
        cursor = Number(data.cursor) || cursor
        // alerts 是服务端惰性算出来的提醒（如「平安到达超时」）：跟事件一起交给页面，
        // 靠各自的稳定 id 去重，所以同一次会话只提醒一次。
        const alerts = Array.isArray(data.alerts) ? data.alerts : []
        deliver(alerts.length ? [...(data.events || []), ...alerts] : data.events, data.presence)
      }
    } catch {}
  }

  const tick = () => { poll() }
  let onVis = null
  const start = () => {
    if (timer || stopped) return
    poll()
    timer = setInterval(tick, POLL_MS)
  }
  const stop = () => { if (timer) { clearInterval(timer); timer = null } }

  if (typeof document === 'undefined') {
    start()
  } else {
    onVis = () => { if (document.hidden) stop(); else start() }
    document.addEventListener('visibilitychange', onVis)
    if (!document.hidden) start()
  }

  return () => {
    stopped = true
    stop()
    if (ch) { try { ch.removeEventListener('message', onMsg) } catch {} }
    if (onVis && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis)
  }
}