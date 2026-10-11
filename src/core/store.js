// 状态中枢：账号隔离 + 持久化。不引 Pinia —— 数据量小，自研更可控。
//
// 存储键位（账号隔离是硬要求）：
//   ptb:accounts          账号列表
//   ptb:session           当前登录 { accountId, ts }
//   ptb:data:<accountId>  该账号的家人/行程/草稿/分享
//   ptb:auth / ptb:data   旧键，登录时自动迁入账号桶
//
// 关键修复（历史 bug）：init 顺序必须是「先恢复会话，再读数据桶」，
// 否则刷新后拿『无账号』去读桶，读到空的，用户被踢回身份选择页。
import { reactive } from 'vue'
import { fnv1a } from './share-codec.js'

export const KEYS = {
  accounts: 'ptb:accounts',
  session: 'ptb:session',
  data: (id) => `ptb:data:${id}`,
  legacyAuth: 'ptb:auth',
  legacyData: 'ptb:data',
  migrated: 'ptb:migrated',
  elderPrefs: 'ptb:elder:prefs',
  // 长辈端「走完了 / 收起来了 / 提醒已读 / 清单打勾」：按 room（由分享 token 派生）隔离
  elderState: (room) => `ptb:elder:state:${room}`,
  // 同步通道的同设备镜像（没有服务端时靠它跨标签）
  syncMirror: (room) => `ptb:sync:${room}`,
  model: 'ptb:model',
  // 未登录时点开子女邀请链接：先暂存，登录后自动继续接收
  pendingInvite: 'ptb:pending-invite',
  // 「记住这台手机」：长辈输码成功后存下这条行程，下次进来一键回到
  elderLast: 'ptb:elder:last',
}

export function emptyData() {
  return { trips: [], family: [], shares: [], draft: null, familyGroups: [], invites: [] }
}

export function safeGet(k, fallback) {
  try {
    const v = localStorage.getItem(k)
    return v == null ? fallback : JSON.parse(v)
  } catch { return fallback }
}
export function safeSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return { ok: true } } catch (e) {
    return { ok: false, reason: e?.name || 'storage-unavailable' }
  }
}
export function safeDel(k) {
  try { localStorage.removeItem(k) } catch {}
}

export const store = reactive({
  ready: false,
  account: null,     // { id, name, email, phone }
  data: emptyData(), // 当前账号的数据桶（响应式）
  toasts: [],
})

let toastSeq = 0
export function toast(msg, kind = 'info', ms = 2600) {
  const id = ++toastSeq
  store.toasts.push({ id, msg, kind })
  setTimeout(() => {
    const i = store.toasts.findIndex((t) => t.id === id)
    if (i >= 0) store.toasts.splice(i, 1)
  }, ms)
}

// ---- 启动自愈：只清「孤立」的同步镜像键 ----
// 为什么只动 ptb:sync:*：同步镜像能从链接重建；而 ptb:elder:state:*（长辈勾选记录）
// 一旦误删，长辈就得重新勾一遍 —— 那是真正不可重建的东西，绝不动。
//
// room 的派生规则必须与 sync.js 的 roomId 完全一致（tests 里有一条断言盯着它）。
function roomIdOf(token) {
  const t = String(token || '')
  if (!t) return ''
  const pad = (n) => n.toString(36).padStart(7, '0')
  return pad(fnv1a(t)) + pad(fnv1a('r' + t))
}

// 纯函数：给「全部键」与「本机仍有效的房间集合」，返回该删的孤立镜像键
export function purgeOrphanSyncKeys(readKeys, validRooms) {
  const rooms = new Set(validRooms || [])
  const out = []
  for (const k of readKeys || []) {
    if (typeof k !== 'string' || k.indexOf('ptb:sync:') !== 0) continue
    const room = k.slice('ptb:sync:'.length)
    if (!rooms.has(room)) out.push(k)
  }
  return out
}

// 从本机所有账号桶里的分享/邀请记录派生出仍然有效的房间号
function collectValidRooms() {
  const valid = new Set()
  try {
    const ls = window.localStorage
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i)
      if (!key || key.indexOf('ptb:data') !== 0) continue
      let bucket = null
      try { bucket = JSON.parse(ls.getItem(key)) } catch { bucket = null }
      if (!bucket || typeof bucket !== 'object') continue
      for (const list of [bucket.shares, bucket.invites]) {
        for (const it of Array.isArray(list) ? list : []) {
          if (it && it.token) { const r = roomIdOf(it.token); if (r) valid.add(r) }
        }
      }
    }
  } catch {}
  return valid
}

