<script setup>
// 长辈端外壳：#/e/<token> 或本机 6 位码，免登录看行程。
// 一按钮一页面（用户明确要求：别把三块内容堆在一页里，长辈会看叉）：
//   #/e/<token>         行程页（默认页，播报按钮在本页内）
//   #/e/<token>/calls   家人电话
//   #/e/<token>/show    显示设置
//   #/e                 输码页 / 链接过期 / 链接损坏（都没有底栏）
// 本页不放产品 logo、不出现产品名：长辈只需要看到"今天怎么走"。
//
// 适老化红线：正文 ≥28px、主按钮 ≥72px 高、三主题正文对比度 ≥7:1、全页零动画（不写 animation/transition）。
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, navigate } from '../core/router.js'
import { decodeShare } from '../core/share-codec.js'
import {
  store, resolveElderPrefs, saveElderPrefs,
  loadLastElderTrip, saveLastElderTrip, clearLastElderTrip,
} from '../core/store.js'
import { loadElderState, saveElderState, toggleDone, toggleCollapsed, markDismissed, toggleTodo, todoKey } from '../core/elderState.js'
import { roomId, push, probeSync, makeEvent } from '../core/sync.js'
import {
  upcomingList, shouldRemind, countdownText, noticeTitle,
  nextDepartText, arrivalCheckpoints, nextPendingAfter, nextArrivalCheckpoint,
} from '../core/upcoming.js'
import { pickPreferredContact, buildSosText, buildSmsHref, buildTelHref, maskPhone, contactLabel, hasLocation } from '../core/sos.js'
import { resolveVoice, loadNanManifest } from '../core/elderVoice.js'
import { downloadCardsPoster } from '../core/export.js'
import { todayStr, dateLabel } from './elder-shared.js'
import DayView from './DayView.vue'
import CallsView from './CallsView.vue'
import ShowView from './ShowView.vue'
import NoticePopup from './NoticePopup.vue'
import LocationShare from './LocationShare.vue'

const route = useRoute()

const state = ref('code') // 'code' | 'resume' | 'ok' | 'expired' | 'malformed'
const payload = ref(null)
const page = ref('day') // 'day' | 'calls' | 'show'
let token = ''

// ---- 「记住这台手机」：本机存下上次看过的行程 ----
const lastTrip = ref(loadLastElderTrip())

// ---- 同步（双轨）与长辈端本机任务状态 ----
const room = ref('')            // 由分享 token 派生；没有分享就没有 room
const syncReady = ref(false)    // 是否接上了同步服务（只用于文案）
const tasks = ref({ done: {}, collapsed: {}, dismissed: {}, todos: {} })
let syncedToken = ''

// ---- 提醒 / 倒计时 / 接下来引导 ----
const notice = ref(null)
const nowTick = ref(Date.now())
const highlightSegId = ref('')
const nextSegId = ref('')       // 「接下来您要去这里」标在谁身上
let tickTimer = null
let focusTimer = null

// ---- 走完撤销（5 秒提示条，不打断、不弹确认框）----
const undo = ref(null)          // { key, index, title }
const undoLeft = ref(0)
let undoTimer = null

// ---- 离线横幅 ----
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine !== false)

// ---- 屏幕常亮 ----
let wakeSentinel = null

// ---- 紧急求助 ----
const sos = ref({ pressing: false, progress: 0, result: null })
let sosTimer = null

// ---- 平安到达 ----
const arriveBanner = ref(null)  // { segId, text }

const codeInput = ref('')
const codeError = ref('')
const CODE_ERROR = '码不对，或者这个码是别的设备上的'

const speaking = ref(false)
const speechUnsupported = ref(false)
const voiceNotice = ref('')     // 闽南话不可用时的如实提示
const nanManifest = ref(null)   // 离线音频清单（可能为空）

// 显示偏好：长辈自己调过的 > 分享里的预设 > 默认
const boot = resolveElderPrefs(null)
const prefs = ref({ scale: boot.scale, theme: boot.theme, wake: boot.wake, voice: boot.voice, autoRead: boot.autoRead })
// 位置共享是「子女授权」，只认分享里带的（本机偏好不能自己给自己开权限）
const shareLocation = ref(false)

const today = todayStr()
const dateText = dateLabel()

// 整趟行程：全部段都列出来，跨天的那几段在卡片上标出日期（长辈只要往下看就不漏）
const cards = computed(() => {
  const list = payload.value && Array.isArray(payload.value.cards) ? payload.value.cards : []
  return list.filter((c) => !!c)
})

const contacts = computed(() => {
  return payload.value && Array.isArray(payload.value.contacts) ? payload.value.contacts : []
})

// 紧急求助打给谁：分享里指定的首选（pr），该位没电话就退到第一位有电话的家人
const preferredContact = computed(() => pickPreferredContact(contacts.value, payload.value && payload.value.pr))
// 首选家人的一句话称呼，用于文案「给阿明打个电话报平安」
const preferredName = computed(() => {
  const c = preferredContact.value
  return (c && (c.name || c.relation)) || '家人'
})

const voiceText = computed(() => {
  return cards.value.map((c) => (c && c.voice) || '').filter(Boolean).join('。')
})

const PAGE_SUFFIX = { day: '', calls: '/calls', show: '/show' }

function parseRoute(path) {
  if (path !== '/e' && !path.startsWith('/e/')) return null
  const segs = path.slice(3).split('/').filter(Boolean)
  if (!segs.length) return { token: '', page: 'day' }
  const sub = segs[1]
  return { token: segs[0], page: sub === 'calls' ? 'calls' : sub === 'show' ? 'show' : 'day' }
}

function stopSpeak() {
  if (speaking.value && 'speechSynthesis' in window) {
    try { window.speechSynthesis.cancel() } catch {}
  }
  stopNanAudio()
  speaking.value = false
}

