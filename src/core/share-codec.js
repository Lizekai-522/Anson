// 分享链接编解码：长辈数据 + 有效期 → base64url + 校验和 → #/e/xxxxx
// 纯前端无后端，所以链接必须自包含行程数据。
// 校验和用 FNV-1a 32 位，坏链接直接判 malformed，不静默容错。
//
// v2（本轮）：链接要变成二维码，码里每个字符都占模块，所以载荷改成紧凑形态 ——
//   键名压到最短；能推导的字段（播报词/提示/标题/图标）一律不带，解码后用
//   agents.expandCards 走既有管线重生；时间戳改 36 进制秒；尾部空位不写。
//   v1（历史链接）仍能打开，卡片本来就是完整的，直接返回。
import { packCards, expandCards, packInviteSegments, buildInviteTrip } from './agents.js'

export function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function bytesToB64url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const bin = atob(s + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function DEFAULT_TTL_DAYS() { return 30 }

// ---- 载荷压缩（v2）----
// 家人： [姓名, 手机号, 称呼（长辈怎么叫他）, 微信/QQ, 备注, 他对我的称呼]，尾部空位不写
function packPeople(list) {
  return (list || []).map((p) => {
    const row = [p.name || '', p.phone || '', p.relation || '', p.im || '', p.note || '', p.callsMe || '']
    while (row.length > 2 && row[row.length - 1] === '') row.pop()
    return row
  })
}
function expandPeople(rows) {
  return (rows || []).map((r) => ({
    name: r[0] || '',
    phone: r[1] || '',
    relation: r[2] || '',
    im: r[3] || '',
    note: r[4] || '',
    // 旧链接没有第 6 列 → 解出来就是空串，家人页不显示这一行
    callsMe: r[5] || '',
  }))
}

// payload（完整形态，含生成时间/elderId，供 6 位码计算）→ 线上紧凑形态
function packPayload(p) {
  const out = {
    v: 2,
    t: p.title || '',
    x: Math.floor((p.exp || 0) / 1000).toString(36), // 36 进制秒：13 位 → 6 位
    c: packCards(p.cards),
    i: (p.cards || []).map((c) => String(c.segId || '')),
  }
  const people = packPeople(p.contacts)
  if (people.length) out.p = people
  // pr = 首选联系人在 contacts 里的下标（紧急求助打给谁）；缺省/越界都按第一位处理
  const pr = Number(p.pr)
  if (people.length && Number.isInteger(pr) && pr > 0 && pr < people.length) out.pr = pr
  if (p.prefs) {
    // f = [字号, 主题, 是否允许共享位置]。旧链接只有两位 → 解码时按「不允许」处理
    const f = [p.prefs.scale, p.prefs.theme]
    if (p.prefs.shareLocation) f.push(1)
    out.f = f
  }
  return out
}

// 紧凑形态 → 完整形态（长辈端只认完整形态，页面不用关心线上格式）
function unpackPayload(p) {
  const contacts = expandPeople(p.p || [])
  const rawPr = Number(p.pr)
  const pr = Number.isInteger(rawPr) && rawPr >= 0 && rawPr < contacts.length ? rawPr : 0
  return {
    v: 2,
    title: p.t || '',
    exp: parseInt(p.x || '0', 36) * 1000,
    cards: expandCards(p.c || [], Array.isArray(p.i) ? p.i : []),
    contacts,
    pr,
    prefs: Array.isArray(p.f) ? { scale: p.f[0], theme: p.f[1], shareLocation: !!p.f[2] } : null,
  }
}

// payload: { v, eid, cid, title, gen, exp, cards, contacts, prefs }
export function encodeShare(payload) {
  const json = JSON.stringify(packPayload(payload))
  const sum = fnv1a(json).toString(36).padStart(7, '0')
  const bytes = new TextEncoder().encode(json)
  return sum + '.' + bytesToB64url(bytes)
}

export function decodeShare(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' }
  const dot = token.indexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  const sum = token.slice(0, dot)
  let json
  try {
    const bytes = b64urlToBytes(token.slice(dot + 1))
    json = new TextDecoder().decode(bytes)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (fnv1a(json).toString(36).padStart(7, '0') !== sum) return { ok: false, reason: 'malformed' }
  let raw
  try { raw = JSON.parse(json) } catch { return { ok: false, reason: 'malformed' } }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'malformed' }

  let payload
  if (raw.v === 1 && Array.isArray(raw.cards)) {
    payload = raw // 历史链接：卡片本来就是完整的
  } else if (raw.v === 2 && Array.isArray(raw.c)) {
    payload = unpackPayload(raw)
  } else {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof payload.exp === 'number' && Date.now() > payload.exp) {
    return { ok: false, reason: 'expired', payload }
  }
  return { ok: true, payload }
}

// 6 位码：同设备快速通道（长辈输码代替贴长链接）
export function makeShareCode(payload) {
  const material = (payload.eid || '') + '|' + (payload.gen || 0) + '|' + (payload.title || '')
  const h = fnv1a(material)
  const n = h % 1000000
  return String(n).padStart(6, '0')
}

// 从完整分享链接中取出 token（容错：用户可能贴了整条 URL 或多段文本）
// 同时认长辈链接 #/e/ 与子女邀请链接 #/receive/
export function extractToken(text) {
  if (!text) return null
  const m = String(text).match(/#\/(?:e|receive)\/([A-Za-z0-9\-_.]+)/)
  if (m) return m[1]
  const t = String(text).trim()
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t) ? t : null
}

export function buildShareUrl(token) {
  return location.origin + location.pathname + '#/e/' + token
}

// ---------- 子女之间的行程邀请（v3，自包含） ----------
// 与长辈链接同一套 `.`+base64url+FNV 校验，但版本号/形状不同 —— decodeShare 明确拒收 v3，
// 长辈端收到 v3 仍然判「链接不对」，两条通路互不干扰。
//
// 载荷：{ v:3, k:'t', t:标题, s:起始日期, x:过期36进制秒, g:[紧凑段…] }
// g 的行编码见 agents.packInviteSegments / buildInviteTrip。
function packInvitePayload(p) {
  return {
    v: 3,
    k: 't',
    t: p.title || '',
    s: p.startDate || '',
    x: Math.floor((p.exp || 0) / 1000).toString(36),
    g: packInviteSegments(p.segments),
  }
}

// payload: { title, startDate, exp, segments }
export function encodeTripInvite(payload) {
  const json = JSON.stringify(packInvitePayload(payload))
  const sum = fnv1a(json).toString(36).padStart(7, '0')
  const bytes = new TextEncoder().encode(json)
  return sum + '.' + bytesToB64url(bytes)
}

// 返回 { ok, payload:{ title, startDate, exp, g, segments }, reason? }
// 注意：segments 是**重建后的完整段**（可直接 upsertTrip），g 保留紧凑行备查。
export function decodeTripInvite(token, { today } = {}) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' }
  const dot = token.indexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  const sum = token.slice(0, dot)
  let json
  try {
    const bytes = b64urlToBytes(token.slice(dot + 1))
    json = new TextDecoder().decode(bytes)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (fnv1a(json).toString(36).padStart(7, '0') !== sum) return { ok: false, reason: 'malformed' }
  let raw
  try { raw = JSON.parse(json) } catch { return { ok: false, reason: 'malformed' } }
  if (!raw || typeof raw !== 'object' || raw.v !== 3 || raw.k !== 't' || !Array.isArray(raw.g)) {
    return { ok: false, reason: 'malformed' }
  }
  const exp = parseInt(raw.x || '0', 36) * 1000
  const trip = buildInviteTrip(raw, { today })
  const payload = { title: raw.t || trip.title, startDate: raw.s || trip.startDate, exp, g: raw.g, segments: trip.segments, issues: trip.issues }
  if (exp && Date.now() > exp) return { ok: false, reason: 'expired', payload }
  return { ok: true, payload }
}

// 6 位码：与长辈端一致（同设备快捷通道）。由 eid|gen|title 派生，稳定可比对。
export function makeInviteCode(payload) {
  const material = (payload.eid || '') + '|' + (payload.gen || 0) + '|' + (payload.title || '')
  const h = fnv1a(material)
  const n = h % 1000000
  return String(n).padStart(6, '0')
}

export function buildInviteUrl(token) {
  return location.origin + location.pathname + '#/receive/' + token
}