// ---- 会话恢复 + 数据桶挂载（顺序不可颠倒）----
export function initStore() {
  const session = safeGet(KEYS.session, null)
  if (session && session.accountId) {
    const accounts = safeGet(KEYS.accounts, [])
    const acc = accounts.find((a) => a.id === session.accountId)
    if (acc) {
      store.account = { id: acc.id, name: acc.name, email: acc.email, phone: acc.phone, avatar: acc.avatar || '' }
      loadDataBucket(acc.id)
    } else {
      safeDel(KEYS.session)
    }
  }
  // 坏链接累积下来的孤立同步镜像：开机顺手清掉（失败静默，绝不影响启动）
  try {
    const ls = window.localStorage
    const keys = []
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k) keys.push(k) }
    purgeOrphanSyncKeys(keys, collectValidRooms()).forEach(safeDel)
  } catch {}
  store.ready = true
}

// 账号登录/注册成功后调用：迁移旧数据 + 挂载该账号数据桶
export function attachAccount(account) {
  migrateLegacyData(account.id)
  store.account = { id: account.id, name: account.name, email: account.email, phone: account.phone, avatar: account.avatar || '' }
  loadDataBucket(account.id)
}

export function detachAccount() {
  safeDel(KEYS.session)
  store.account = null
  store.data = emptyData()
}

function loadDataBucket(accountId) {
  const bucket = safeGet(KEYS.data(accountId), null)
  store.data = bucket ? Object.assign(emptyData(), bucket) : emptyData()
  // 会话存在即视为该账号，落一次会话时间戳
  safeSet(KEYS.session, { accountId, ts: Date.now() })
}

// 旧版单桶数据自动迁入账号桶，不丢数据
function migrateLegacyData(accountId) {
  if (localStorage.getItem(KEYS.migrated)) return
  const legacy = safeGet(KEYS.legacyData, null)
  const legacyAuth = safeGet(KEYS.legacyAuth, null)
  if (legacy || legacyAuth) {
    const bucket = emptyData()
    if (legacy) {
      if (Array.isArray(legacy.trips)) bucket.trips = legacy.trips
      if (Array.isArray(legacy.family)) bucket.family = legacy.family
      if (Array.isArray(legacy.shares)) bucket.shares = legacy.shares
      if (legacy.draft) bucket.draft = legacy.draft
    }
    const existing = safeGet(KEYS.data(accountId), null)
    if (existing) {
      // 双方都有：合并（行程按 id 去重，保留已有）
      const merged = Object.assign(emptyData(), existing)
      for (const t of bucket.trips) if (!merged.trips.some((x) => x.id === t.id)) merged.trips.push(t)
      for (const f of bucket.family) if (!merged.family.some((x) => x.id === f.id)) merged.family.push(f)
      merged.draft = merged.draft || bucket.draft
      safeSet(KEYS.data(accountId), merged)
    } else {
      safeSet(KEYS.data(accountId), bucket)
    }
    safeDel(KEYS.legacyData)
    safeDel(KEYS.legacyAuth)
  }
  safeSet(KEYS.migrated, { ts: Date.now() })
}

// ---- 持久化 ----
export function persist() {
  if (!store.account) return { ok: false, reason: 'no-account' }
  return safeSet(KEYS.data(store.account.id), store.data)
}

// ---- 备份恢复：纯函数，便于单测（形状校验 + 按 id 去重合并，不改动入参）----
// 返回 { ok, reason?, data, added:{trips,family,shares,familyGroups}, skipped }
// - 形状不符（不是对象 / 四个区块都不是数组）→ ok:false，调用方不得落库
// - 逐项要求 id 为字符串；缺 id 或已在现有数据里的 → 计入 skipped，不重复导入
export function mergeBackup(current, incoming) {
  const base = JSON.parse(JSON.stringify(Object.assign(emptyData(), current || {})))
  const added = { trips: 0, family: 0, shares: 0, familyGroups: 0 }
  let skipped = 0
  const BLOCKS = ['trips', 'family', 'shares', 'familyGroups']
  const shapeBad = !incoming || typeof incoming !== 'object' ||
    !BLOCKS.some((k) => Array.isArray(incoming[k]))
  if (shapeBad) return { ok: false, reason: 'shape', data: base, added, skipped }
  for (const k of BLOCKS) {
    const list = Array.isArray(incoming[k]) ? incoming[k] : []
    for (const item of list) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) { skipped++; continue }
      if (base[k].some((x) => x && x.id === item.id)) { skipped++; continue }
      base[k].push(item)
      added[k]++
    }
  }
  return { ok: true, data: base, added, skipped }
}