function applyPayload(p) {
  payload.value = p || null
  speechUnsupported.value = false
  voiceNotice.value = ''
  stopSpeak()
  const rp = resolveElderPrefs(p && p.prefs)
  prefs.value = { scale: rp.scale, theme: rp.theme, wake: rp.wake, voice: rp.voice, autoRead: rp.autoRead }
  shareLocation.value = !!rp.shareLocation
}

// room 只在 token 真正变化时才重建：它决定了读哪一份本机状态、往哪个房间回传
function syncRoom() {
  const r = token ? roomId(token) : ''
  if (r === syncedToken) return
  syncedToken = r
  room.value = r
  if (!r) {
    tasks.value = { done: {}, collapsed: {}, dismissed: {}, todos: {} }
    return
  }
  tasks.value = loadElderState(r)
  probeSync().then((ok) => { syncReady.value = ok })
  // 告诉子女端「长辈打开了行程」（尽力而为，失败就算了）
  push(r, [makeEvent('trip-open', '')])
}

// ---- 长辈端动作：先落本机，再回传 ----
function onToggleDone(ev) {
  const key = ev && ev.key
  if (!key) return
  const wasDone = !!tasks.value.done[key]
  tasks.value = saveElderState(room.value, toggleDone(tasks.value, key))
  const done = !!tasks.value.done[key]
  push(room.value, [makeEvent(done ? 'card-done' : 'card-undone', key, { index: ev.index })])
  if (done) {
    // 勾完之后：① 弹 5 秒撤销条 ② 把下一段顶到眼前并读一句
    scheduleUndo(ev)
    guideToNext(ev && ev.index)
  } else {
    clearUndo()
    if (!wasDone) nextSegId.value = ''
  }
  refreshNotice()
  refreshArriveWatch()
}

// ---- 「接下来」引导：勾完自动把下一段高亮 + 滚到位 + 读一句 ----
function guideToNext(fromIndex) {
  const i = nextPendingAfter(cards.value, tasks.value.done, typeof fromIndex === 'number' ? fromIndex : -1)
  if (i < 0) { nextSegId.value = ''; return }
  const card = cards.value[i]
  const k = card && card.segId != null && card.segId !== '' ? String(card.segId) : 'i' + i
  nextSegId.value = k
  highlightSegId.value = ''
  setTimeout(() => {
    highlightSegId.value = k
    if (focusTimer) clearTimeout(focusTimer)
    focusTimer = setTimeout(() => { highlightSegId.value = '' }, 6000)
  }, 0)
  if (prefs.value.autoRead) {
    // 自动朗读也要跟长辈选的播报语言走：选了闽南话就别用普通话念这句
    if (prefs.value.voice === 'nan') {
      speakCardNan(card, i).then((ok) => {
        if (!ok) {
          voiceNotice.value = '这台设备没有闽南语声音 —— 先用普通话说这句'
          speakOne(nextSpeech(card, '接下来您要去：'))
        }
      })
    } else {
      speakOne(nextSpeech(card, '接下来您要去：'))
    }
  }
}

// ---- 走完撤销：5 秒内可反悔，超时自动消失（不打断、不弹框）----
function scheduleUndo(ev) {
  if (undoTimer) clearInterval(undoTimer)
  undo.value = { key: ev.key, index: ev.index, title: (cards.value[ev.index] && cards.value[ev.index].title) || '' }
  undoLeft.value = 5
  undoTimer = setInterval(() => {
    undoLeft.value -= 1
    if (undoLeft.value <= 0) clearUndo()
  }, 1000)
}

function clearUndo() {
  if (undoTimer) { clearInterval(undoTimer); undoTimer = null }
  undo.value = null
  undoLeft.value = 0
}

function undoDone() {
  const u = undo.value
  if (!u) return
  clearUndo()
  tasks.value = saveElderState(room.value, toggleDone(tasks.value, u.key))
  push(room.value, [makeEvent('card-undone', u.key, { index: u.index })])
  nextSegId.value = ''
  refreshNotice()
  refreshArriveWatch()
}

function onToggleCollapse(ev) {
  const key = ev && ev.key
  if (!key) return
  const willCollapse = !tasks.value.collapsed[key]
  tasks.value = saveElderState(room.value, toggleCollapsed(tasks.value, key))
  push(room.value, [makeEvent(willCollapse ? 'card-collapse' : 'card-open', key, { index: ev.index })])
}

// 勾选 / 取消「到了之后做什么」：本机记账 + 回传，让子女端实时看到长辈在干什么
function onToggleTodo(ev) {
  const key = ev && ev.key
  const index = ev && ev.index
  if (!key || index == null) return
  tasks.value = saveElderState(room.value, toggleTodo(tasks.value, key, index))
  const done = !!tasks.value.todos[todoKey(key, index)]
  push(room.value, [makeEvent(done ? 'todo-done' : 'todo-undone', key, { index, text: ev.text || '' })])
}

// 显示页「回到主页面」：长辈端没有登录，有账号回首页，没有就回欢迎页
function onExit() {
  navigate(store.account ? '/home' : '/')
}

// ---- 出发提醒 ----
function refreshNotice() {
  nowTick.value = Date.now()
  const now = new Date(nowTick.value)
  const list = upcomingList(cards.value, now).filter((it) => shouldRemind(tasks.value, it, now))
  if (!list.length) { notice.value = null; return }
  const first = list[0]
  const c = first.card || {}
  notice.value = {
    segId: first.segId,
    stage: first.stage,
    countdown: countdownText(first.minutesLeft),
    title: noticeTitle(first),
    detail: c.note || '',
    more: list.length - 1,
  }
}

function onNoticeJump() {
  const segId = notice.value && notice.value.segId
  notice.value = null
  if (!segId) return
  page.value = 'day'
  navigate('/e/' + token + PAGE_SUFFIX.day)
  highlightSegId.value = ''
  // 下一帧再设，确保 DayView 已经渲染出这张卡
  setTimeout(() => {
    highlightSegId.value = segId
    if (focusTimer) clearTimeout(focusTimer)
    focusTimer = setTimeout(() => { highlightSegId.value = '' }, 6000)
  }, 0)
}

function onNoticeDismiss() {
  const n = notice.value
  if (!n) return
  tasks.value = saveElderState(room.value, markDismissed(tasks.value, n.segId, n.stage))
  notice.value = null
}

// ---- 平安到达（纯静态降级：长辈端本机就能判断并提醒）----
// 过了预计到达时刻 1 小时还没勾「走完」→ 本机横幅提醒给家人打电话，同时回报给子女端（每段只报一次）。
function refreshArriveWatch() {
  const now = new Date(Date.now())
  const list = arrivalCheckpoints(cards.value, tasks.value.done, now)
  const hit = list.find((it) => !tasks.value.dismissed[it.segId + ':arrive'])
  if (!hit) { arriveBanner.value = null; return }
  const hhmm = `${String(hit.arriveAt.getHours()).padStart(2, '0')}:${String(hit.arriveAt.getMinutes()).padStart(2, '0')}`
  arriveBanner.value = {
    segId: hit.segId,
    text: `预计 ${hhmm} 到达，现在还没确认「走完」——给${preferredName.value}打个电话报平安吧`,
  }
  // 去重记账：同一个 segId 只回报一次
  if (!tasks.value.dismissed[hit.segId + ':arrive-pushed']) {
    tasks.value = saveElderState(room.value, markDismissed(tasks.value, hit.segId, 'arrive-pushed'))
    push(room.value, [makeEvent('arrive-missed', hit.segId, { minutes: hit.overdueMin, eta: hit.arriveAt.getTime() })])
  }
}

function onArriveDismiss() {
  const b = arriveBanner.value
  if (!b) return
  tasks.value = saveElderState(room.value, markDismissed(tasks.value, b.segId, 'arrive'))
  arriveBanner.value = null
}

const nextText = computed(() => {
  if (page.value !== 'day' || state.value !== 'ok') return ''
  return nextDepartText(cards.value, new Date(nowTick.value))
})

// 位置共享时顺带把「最近一个该到了的到达点」报给服务端 —— 服务端据此做超时比对（可选增强）
const etaForPresence = computed(() => {
  const now = new Date(nowTick.value)
  const next = nextArrivalCheckpoint(cards.value, tasks.value.done, now)
  if (next) return { segId: next.segId, at: next.arriveAt.getTime() }
  const past = arrivalCheckpoints(cards.value, tasks.value.done, now)[0]
  return past ? { segId: past.segId, at: past.arriveAt.getTime() } : null
})

function startTicking() {
  if (tickTimer) return
  refreshNotice()
  refreshArriveWatch()
  tickTimer = setInterval(() => {
    refreshNotice()
    refreshArriveWatch()
  }, 30000)
}

function stopTicking() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  if (focusTimer) { clearTimeout(focusTimer); focusTimer = null }
}

// ---- 屏幕常亮（Wake Lock）：行程日自动申请，离开/切到后台就释放 ----
function supportsWakeLock() {
  return typeof navigator !== 'undefined' && !!navigator.wakeLock && typeof navigator.wakeLock.request === 'function'
}

function requestWake() {
  if (!supportsWakeLock() || !prefs.value.wake) return
  if (state.value !== 'ok' || page.value !== 'day') return
  if (typeof document !== 'undefined' && document.hidden) return
  if (wakeSentinel) return
  try {
    navigator.wakeLock.request('screen').then((s) => {
      wakeSentinel = s
      if (s && typeof s.addEventListener === 'function') {
        s.addEventListener('release', () => { wakeSentinel = null })
      }
    }).catch(() => { wakeSentinel = null }) // 不支持/被拒绝：静默降级
  } catch { wakeSentinel = null }
}

function releaseWake() {
  const s = wakeSentinel
  wakeSentinel = null
  if (s && typeof s.release === 'function') { try { s.release() } catch {} }
}

// ---- 离线横幅：一句人话安人心，不说「离线缓存」 ----
function onOnline() { online.value = true }
function onOffline() { online.value = false }

// ---- 紧急求助：长按 1 秒才触发（防手滑）；进度用 JS 刷新，不写 CSS 动画 ----
const SOS_HOLD_MS = 1000
const SOS_TICK_MS = 100

function onSosDown() {
  if (sosTimer) clearInterval(sosTimer)
  sos.value = { pressing: true, progress: 0, result: sos.value.result }
  const started = Date.now()
  sosTimer = setInterval(() => {
    const pct = Math.min(100, Math.round(((Date.now() - started) / SOS_HOLD_MS) * 100))
    sos.value = { ...sos.value, progress: pct }
    if (pct >= 100) {
      clearInterval(sosTimer)
      sosTimer = null
      triggerSos()
    }
  }, SOS_TICK_MS)
}

function onSosUp() {
  if (sosTimer) { clearInterval(sosTimer); sosTimer = null }
  if (sos.value.pressing) sos.value = { ...sos.value, pressing: false, progress: 0 }
}

function sosGeo() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return }
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => finish(p && p.coords ? { lat: p.coords.latitude, lng: p.coords.longitude } : null),
        () => finish(null),
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 },
      )
    } catch { finish(null) }
    setTimeout(() => finish(null), 8500)
  })
}