// ---- 行程 CRUD ----
export function saveAccountData(next) {
  if (!store.account) return { ok: false, reason: 'no-account' }
  const result = safeSet(KEYS.data(store.account.id), next)
  if (result.ok) store.data = next
  return result
}
export function upsertTrip(trip) {
  const trips = store.data.trips.slice()
  const i = trips.findIndex((t) => t.id === trip.id)
  if (i >= 0) trips.splice(i, 1, trip)
  else trips.unshift(trip)
  return saveAccountData({ ...store.data, trips })
}

export function removeTrip(id) {
  const i = store.data.trips.findIndex((t) => t.id === id)
  if (i >= 0) store.data.trips.splice(i, 1)
  store.data.shares = store.data.shares.filter((s) => s.tripId !== id)
  persist()
}

export function getTrip(id) {
  return store.data.trips.find((t) => t.id === id) || null
}

// ---- 行程草稿（随账号桶隔离）----
export function setDraft(draft) {
  return saveAccountData({ ...store.data, draft })
}
export function clearDraft() {
  return saveAccountData({ ...store.data, draft: null })
}

// ---- 家人 ----
export function upsertFamily(member) {
  const i = store.data.family.findIndex((m) => m.id === member.id)
  if (i >= 0) store.data.family.splice(i, 1, member)
  else store.data.family.push(member)
  persist()
}
export function removeFamily(id) {
  store.data.family = store.data.family.filter((m) => m.id !== id)
  // 顺手把这个人从所有分组里摘掉，免得分组里留下死引用
  store.data.familyGroups = store.data.familyGroups.map((g) => ({
    ...g,
    memberIds: (g.memberIds || []).filter((mid) => mid !== id),
  }))
  persist()
}

// ---- 家人分组：一个家人可以同时属于多个组 ----
export function upsertFamilyGroup(group) {
  const i = store.data.familyGroups.findIndex((g) => g.id === group.id)
  const clean = { id: group.id, name: String(group.name || '').trim(), memberIds: [...new Set((group.memberIds || []).filter(Boolean))] }
  if (i >= 0) store.data.familyGroups.splice(i, 1, clean)
  else store.data.familyGroups.push(clean)
  persist()
  return clean
}
export function removeFamilyGroup(id) {
  store.data.familyGroups = store.data.familyGroups.filter((g) => g.id !== id)
  persist()
}
export function listFamilyGroups() {
  return store.data.familyGroups
}

// ---- 子女邀请记录 ----
export function saveInvite(invite) {
  return saveAccountData({ ...store.data, invites: [invite, ...store.data.invites] })
}
export function listInvites() {
  return store.data.invites
}

// ---- 分享记录 ----
export function saveShare(share) {
  return saveAccountData({ ...store.data, shares: [share, ...store.data.shares] })
}
export function listShares() {
  return store.data.shares
}

// 未登录时点开子女邀请链接：先暂存 token，登录/注册成功后自动继续接收
export function setPendingInvite(token) {
  if (!token) return
  safeSet(KEYS.pendingInvite, { token, ts: Date.now() })
}
export function readPendingInvite() {
  const v = safeGet(KEYS.pendingInvite, null)
  if (v && typeof v === 'object' && typeof v.token === 'string') return v.token
  return ''
}
export function clearPendingInvite() {
  safeDel(KEYS.pendingInvite)
}

export function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 旧版家人称呼是按子女视角写的（爸爸/妈妈/爷爷…）。放到长辈页会让人以为是长辈本人，
// 所以长辈页一律不显示这些称呼，子女端则提示改成长辈叫得顺口的（儿子、老伴…）。
export const LEGACY_FAMILY_TITLES = ['爸爸', '妈妈', '爷爷', '奶奶', '外公', '外婆']
export function isLegacyFamilyTitle(v) {
  return LEGACY_FAMILY_TITLES.includes(String(v || '').trim())
}