async function triggerSos() {
  onSosUp()
  const c = preferredContact.value
  const name = store.account ? store.account.name : ''
  const tripTitle = (payload.value && payload.value.title) || ''
  const geo = await sosGeo()
  const text = buildSosText({ name, tripTitle, lat: geo && geo.lat, lng: geo && geo.lng })
  const hasLoc = !!(geo && hasLocation(geo.lat, geo.lng))
  // 让子女端实时看到「长辈按了紧急求助」（尽力而为）
  push(room.value, [makeEvent('sos', '', { hasLoc })])
  if (!c || !c.phone) {
    sos.value = { pressing: false, progress: 0, result: { noContact: true, text } }
    return
  }
  const tel = buildTelHref(c.phone)
  const sms = buildSmsHref(c.phone, text)
  sos.value = {
    pressing: false,
    progress: 0,
    result: { label: contactLabel(c), phone: maskPhone(c.phone), hasLoc, text, tel, sms },
  }
  // 先拨号，再把位置短信交给系统短信 App（浏览器不能自己发短信，如实走本机）
  try { if (tel) window.location.href = tel } catch {}
  setTimeout(() => { try { if (sms) window.location.href = sms } catch {} }, 600)
}

// ---- 语音播报：普通话走设备 TTS；闽南话优先设备台语声音，否则播离线音频包 ----
function deviceVoices() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  try { return window.speechSynthesis.getVoices() || [] } catch { return [] }
}

function speakText(text, lang, voice) {
  if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang || 'zh-CN'
    u.rate = 0.9
    if (voice) u.voice = voice
    u.onend = () => { speaking.value = false }
    u.onerror = () => { speaking.value = false }
    window.speechSynthesis.speak(u)
    return true
  } catch { return false }
}

// 勾完下一段时那一句：「接下来您要去：G7102 上海虹桥站 到 北京南站」
function nextSpeech(card, prefix) {
  if (!card) return ''
  const bits = [card.code, card.title].filter(Boolean).join(' ')
  const route = card.from ? `${card.from} 到 ${card.to || ''}` : (card.to || '')
  const when = card.depart ? `，${card.depart} 出发` : ''
  return `${prefix}${[bits, route].filter(Boolean).join('，')}${when}。`
}

function speakOne(text) {
  if (!text) return
  try { window.speechSynthesis.cancel() } catch {}
  if (speakText(text, 'zh-CN')) speaking.value = true
}

// 闽南话逐段播：设备有台语声音就念动态完整句；否则播离线音频包；
// 音频放不出来（部分浏览器不带 mp3 解码器）就退回设备 TTS；实在没有就如实说清楚。
let nanAudio = null
function stopNanAudio() {
  if (nanAudio) { try { nanAudio.pause() } catch {} nanAudio = null }
}

// 播一个音频文件；返回是否真的播完了（放不出来返回 false，交给上层降级）
function playAudio(src) {
  return new Promise((resolve) => {
    try {
      nanAudio = new Audio(src)
      nanAudio.onended = () => resolve(true)
      nanAudio.onerror = () => resolve(false)
      const r = nanAudio.play()
      if (r && typeof r.catch === 'function') r.catch(() => resolve(false))
    } catch { resolve(false) }
  })
}

// 等设备 TTS 念完（没有事件时按超时兜底，避免卡住）
function speechDone(timeoutMs = 20000) {
  return new Promise((resolve) => {
    try {
      if (typeof window === 'undefined' || !window.speechSynthesis) { resolve(); return }
      const t = setInterval(() => {
        if (!window.speechSynthesis.speaking) { clearInterval(t); resolve() }
      }, 400)
      setTimeout(() => { clearInterval(t); resolve() }, timeoutMs)
    } catch { resolve() }
  })
}

// 播放一条已决策的语音项；返回 { spoke, degraded }：
//   spoke   = 这次到底出没出声（音频播完或 TTS 念了都算）
//   degraded= 走了降级（音频放不出退 TTS / TTS 也失败）
async function playResolved(v) {
  if (v.mode === 'pack') {
    const played = await playAudio(v.src)
    if (played) return { spoke: true, degraded: false }
    // 这台设备放不出这个音频格式（少见，但真会发生）→ 退回设备 TTS
    const spoke = speakText(v.text, v.lang || 'nan-TW', v.voice)
    if (spoke) await speechDone()
    return { spoke, degraded: true }
  }
  const spoke = speakText(v.text, v.lang, v.voice)
  if (spoke) await speechDone()
  return { spoke, degraded: !spoke }
}

// 只念某一张卡（闽南话）：返回是否出了声；false = 这台设备没有闽南语能力（连音频包都没有）
async function speakCardNan(card, index) {
  const v = resolveVoice({
    voice: 'nan', card, index,
    manifest: nanManifest.value || { items: {} }, deviceVoices: deviceVoices(),
  })
  if (v.mode === 'none') return false
  stopNanAudio()
  try { window.speechSynthesis.cancel() } catch {}
  speaking.value = true
  try {
    return (await playResolved(v)).spoke
  } catch {
    return false
  } finally {
    speaking.value = false
  }
}

async function speakNan() {
  voiceNotice.value = ''
  const voices = deviceVoices()
  const manifest = nanManifest.value || { items: {} }
  const resolved = cards.value.map((c, i) => resolveVoice({ voice: 'nan', card: c, index: i, manifest, deviceVoices: voices }))
  const usable = resolved.filter((v) => v.mode !== 'none')
  if (!usable.length) {
    voiceNotice.value = '这台设备没有闽南语声音，音频包也没装上 —— 先切回普通话吧'
    return
  }
  speaking.value = true
  let degraded = false
  try {
    for (const v of usable) {
      if (!speaking.value) break
      if ((await playResolved(v)).degraded) degraded = true
    }
  } catch {
    // 任何意外都不该让长辈端卡在"播报中"——如实降级到普通话
    degraded = true
  }
  speaking.value = false
  if (degraded) voiceNotice.value = '这台设备放不出闽南语声音 —— 先切回普通话吧'
}

function onPickVoice(v) {
  applyPrefs({ voice: v })
  if (v !== 'nan') { stopNanAudio(); voiceNotice.value = '' }
}

function onSavePoster() {
  const list = cards.value
  if (!list.length) return
  try {
    downloadCardsPoster(list, { title: (payload.value && payload.value.title) || '家人出行' })
  } catch {}
}

// ---- 「记住这台手机」：输码成功后记住，下次一键回来 ----
function continueLast() {
  const last = lastTrip.value
  if (!last) { state.value = 'code'; return }
  navigate('/e/' + last.token)
}

function switchTrip() {
  clearLastElderTrip()
  lastTrip.value = null
  goCode()
}

function rememberTrip(p) {
  if (!token || !p) return
  const first = (p.cards || []).find((c) => c && c.date)
  const rec = saveLastElderTrip({ token, title: p.title || '', startDate: (first && first.date) || '' })
  if (rec) lastTrip.value = rec
}

function applyPrefs(next) {
  // 合并而不是覆盖：设置页只改一两项时，其余（语言/常亮/自动读）不能被重置
  prefs.value = saveElderPrefs({ ...prefs.value, ...(next || {}) })
}

// 路由 → 状态机。子页面切换不重新解码（否则会闪、也没必要）。
function resolveRoute() {
  const r = parseRoute(route.path || '')
  if (!r || !r.token) {
    token = ''
    payload.value = null
    stopSpeak()
    // 「记住这台手机」：本机有上次看过的行程就先问一句，而不是直接把人丢进输码页
    lastTrip.value = loadLastElderTrip()
    state.value = lastTrip.value ? 'resume' : 'code'
    syncRoom()
    releaseWake()
    return
  }
  if (r.token !== token) {
    token = r.token
    let res = null
    try { res = decodeShare(r.token) } catch { res = { ok: false, reason: 'malformed' } }
    if (res && res.ok) {
      applyPayload(res.payload)
      // 注意：只有「输 6 位码」这条路才记住本机（见 submitCode）。
      // 打开分享链接不记 —— 子女常在自己手机上预览长辈页，不该被顺手续上。
      state.value = 'ok'
    } else if (res && res.reason === 'expired') {
      payload.value = null
      state.value = 'expired'
    } else {
      payload.value = null
      state.value = 'malformed'
    }
  }
  page.value = r.page
  syncRoom()
  window.scrollTo(0, 0)
}
watch(() => route.path, resolveRoute, { immediate: true })
// 进到行程页且停在「行程」页时申请常亮；换页/离开时释放
watch([() => state.value, () => page.value, () => prefs.value.wake], () => {
  if (state.value === 'ok' && page.value === 'day') requestWake()
  else releaseWake()
})

function goPage(p) {
  if (!token) return
  navigate('/e/' + token + PAGE_SUFFIX[p])
}

// 6 位码：遍历本机 ptb:data:* 桶里的 shares，命中 code6 后解码其 token；任何一步失败都给同一句提示
function submitCode() {
  codeError.value = ''
  const code = String(codeInput.value || '').replace(/\s+/g, '')
  if (!code) { codeError.value = CODE_ERROR; return }
  let found = null
  try {
    const ls = window.localStorage
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i)
      if (!key || key.indexOf('ptb:data:') !== 0) continue
      let bucket = null
      try { bucket = JSON.parse(ls.getItem(key)) } catch { bucket = null }
      const shares = bucket && Array.isArray(bucket.shares) ? bucket.shares : []
      const hit = shares.find((s) => s && s.code6 != null && String(s.code6) === code)
      if (hit) { found = hit; break }
    }
  } catch { found = null }
  if (!found || !found.token) { codeError.value = CODE_ERROR; return }
  let res = null
  try { res = decodeShare(found.token) } catch { res = { ok: false, reason: 'malformed' } }
  if (res && res.ok) {
    codeInput.value = ''
    token = found.token
    applyPayload(res.payload)
    rememberTrip(res.payload) // 「记住这台手机」：下次进来直接看到「继续上次的行程」
    page.value = 'day'
    state.value = 'ok'
    syncRoom()
    navigate('/e/' + token)
  } else if (res && res.reason === 'expired') {
    state.value = 'expired'
  } else {
    state.value = 'malformed'
  }
}

function goCode() {
  codeInput.value = ''
  codeError.value = ''
  token = ''
  payload.value = null
  state.value = 'code'
  navigate('/e')
}

function onSpeakClick() {
  // 闽南话：先按设备能力/音频包决定怎么念（见 core/elderVoice.js）
  if (prefs.value.voice === 'nan') {
    if (speaking.value) { stopSpeak(); stopNanAudio(); return }
    speakNan()
    return
  }
  if (!('speechSynthesis' in window)) { speechUnsupported.value = true; return }
  if (speaking.value) { stopSpeak(); return }
  const text = voiceText.value
  if (!text) return
  try {
    window.speechSynthesis.cancel()
    const parts = String(text).split(/(?<=[。！？；，])/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part)
      u.lang = 'zh-CN'
      u.rate = 0.9
      if (i === parts.length - 1) {
        u.onend = () => { speaking.value = false }
        u.onerror = () => { speaking.value = false }
      }
      window.speechSynthesis.speak(u)
    })
    speaking.value = true
  } catch {
    speaking.value = false
    speechUnsupported.value = true
  }
}

// 只有真的看到行程了才开始盯着出发时间（30 秒一次；JS 定时器不影响「零动画」断言）
watch(state, (s) => {
  if (s === 'ok') startTicking()
  else stopTicking()
}, { immediate: true })