// ---- 长辈端显示偏好（设备级，不进账号桶：谁在这台设备上看都合适）----
// 只接受白名单值：localStorage 里的脏数据不许把长辈端搞成看不清的样子。
export const ELDER_SCALES = [1, 1.12, 1.25]
// 三主题改走"站牌"语义：日间（中性浅底）/ 高对比（纯黑 + 琥珀）/ 夜间。
// key 一并更名，旧的 'warm'/'white' 值会因不在白名单里自动回落到默认，不会把界面搞坏。
export const ELDER_THEMES = ['day', 'contrast', 'night']
// 播报语言：普通话 / 闽南话（长辈自己的选择，不随分享下发）
export const ELDER_VOICES = ['zh', 'nan']
const ELDER_SCALE_NAMES = { 1: '标准', 1.12: '大', 1.25: '超大' }
const ELDER_THEME_NAMES = { day: '日间', contrast: '高对比', night: '夜间' }
const ELDER_VOICE_NAMES = { zh: '普通话', nan: '闽南话' }

export function elderScaleName(v) { return ELDER_SCALE_NAMES[v] || ELDER_SCALE_NAMES[1] }
export function elderThemeName(v) { return ELDER_THEME_NAMES[v] || ELDER_THEME_NAMES.day }
export function elderVoiceName(v) { return ELDER_VOICE_NAMES[v] || ELDER_VOICE_NAMES.zh }

// 没设过返回 null（交给分享里的预设）
export function loadElderPrefs() {
  const raw = safeGet(KEYS.elderPrefs, null)
  if (!raw || typeof raw !== 'object') return null
  return {
    scale: ELDER_SCALES.includes(raw.scale) ? raw.scale : 1,
    theme: ELDER_THEMES.includes(raw.theme) ? raw.theme : 'day',
    // 以下三项是「设备能力 / 长辈自己的选择」：只认本机，分享不携带
    wake: raw.wake !== false,
    voice: ELDER_VOICES.includes(raw.voice) ? raw.voice : 'zh',
    autoRead: raw.autoRead !== false,
  }
}

export function saveElderPrefs(prefs) {
  const next = {
    scale: ELDER_SCALES.includes(prefs && prefs.scale) ? prefs.scale : 1,
    theme: ELDER_THEMES.includes(prefs && prefs.theme) ? prefs.theme : 'day',
    wake: !(prefs && prefs.wake === false),
    voice: ELDER_VOICES.includes(prefs && prefs.voice) ? prefs.voice : 'zh',
    autoRead: !(prefs && prefs.autoRead === false),
  }
  safeSet(KEYS.elderPrefs, next)
  return next
}

// 生效优先级：长辈自己调过的 > 子女分享时预设的 > 默认
export function resolveElderPrefs(sharePrefs) {
  const local = loadElderPrefs()
  const fromShare = sharePrefs && typeof sharePrefs === 'object' ? sharePrefs : null
  const pick = local || fromShare || {}
  return {
    scale: ELDER_SCALES.includes(pick.scale) ? pick.scale : 1,
    theme: ELDER_THEMES.includes(pick.theme) ? pick.theme : 'day',
    // 屏幕常亮 / 语言 / 勾完自动读：这三项不随分享下发（不替长辈决定设备行为）
    wake: local ? local.wake : true,
    voice: local ? local.voice : 'zh',
    autoRead: local ? local.autoRead : true,
    // 位置共享是「子女授权」，只认分享里带的，本机偏好不能自己给自己开权限
    shareLocation: !!(fromShare && fromShare.shareLocation),
    source: local ? 'local' : (fromShare ? 'share' : 'default'),
  }
}

// ---- 「记住这台手机」：长辈输码成功后记下这条行程（设备级，不进账号桶）----
// 只存本机：换机、清缓存自然失效，无隐私风险。token 形状做白名单校验。
const ELDER_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export function saveLastElderTrip({ token, title, startDate } = {}) {
  const t = String(token || '')
  if (!ELDER_TOKEN_RE.test(t)) return null
  const rec = {
    token: t,
    title: String(title || '').slice(0, 80),
    startDate: String(startDate || '').slice(0, 20),
    savedAt: Date.now(),
  }
  safeSet(KEYS.elderLast, rec)
  return rec
}

export function loadLastElderTrip() {
  const raw = safeGet(KEYS.elderLast, null)
  if (!raw || typeof raw !== 'object') return null
  const t = String(raw.token || '')
  if (!ELDER_TOKEN_RE.test(t)) return null
  return {
    token: t,
    title: String(raw.title || '').slice(0, 80),
    startDate: String(raw.startDate || '').slice(0, 20),
    savedAt: Number(raw.savedAt) || 0,
  }
}

export function clearLastElderTrip() {
  safeDel(KEYS.elderLast)
}