// 离线横幅 + 常亮：页面可见性/网络状态变化都要跟着处理（Wake Lock 在隐藏后会被浏览器释放）
function onVisibility() {
  if (typeof document === 'undefined') return
  if (document.hidden) releaseWake()
  else if (state.value === 'ok' && page.value === 'day') requestWake()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

// 闽南话音频清单：按需加载一次（缺文件也不影响其它功能）
loadNanManifest().then((m) => { nanManifest.value = m })

onBeforeUnmount(() => {
  stopSpeak()
  stopNanAudio()
  stopTicking()
  clearUndo()
  releaseWake()
  if (sosTimer) { clearInterval(sosTimer); sosTimer = null }
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div class="elder-root" :class="'theme-' + prefs.theme" :style="{ '--el-scale': String(prefs.scale) }">
    <!-- 三种"非展示"状态：都没有底栏 -->
    <main v-if="state !== 'ok'" class="elder-main">
      <template v-if="state === 'code'">
        <h1 class="elder-h1">输入子女给的 <span class="nowrap">6 位码</span></h1>
        <form class="code-form" @submit.prevent="submitCode">
          <label class="code-label" for="elder-code">6 位码</label>
          <input
            id="elder-code"
            v-model="codeInput"
            class="code-input"
            type="text"
            inputmode="numeric"
            maxlength="6"
            autocomplete="one-time-code"
          />
          <button type="submit" class="big-btn">查看行程</button>
        </form>
        <p v-if="codeError" class="form-error" role="alert">{{ codeError }}</p>
        <p v-if="codeError" class="form-note">6 位码只在家人设置过的这台手机/电脑上有效</p>
      </template>

      <template v-else-if="state === 'resume'">
        <h1 class="elder-h1">欢迎回来</h1>
        <p class="recover-text">这台手机记住了您上次的行程</p>
        <button type="button" class="big-btn resume-btn" @click="continueLast">
          <span class="resume-main">继续上次的行程</span>
          <span class="resume-sub">{{ lastTrip && lastTrip.title ? lastTrip.title : '上次看过的行程' }}<template v-if="lastTrip && lastTrip.startDate"> · {{ lastTrip.startDate }} 出发</template></span>
        </button>
        <button type="button" class="back-btn resume-alt" @click="switchTrip">换一个行程</button>
        <p class="form-note">换手机或清掉浏览器时，会自动变回输码页</p>
      </template>

      <template v-else-if="state === 'expired'">
        <h1 class="elder-h1">链接过期了</h1>
        <p class="recover-text">请让子女重新发一次，旧链接就不能用了</p>
        <button type="button" class="big-btn" @click="goCode">输入 6 位码试试</button>
      </template>

      <template v-else>
        <h1 class="elder-h1">链接好像不对</h1>
        <p class="recover-text">可能复制漏了字符。请让子女重新发一次</p>
        <button type="button" class="big-btn" @click="goCode">输入 6 位码试试</button>
      </template>
    </main>

    <template v-else>
      <main class="elder-main">
        <!-- 断网横幅：一句人话安人心（不说「离线缓存」这种词） -->
        <p v-if="!online" class="offline-banner" role="status">没有网络 · 行程已经存在这台手机里</p>

        <DayView
          v-if="page === 'day'"
          :cards="cards"
          :today="today"
          :trip-title="payload && payload.title ? payload.title : ''"
          :date-text="dateText"
          :speaking="speaking"
          :speech-unsupported="speechUnsupported"
          :done-map="tasks.done"
          :collapsed-map="tasks.collapsed"
          :todos-map="tasks.todos"
          :highlight-seg-id="highlightSegId"
          :next-seg-id="nextSegId"
          :next-text="nextText"
          :voice="prefs.voice"
          :voice-notice="voiceNotice"
          :arrive-text="arriveBanner ? arriveBanner.text : ''"
          @speak="onSpeakClick"
          @pick-voice="onPickVoice"
          @save-poster="onSavePoster"
          @arrive-ok="onArriveDismiss"
          @toggle-done="onToggleDone"
          @toggle-collapse="onToggleCollapse"
          @toggle-todo="onToggleTodo"
        >
          <!-- 紧急求助：常驻页顶，长按 1 秒才触发（防手滑，不弹二次确认） -->
          <template #top>
            <div class="sos">
              <button
                type="button"
                class="el-sos"
                :class="{ 'el-sos-press': sos.pressing }"
                :aria-label="'遇到困难，按住这个按钮一秒，给' + preferredName + '打电话求助'"
                @pointerdown.prevent="onSosDown"
                @pointerup="onSosUp"
                @pointerleave="onSosUp"
                @pointercancel="onSosUp"
                @contextmenu.prevent
              >
                <span class="sos-line">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.6 3h2.2l1.2 4.7-1.9 1.5a12.8 12.8 0 0 0 5.7 5.7l1.5-1.9L20 14.2v2.2A2.6 2.6 0 0 1 17.4 19C10 18.5 5.5 14 5 6.6A2.6 2.6 0 0 1 6.6 3Z" fill="currentColor"/></svg>
                  <span>{{ sos.pressing ? '再按住一会儿…' : '遇到困难，按住这个按钮' }}</span>
                </span>
                <span v-if="sos.pressing" class="sos-prog" aria-hidden="true"><i :style="{ width: sos.progress + '%' }"></i></span>
              </button>
              <p v-if="sos.pressing" class="sos-hint">要按住不放 1 秒，才会开始求助（防手滑）</p>

              <div v-if="sos.result" class="sos-result" role="status">
                <template v-if="sos.result.noContact">
                  <p class="sr-row"><span class="ck">!</span>还没有家人的电话，打不出去</p>
                  <p class="sr-row"><span class="ck">✓</span>已经把这个情况告诉了子女端</p>
                </template>
                <template v-else>
                  <p class="sr-row"><span class="ck">✓</span>正在拨打：{{ sos.result.label }} {{ sos.result.phone }}</p>
                  <p class="sr-row">
                    <span class="ck">✓</span>
                    {{ sos.result.hasLoc ? '已经把您现在的位置，用短信发给了' + sos.result.label : '这台手机暂时拿不到位置，短信已写明请先打电话' }}
                  </p>
                </template>
              </div>
              <p class="sos-note">首选联系人在「家人」页排第一个；子女可以在分享页改谁是首选</p>
            </div>
          </template>
        </DayView>

        <CallsView v-else-if="page === 'calls'" :contacts="contacts" :preferred-index="payload && payload.pr" @back="goPage('day')" />
        <ShowView
          v-else
          :scale="prefs.scale"
          :theme="prefs.theme"
          :wake="prefs.wake"
          :auto-read="prefs.autoRead"
          :supports-wake="supportsWakeLock()"
          @pick="applyPrefs"
          @back="goPage('day')"
          @exit="onExit"
        />

        <!-- 走完撤销：5 秒内可反悔，超时自动消失（不打断、不弹框） -->
        <div v-if="undo && page === 'day'" class="el-toast" role="status">
          <span class="t1">刚才把「{{ undo.title || '这一段' }}」标成了走完</span>
          <span class="t2">手滑点错了？<button type="button" class="undo-btn" @click="undoDone">撤销</button>（还有 {{ undoLeft }} 秒）</span>
        </div>

        <!-- 位置共享：只有子女在分享页开了口子才出现（长辈还得自己再点一次） -->
        <LocationShare
          v-if="page === 'day' && shareLocation"
          :room="room"
          :mode="syncReady ? 'server' : 'device'"
          :eta="etaForPresence"
        />
      </main>

      <nav class="action-bar" aria-label="长辈端导航">
        <button
          type="button"
          class="bar-btn"
          :class="{ active: page === 'day' }"
          :aria-current="page === 'day' ? 'page' : undefined"
          aria-label="行程"
          @click="goPage('day')"
        >行程</button>
        <button
          type="button"
          class="bar-btn"
          :class="{ active: page === 'calls' }"
          :aria-current="page === 'calls' ? 'page' : undefined"
          aria-label="家人电话"
          @click="goPage('calls')"
        >家人</button>
        <button
          type="button"
          class="bar-btn"
          :class="{ active: page === 'show' }"
          :aria-current="page === 'show' ? 'page' : undefined"
          aria-label="显示设置"
          @click="goPage('show')"
        >显示</button>
      </nav>
    </template>

    <!-- 出发提醒：页内弹窗，点「去看看」直接跳到那张卡 -->
    <NoticePopup
      v-if="notice"
      :countdown="notice.countdown"
      :title="notice.title"
      :detail="notice.detail"
      :more="notice.more"
      @jump="onNoticeJump"
      @dismiss="onNoticeDismiss"
    />
  </div>
</template>

<style scoped>
/* 长辈端只消费 global.css 的 --el-* token；全页零动画（不写 animation / transition）。 */
.elder-root {
  /* 字号刻度：改 --el-scale 就整体放大/缩小（子女端预设或长辈自己调） */
  --el-scale: 1;
  --el-fs-28: calc(28px * var(--el-scale));
  --el-fs-30: calc(30px * var(--el-scale));
  --el-fs-32: calc(32px * var(--el-scale));
  --el-fs-34: calc(34px * var(--el-scale));
  --el-fs-36: calc(36px * var(--el-scale));
  --el-fs-40: calc(40px * var(--el-scale));
  --el-fs-44: calc(44px * var(--el-scale));
  --el-hit-sm: calc(84px * var(--el-scale));
  --el-hit-lg: calc(88px * var(--el-scale));

  min-height: 100vh;
  background: var(--el-bg);
  color: var(--el-ink);
  /* CJK 兜底放在最后：某些安卓 WebView 缺中文字形时会掉到默认字体，出现方块/乱码 */
  font-family: -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', sans-serif;
  font-size: var(--el-fs-30);
  line-height: 1.6;
  /* 全局 body 用的是 antialiased，中文会显细；长辈端改回默认渲染，笔画更实 */
  -webkit-font-smoothing: subpixel-antialiased;
}
/* 主题变体：只换 token，不动结构。三种主题的正文对比度都 ≥7:1（机器断言守着）。
   配色走"站牌"：没有暖奶油、没有陶土红、没有衬线 —— 与 Claude 的视觉签名无关。 */
.elder-root.theme-contrast {
  /* 高对比：纯黑 + 纯白 + 琥珀；按钮翻成琥珀底黑字，而不是亮黄配白字 */
  --el-bg: #000000;
  --el-card: #0A0A09;
  --el-ink: #FFFFFF;
  --el-ink-2: #E4E4DE;
  --el-line: #6E6E68;
  --el-tint: #FFD400;
  --el-tint-ink: #000000;
  --el-accent: #FFD400;
  --el-btn-bg: #FFD400;
  --el-btn-ink: #000000;
  --el-btn-line: #FFD400;
  --el-danger: #FF9A8F;
  --el-stay: #FFD400;
  --el-error-bg: #3A0F0A;
  --el-todo-high: #FF9A8F;
  --el-todo-normal: #FFD400;
  --el-todo-low: #E4E4DE;
  --el-sos: #C62828;
  --el-sos-press: #8E1B1B;
}
.elder-root.theme-night {
  --el-bg: #0D0F0E;
  --el-card: #171A18;
  --el-ink: #F4F6F3;
  --el-ink-2: #B7BCB4;
  --el-line: #323730;
  --el-tint: #F4F6F3;
  --el-tint-ink: #0D0F0E;
  --el-accent: #3FA06E;
  --el-btn-bg: #0B6B45;
  --el-btn-ink: #FFFFFF;
  --el-btn-line: #0B6B45;
  --el-danger: #FF9A8F;
  --el-stay: #D8A657;
  --el-error-bg: #3A1F1C;
  --el-todo-high: #FF9A8F;
  --el-todo-normal: #3FA06E;
  --el-todo-low: #B7BCB4;
  --el-sos: #A31D10;
  --el-sos-press: #7E1509;
}
.elder-main {
  max-width: 640px;
  margin: 0 auto;
  padding: 40px 20px 200px;
}

/* ---- 输码 / 恢复页 ---- */
.elder-h1 {
  margin: 0 0 26px;
  /* 站牌语言：粗黑体，不用衬线（衬线是"书卷/AI 味"的来源，也削弱远距离辨识） */
  font-family: var(--f-sans);
  font-size: var(--el-fs-44);
  line-height: 1.28;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--el-ink);
}
.nowrap { white-space: nowrap; }
.code-form { margin: 0; }
.code-label {
  display: block;
  margin: 0 0 12px;
  font-size: var(--el-fs-30);
  font-weight: 700;
  color: var(--el-ink);
}
.code-input {
  display: block;
  width: 100%;
  max-width: 440px;
  height: var(--el-hit-sm);
  margin: 0 0 22px;
  padding: 0 16px;
  background: var(--el-card);
  border: 3px solid var(--el-accent);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-34);
  font-weight: 700;
  letter-spacing: 12px;
  text-align: center;
}
/* .big-btn / .back-btn 在 global.css：跨视图复用，scoped 写在这里子组件拿不到 */
.form-error {
  margin: 22px 0 8px;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--el-error-bg);
  border: 2px solid rgba(143, 29, 16, 0.35);
  color: var(--el-danger);
  font-size: var(--el-fs-30);
  font-weight: 600;
}
.form-note { margin: 0; font-size: var(--el-fs-30); font-weight: 500; color: var(--el-ink-2); }
.recover-text { margin: 0 0 28px; font-size: var(--el-fs-30); font-weight: 500; color: var(--el-ink-2); }

/* ---- 底部导航：一个按钮一个页面 ---- */
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 12px 14px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  background: var(--el-card);
  border-top: 2px solid var(--el-line);
}
.bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--el-hit-lg);
  padding: 8px 6px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-30);
  font-weight: 700;
}
/* 当前页：实底按钮（日间/夜间为绿底白字，高对比为黄底黑字），文字色同样取自按钮 token */
.bar-btn.active {
  border-color: var(--el-btn-line);
  background: var(--el-btn-bg);
  color: var(--el-btn-ink);
  box-shadow: none;
}

/* ---- 记住这台手机：欢迎回来 ---- */
.resume-btn { flex-direction: column; gap: 6px; }
.resume-main { font-size: var(--el-fs-34); font-weight: 700; }
.resume-sub { font-size: var(--el-fs-28); font-weight: 600; opacity: 0.92; }
.resume-alt { margin-bottom: 0; }

/* ---- 断网横幅 ---- */
.offline-banner {
  display: flex;
  align-items: center;
  margin: 0 0 20px;
  padding: 16px 20px;
  border-radius: var(--el-r);
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-30);
  font-weight: 700;
  line-height: 1.45;
}

/* ---- 紧急求助：常驻页顶 ---- */
.sos { margin: 0 0 22px; }
.el-sos {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: var(--el-hit-lg);
  padding: 12px 20px;
  background: var(--el-sos);
  border: 2px solid var(--el-sos);
  border-radius: var(--el-r);
  color: #FFFFFF;
  font-size: var(--el-fs-32);
  font-weight: 800;
  letter-spacing: 1px;
}
.el-sos-press { background: var(--el-sos-press); border-color: var(--el-sos-press); }
.sos-line { display: flex; align-items: center; gap: 14px; }
/* 进度条：宽度由 JS 每次刷新（不写 transition/animation，守住零动效红线） */
.sos-prog {
  display: block;
  width: 78%;
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.32);
  overflow: hidden;
}
.sos-prog i { display: block; height: 100%; background: #FFFFFF; }
.sos-hint {
  margin: 10px 0 0;
  font-size: var(--el-fs-28);
  font-weight: 600;
  color: var(--el-ink-2);
}
.sos-note {
  margin: 10px 0 0;
  font-size: var(--el-fs-28);
  font-weight: 500;
  color: var(--el-ink-2);
}
.sos-result {
  margin: 18px 0 0;
  padding: 16px 18px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-radius: var(--el-r);
}
.sr-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 0;
  font-size: var(--el-fs-28);
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.sr-row + .sr-row { margin-top: 12px; }
.sr-row .ck {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--el-accent);
  color: #FFFFFF;
  font-size: 22px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 4px;
}

/* ---- 走完撤销条 ---- */
.el-toast {
  margin: 4px 0 16px;
  padding: 14px 18px;
  border-radius: var(--el-r);
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-28);
  line-height: 1.45;
}
.el-toast .t1 { display: block; opacity: 0.85; font-weight: 600; }
.el-toast .t2 { display: block; margin-top: 8px; font-weight: 700; }
.undo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: calc(60px * var(--el-scale));
  min-width: calc(104px * var(--el-scale));
  margin: 0 8px;
  padding: 4px 20px;
  background: transparent;
  border: 2px solid currentColor;
  border-radius: var(--el-r);
  color: inherit;
  font-size: var(--el-fs-28);
  font-weight: 800;
  letter-spacing: 1px;
}
</style>