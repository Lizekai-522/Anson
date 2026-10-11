<script setup>
// 行程详情：核对 + 手动修正。改完一段重跑 sanityCheck 刷新问题列表。
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, uid, upsertTrip, removeTrip, getTrip, listShares } from '../core/store.js'
import { sanityCheck, createBlankSegment, refreshPlain, issueLabel, TODO_LEVELS as TODO_LEVEL_KEYS, guessCity } from '../core/agents.js'
import { fetchWeather } from '../core/weather.js'
import { fetchCityCoords } from '../core/geo.js'
import { runAssist, applyAssist, hasWork } from '../core/ai.js'
import { loadModelConfig, isConfigured, reasonText } from '../core/model.js'
import { downloadIcs, downloadTripPoster } from '../core/export.js'
import { buildChecklist, checklistGroups, toggleChecklistItem } from '../core/checklist.js'
import { roomId, subscribe, probeSync } from '../core/sync.js'
import RealMap from '../components/RealMap.vue'

const props = defineProps({ params: { type: Object, default: () => ({}) } })

// 本地时区 'YYYY-MM-DD'
function fmt(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const trip = computed(() => getTrip(props.params.id))

// ---- 标题（衬线大字，失焦保存）----
const titleText = ref('')
watch(() => trip.value && trip.value.id, () => {
  titleText.value = (trip.value && trip.value.title) || ''
}, { immediate: true })
function saveTitle() {
  const t = trip.value
  if (!t) return
  const v = titleText.value.trim()
  if (!v || v === t.title) { titleText.value = t.title; return }
  upsertTrip({ ...t, title: v, updatedAt: Date.now() })
}

// ---- 删除行程（两步确认）----
const confirmKey = ref('')
let confirmTimer = null
function askConfirm(key) {
  if (confirmKey.value === key) {
    confirmKey.value = ''
    clearTimeout(confirmTimer)
    return true
  }
  confirmKey.value = key
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => { confirmKey.value = '' }, 3000)
  return false
}
function deleteTripClick() {
  const t = trip.value
  if (!t) return
  if (!askConfirm('trip')) return
  removeTrip(t.id)
  toast('行程已删除', 'info')
  navigate('/home')
}
onBeforeUnmount(() => clearTimeout(confirmTimer))

// ---- 问题汇总：error 优先 ----
const LEVEL_RANK = { error: 0, warn: 1, info: 2 }
const sortedIssues = computed(() => {
  const arr = [...((trip.value && trip.value.issues) || [])]
  arr.sort((a, b) => (LEVEL_RANK[a.level] ?? 3) - (LEVEL_RANK[b.level] ?? 3))
  return arr
})
// 默认折叠：条数一多就糊一屏，用户要看时自己展开。
const issuesOpen = ref(false)
const issueCounts = computed(() => {
  const c = { error: 0, warn: 0, info: 0 }
  for (const iss of sortedIssues.value) c[iss.level] = (c[iss.level] || 0) + 1
  return c
})
// 点某条问题 → 滚到对应行程卡片并高亮两秒，方便一眼找到是哪一段。
const flashId = ref('')
let flashTimer = null
function focusIssue(iss) {
  const id = iss && iss.segId
  if (!id) return
  const el = document.getElementById('seg-' + id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  flashId.value = id
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashId.value = '' }, 2000)
}

// ---- 段展示辅助 ----
const TYPE_META = {
  train: { icon: '车', label: '高铁' },
  flight: { icon: '飞', label: '航班' },
  hotel: { icon: '住', label: '酒店' },
  taxi: { icon: '车', label: '打车' },
  activity: { icon: '玩', label: '游玩' },
}
function typeMeta(type) {
  return TYPE_META[type] || { icon: '行', label: '行程' }
}
function tipsOf(seg) {
  return (seg.plain && Array.isArray(seg.plain.tips)) ? seg.plain.tips : []
}

// ---- 「到了之后做什么」清单：子女端编辑，优先级三档 ----
// 三档的「键」由 agents 单点定义（编解码共用同一映射），这里只补中文标签
const TODO_LEVEL_TEXT = { high: '重要', normal: '普通', low: '随手' }
const TODO_LEVELS = TODO_LEVEL_KEYS.map((value) => ({ value, label: TODO_LEVEL_TEXT[value] }))
function todosOf(seg) {
  return (seg && Array.isArray(seg.todos)) ? seg.todos : []
}
function addTodo() {
  editForm.todos.push({ text: '', level: 'normal' })
}
function removeTodo(ti) {
  editForm.todos.splice(ti, 1)
}

// ---- 段编辑 ----
const editingId = ref('')
const editForm = reactive({ arrivalDay: 'auto', confirmed: false, date: '', departTime: '', arriveTime: '', from: '', to: '', code: '', note: '', timeOfDay: '', guide: '', todos: [] })
function toggleEdit(seg) {
  if (editingId.value === seg.id) { editingId.value = ''; return }
  editingId.value = seg.id
  editForm.date = seg.date || ''
  editForm.departTime = seg.departTime || ''
  editForm.arriveTime = seg.arriveTime || ''
  editForm.arrivalDay = typeof seg.arriveNextDayExplicit === 'boolean' ? (seg.arriveNextDayExplicit ? 'next' : 'same') : 'auto'
  editForm.confirmed = !seg.manualConfirm
  editForm.from = seg.from || ''
  editForm.to = seg.to || ''
  editForm.code = seg.code || ''
  editForm.note = seg.note || ''
  editForm.timeOfDay = seg.timeOfDay || ''
  editForm.guide = seg.guide || ''
  editForm.todos = todosOf(seg).map((t) => ({ text: t.text || '', level: t.level || 'normal' }))
}
function saveSegment(seg) {
  seg.date = editForm.date || seg.date
  if (editForm.date) seg.dateInvalid = false // 表单值是标准日期，原文写法问题即告解决
  seg.departTime = editForm.departTime || null
  seg.arriveTime = editForm.arriveTime || null
  seg.arriveNextDayExplicit = editForm.arrivalDay === 'auto' ? null : editForm.arrivalDay === 'next'
  seg.manualConfirm = !editForm.confirmed
  seg.from = editForm.from.trim()
  seg.to = editForm.to.trim()
  seg.code = editForm.code.trim()
  seg.note = editForm.note.trim()
  seg.timeOfDay = editForm.timeOfDay || ''
  // 「出站后往哪走」：长辈端卡片展开区置顶显示
  seg.guide = editForm.guide.trim()
  // 空文本的行直接丢掉，不让半截清单进链接
  seg.todos = editForm.todos
    .map((t) => ({ id: t.id || uid('todo'), text: String(t.text || '').trim(), level: t.level || 'normal' }))
    .filter((t) => t.text)
  // dateLiteral 保留原值（留档），这里不回写
  sanityCheck([seg], { today: todayStr() })
  refreshPlain(seg) // 改了站点/车次，人话与语音要跟着变，否则长辈端还是旧说法
  const t = trip.value
  if (t) rerunIssues(t)
  editingId.value = ''
  toast('已保存', 'ok')
}

// ---- 目的地天气（可选增强）----
// 只把城市名发给服务端；拿到就存进 trip.weather，分享时随卡片下发；拿不到就静默没有。
const weatherBusy = ref(false)
async function queryWeather() {
  const t = trip.value
  if (!t || weatherBusy.value) return
  const cities = [...new Set((t.segments || []).map((s) => guessCity(s.toCity || s.to || '')).filter(Boolean))]
  if (!cities.length) { toast('这些段里没看出具体的城市名，先补一下到达地', 'warn'); return }
  weatherBusy.value = true
  try {
    const map = { ...(t.weather || {}) }
    let got = 0
    for (const city of cities) {
      const w = await fetchWeather(city)
      if (w && w.advice) { map[city] = w.advice; got += 1 }
    }
    if (!got) { toast('没连上天气服务，不影响看行程', 'warn'); return }
    t.weather = map
    upsertTrip({ ...t, updatedAt: Date.now() })
    toast(`已查到 ${got} 个地方的天气，会随分享一起发给长辈`, 'ok')
    weatherBlock.value?.scrollIntoView({ behavior: 'smooth', block: 'center' }) // 查完就地看到结果
  } finally {
    weatherBusy.value = false
  }
}
function weatherOf(seg) {
  const t = trip.value
  if (!t || !t.weather) return ''
  const city = guessCity(seg.toCity || seg.to || '')
  return (city && t.weather[city]) || ''
}

// ---- 行程总览：目的地天气 / 按天日历 / 路线地图（都铺在页面上，不只 toast / 下载）----
const weatherBlock = ref(null)

// 目的地：按行程顺序去重（只取城市名）
const destCities = computed(() => {
  const t = trip.value
  if (!t) return []
  const out = []
  for (const s of t.segments || []) {
    const c = guessCity(s.toCity || s.to || '')
    if (c && !out.includes(c)) out.push(c)
  }
  return out
})

const weatherEntries = computed(() => {
  const w = (trip.value && trip.value.weather) || {}
  return destCities.value.map((city) => ({ city, advice: w[city] || '' }))
})

// 按天分组，每天一行摘要（避免与下方段列表重复占屏）
const WEEKDAY = '日一二三四五六'
function dayLabel(date) {
  if (!date) return '日期待定'
  const parts = date.split('-').map(Number)
  const wd = WEEKDAY[new Date(parts[0], parts[1] - 1, parts[2]).getDay()]
  return `${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')} 周${wd}`
}
const tripDays = computed(() => {
  const t = trip.value
  if (!t) return []
  const order = []
  const groups = new Map()
  for (const s of t.segments || []) {
    const key = s.date || ''
    if (!groups.has(key)) { groups.set(key, []); order.push(key) }
    groups.get(key).push(s)
  }
  return order.map((key) => {
    const segs = groups.get(key)
    const bits = segs.slice(0, 3).map((s) => {
      const name = (s.plain && s.plain.title) || s.to || s.toCity || '待补'
      return `${typeMeta(s.type).label} ${name}`
    })
    const more = segs.length > 3 ? ` 等 ${segs.length} 段` : ''
    return { date: key, dateLabel: dayLabel(key), summary: `${segs.length} 段 · ${bits.join(' · ')}${more}` }
  })
})

// 路线地图：把目的地城市查成经纬度（只传城市名）；查不到就显示提示，不弹错
const geoBusy = ref(false)
const geoHint = ref('')
const geoMissing = ref([])
const geoPoints = computed(() => {
  const geo = (trip.value && trip.value.geo) || {}
  return destCities.value
    .map((c, i) => (geo[c] ? { lat: geo[c].lat, lng: geo[c].lng, label: c, order: i + 1 } : null))
    .filter(Boolean)
})
async function loadGeo() {
  const t = trip.value
  if (!t || geoBusy.value) return
  if (!destCities.value.length) { geoHint.value = '这些段里没看出具体的城市名，先补一下到达地。'; return }
  const cities = destCities.value.filter((c) => !(t.geo && t.geo[c]))
  if (!cities.length) { geoHint.value = ''; return }
  geoBusy.value = true
  try {
    const map = { ...(t.geo || {}) }
    let got = 0
    for (const city of cities) {
      const g = await fetchCityCoords(city)
      if (g) { map[city] = { lat: g.lat, lng: g.lng }; got += 1 }
    }
    if (!got) { geoHint.value = '接不上地图服务：本机跑一下 server（node server/notify-server.mjs）再刷新。'; geoMissing.value = []; return }
    t.geo = map
    upsertTrip({ ...t, updatedAt: Date.now() })
    geoHint.value = ''
    geoMissing.value = cities.filter((c) => !map[c]) // 仍没定位到的目的地，如实写出来
  } finally {
    geoBusy.value = false
  }
}
onMounted(() => { if (destCities.value.length) loadGeo() })

// ---- 添加 / 删除段（手动补录，与解析产物同一契约）----
const ADD_TYPES = [
  { type: 'train', label: '高铁' },
  { type: 'flight', label: '航班' },
  { type: 'hotel', label: '酒店' },
  { type: 'taxi', label: '打车' },
  { type: 'activity', label: '游玩' },
]
const addingOpen = ref(false)

function todayStr() { return fmt(new Date()) }
function rerunIssues(t) {
  t.issues = sanityCheck(t.segments, { today: todayStr() })
  upsertTrip({ ...t, updatedAt: Date.now() })
}
function addSegment(type) {
  const t = trip.value
  if (!t) return
  const seg = createBlankSegment(type, todayStr())
  t.segments.push(seg)
  rerunIssues(t)
  addingOpen.value = false
  toggleEdit(seg) // 直接展开表单，接着就能填
  toast('已添加一段，请补齐信息', 'ok')
}
function deleteSegment(seg) {
  const t = trip.value
  if (!t) return
  if (!askConfirm('seg-' + seg.id)) return
  const i = t.segments.findIndex((s) => s.id === seg.id)
  if (i < 0) return
  t.segments.splice(i, 1)
  rerunIssues(t)
  editingId.value = ''
  toast('已删除这一段', 'info')
}

// ---- §E1 AI 一键补全（与导入页同一套契约：先预览，再落地）----
const modelReady = ref(false)
onMounted(() => { modelReady.value = isConfigured(loadModelConfig()) })

const assisting = ref(false)
const assistPreview = ref(null)
const canAssist = computed(() => !!(trip.value && hasWork(trip.value)))

async function aiAssist() {
  const t = trip.value
  if (!t || assisting.value) return
  const cfg = loadModelConfig()
  if (!isConfigured(cfg)) { toast('先去「我的 · 模型配置」填一个模型', 'warn'); return }
  assisting.value = true
  assistPreview.value = null
  try {
    const r = await runAssist(t, { cfg, today: todayStr() })
    if (!r.ok) { toast(reasonText(r.reason) + (r.detail ? `（${r.detail}）` : ''), 'err'); return }
    assistPreview.value = { patches: r.patches, summary: r.summary }
  } catch (e) {
    toast('AI 补全失败：' + ((e && e.message) || e), 'err')
  } finally {
    assisting.value = false
  }
}
function applyAssistResult() {
  const t = trip.value
  const p = assistPreview.value
  if (!t || !p) return
  const r = applyAssist(t, p.patches, { today: todayStr() })
  assistPreview.value = null
  if (!r.ok) { toast(reasonText(r.reason), 'err'); return }
  rerunIssues(t)
  toast(`已补全 ${r.filled + r.added} 项，标了「待人工确认」的段请再核对`, 'ok')
}
function cancelAssist() { assistPreview.value = null }

// ---- §E3 导出日历 / 长图 ----
function exportCalendar() {
  const t = trip.value
  if (!t) return
  if (!(t.segments || []).length) { toast('这个行程还没有内容', 'warn'); return }
  try {
    downloadIcs(t)
    toast('日历文件已导出，用手机日历打开就能导入', 'ok')
  } catch (e) {
    toast('导出失败：' + ((e && e.message) || e), 'err')
  }
}
function exportPoster() {
  const t = trip.value
  if (!t) return
  if (!(t.segments || []).length) { toast('这个行程还没有内容', 'warn'); return }
  try {
    downloadTripPoster(t)
    toast('行程长图已导出到下载', 'ok')
  } catch (e) {
    toast('导出失败：' + ((e && e.message) || e), 'err')
  }
}

// ---- §E4 行前提醒清单 ----
const checklistItems = computed(() => buildChecklist(trip.value))
const checklistGrouped = computed(() => checklistGroups(checklistItems.value))
const clProgress = computed(() => {
  const list = checklistItems.value
  return { done: list.filter((i) => i.done).length, total: list.length }
})
function toggleItem(id) {
  const t = trip.value
  if (!t) return
  toggleChecklistItem(t, id)
  upsertTrip({ ...t, updatedAt: Date.now() })
}

// ---- §F/G 长辈动态：长辈的动作 + 实时位置（双轨同步）----
// 房间号由「最新那次分享的 token」派生（不写进链接，二维码容量有上限）。
// 没有分享就没有房间 —— 那就如实提示「先生成一次分享链接」，不摆一个空面板。
const elderShare = computed(() => {
  const t = trip.value
  if (!t) return null
  const now = Date.now()
  // saveShare 是 unshift，最新的在前；取最新一条还没过期的
  return listShares().find((s) => s && s.tripId === t.id && s.token && (!s.exp || s.exp > now)) || null
})
const elderRoom = computed(() => (elderShare.value ? roomId(elderShare.value.token) : ''))

const syncOn = ref(false)
const elderEvents = ref([])
const presence = ref(null)
const nowMs = ref(Date.now())
let unsub = null
let nowTimer = null

const syncLabel = computed(() => (syncOn.value ? '已接入同步服务' : '仅同设备可见（未部署同步服务）'))

function minutesSince(at) {
  return Math.max(0, Math.floor((nowMs.value - (at || 0)) / 60000))
}
function agoText(at) {
  if (!at) return ''
  const m = minutesSince(at)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

// 位置超过 10 分钟没更新就不再装成「实时」
const locStale = computed(() => !!presence.value && !!presence.value.at && nowMs.value - presence.value.at > 10 * 60000)
const mapUrl = computed(() => {
  const p = presence.value
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return ''
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`
})
function coordText(v) {
  return Number.isFinite(v) ? v.toFixed(6) : '—'
}

function segNo(e) {
  const i = e && e.data && typeof e.data.index === 'number' ? e.data.index : -1
  return i >= 0 ? `第 ${i + 1} 段` : '某一段'
}
function todoText(e) {
  const t = e && e.data && e.data.text
  return t ? String(t) : '这一项'
}
// 「已经 1 小时 28 分钟」这种人话时长
function minutesText(m) {
  const n = Math.max(0, Math.round(Number(m) || 0))
  if (n < 60) return n + ' 分钟'
  const h = Math.floor(n / 60)
  const rest = n % 60
  return rest ? `${h} 小时 ${rest} 分钟` : `${h} 小时`
}
const EVENT_TEXT = {
  'trip-open': () => '长辈打开了这次行程',
  'card-done': (e) => `长辈把${segNo(e)}标成走完了`,
  'card-undone': (e) => `长辈把${segNo(e)}改回没走完`,
  'card-collapse': (e) => `长辈收起了${segNo(e)}的详情`,
  'card-open': (e) => `长辈展开了${segNo(e)}的详情`,
  'todo-done': (e) => `长辈完成了「${todoText(e)}」（${segNo(e)}）`,
  'todo-undone': (e) => `长辈把「${todoText(e)}」改回没做（${segNo(e)}）`,
  'sos': () => '长辈按了紧急求助',
  'arrive-missed': (e) => `长辈还没确认「走完」（预计到达已过 ${minutesText(e && e.data && e.data.minutes)}）`,
  'loc-on': () => '长辈开始共享位置',
  'loc-off': () => '长辈停止了共享位置',
  'location': () => '长辈更新了位置',
  'seen': () => '长辈看过了',
}
function elderEventText(e) {
  if (!e) return ''
  const f = EVENT_TEXT[e.type]
  return f ? f(e) : '长辈有过一次操作'
}

// 只读重放长辈的勾选事件：segId → Set(清单序号)。时间正序，后到的覆盖先到的。
const todoState = computed(() => {
  const map = {}
  const evs = [...elderEvents.value].sort((a, b) => (a.at || 0) - (b.at || 0))
  for (const e of evs) {
    if (!e || (e.type !== 'todo-done' && e.type !== 'todo-undone')) continue
    const idx = e.data && e.data.index
    if (!e.segId || typeof idx !== 'number') continue
    if (!map[e.segId]) map[e.segId] = new Set()
    if (e.type === 'todo-done') map[e.segId].add(idx)
    else map[e.segId].delete(idx)
  }
  return map
})
function isTodoDone(segId, i) {
  const s = todoState.value[segId]
  return !!s && s.has(i)
}
// 动态列表只展示最近 20 条；重放用全量，避免旧事件被裁掉后勾选状态回退
const elderFeed = computed(() => elderEvents.value.slice(0, 20))

// ---- 安全提醒：紧急求助 / 平安到达超时，顶到最显眼的位置 ----
// 文案只说人话，不出现 presence / timeout 这类词。
const safetyAlert = computed(() => {
  const evs = (elderEvents.value || []).filter((e) => e && (e.type === 'sos' || e.type === 'arrive-missed'))
  if (!evs.length) return null
  const latest = evs.reduce((a, b) => ((b.at || 0) > (a.at || 0) ? b : a))
  if (latest.type === 'sos') {
    return { kind: 'sos', at: latest.at || 0, title: '长辈按了紧急求助', detail: agoText(latest.at) + '按的，请马上打个电话确认一下' }
  }
  const mins = latest.data && latest.data.minutes
  return {
    kind: 'miss',
    at: latest.at || 0,
    title: '妈妈可能还没到，打个电话吧',
    detail: `预计到达已经过了 ${minutesText(mins)}，还没确认「走完」`,
  }
})
const safetyMutedAt = ref(0)
const alertPhone = computed(() => {
  const m = (store.data.family || []).find((f) => f && f.phone)
  return (m && m.phone) || ''
})
const showSafety = computed(() => !!safetyAlert.value && safetyAlert.value.at > safetyMutedAt.value)
function muteSafety() { safetyMutedAt.value = Date.now() }

function stopElderSync() {
  if (unsub) { unsub(); unsub = null }
  syncOn.value = false
}
function startElderSync() {
  stopElderSync()
  const r = elderRoom.value
  if (!r) return
  probeSync().then((ok) => { syncOn.value = ok })
  unsub = subscribe(r, ({ events, presence: p, mode }) => {
    if (events && events.length) {
      const next = elderEvents.value.slice()
      for (const e of events) next.push(e)
      next.sort((a, b) => (b.at || 0) - (a.at || 0))
      elderEvents.value = next.slice(0, 200)
    }
    if (p) presence.value = p
    syncOn.value = mode === 'server'
  })
}

// 房间变化（刚生成分享 / 换了一条链接）就重订
watch(elderRoom, () => {
  elderEvents.value = []
  presence.value = null
  startElderSync()
}, { immediate: true })

onMounted(() => { nowTimer = setInterval(() => { nowMs.value = Date.now() }, 30000) })
onBeforeUnmount(() => {
  stopElderSync()
  clearTimeout(flashTimer)
  if (nowTimer) { clearInterval(nowTimer); nowTimer = null }
})
</script>

<template>
  <div class="page">
    <section v-if="!trip" class="empty">
      <p class="kicker">404</p>
      <h1 class="empty-title">行程不存在或已删除</h1>
      <p class="empty-hint">它可能已经被删掉了，回行程列表看看别的。</p>
      <button class="btn btn-primary" @click="navigate('/home')">回首页</button>
    </section>

    <template v-else>
      <header class="page-head">
        <div class="page-head-main">
          <span class="page-kicker">行程 · {{ trip.segments.length }} 段</span>
          <input
            v-model="titleText"
            class="title-input"
            type="text"
            aria-label="行程名称"
            @blur="saveTitle"
          />
        </div>
        <div class="page-actions head-actions">
          <button class="btn btn-primary" @click="navigate('/share/' + trip.id)">分享给爸妈</button>
          <button class="btn btn-ghost" :disabled="weatherBusy" @click="queryWeather">
            {{ weatherBusy ? '查询天气中…' : '查目的地天气' }}
          </button>
          <button class="btn btn-ghost" @click="exportCalendar">导出日历</button>
          <button class="btn btn-ghost" @click="exportPoster">导出长图</button>
          <button
            class="btn btn-danger"
            :class="{ arming: confirmKey === 'trip' }"
            @click="deleteTripClick"
          >{{ confirmKey === 'trip' ? '确认删除？' : '删除行程' }}</button>
        </div>
      </header>

      <!-- 安全提醒：长辈按了紧急求助 / 超过预计到达时刻还没确认，顶到最上面 -->
      <section v-if="showSafety" class="paper-card safety-card" :class="'safety-' + safetyAlert.kind" role="alert">
        <div class="safety-main">
          <p class="safety-title">{{ safetyAlert.title }}</p>
          <p class="safety-detail">{{ safetyAlert.detail }}</p>
        </div>
        <div class="safety-actions">
          <a v-if="alertPhone" class="btn btn-primary btn-sm" :href="'tel:' + alertPhone">打电话</a>
          <button class="btn btn-ghost btn-sm" @click="muteSafety">先不提醒</button>
        </div>
      </section>

      <section v-if="sortedIssues.length" class="issue-box" aria-label="行程问题汇总">
        <button
          type="button"
          class="issue-head"
          :aria-expanded="issuesOpen"
          @click="issuesOpen = !issuesOpen"
        >
          <span class="issue-head-main">
            <span class="issue-head-title">行程问题 · {{ sortedIssues.length }} 条</span>
            <span class="issue-chips">
              <span v-if="issueCounts.error" class="tag tag-err">{{ issueCounts.error }} 个要处理</span>
              <span v-if="issueCounts.warn" class="tag tag-warn">{{ issueCounts.warn }} 个要确认</span>
              <span v-if="issueCounts.info" class="tag">{{ issueCounts.info }} 个待补齐</span>
            </span>
          </span>
          <span class="issue-caret">{{ issuesOpen ? '收起' : '展开' }}</span>
        </button>
        <ul v-if="issuesOpen" class="issue-list">
          <li v-for="(iss, ii) in sortedIssues" :key="ii">
            <button
              type="button"
              class="issue"
              :class="'issue-' + iss.level"
              @click="focusIssue(iss)"
            >
              <span class="issue-msg">{{ iss.message }}</span>
              <span class="issue-right">
                <span v-if="issueLabel(iss.code)" class="tag">{{ issueLabel(iss.code) }}</span>
                <span v-if="iss.segId" class="issue-locate">定位到这一段 →</span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      <!-- 行程总览：把天气 / 日历 / 地图直接铺在页面上，而不是只 toast 或只下载 -->
      <section class="paper-card trip-overview" aria-label="行程总览">
        <div class="ov-head">
          <h2 class="block-title">行程总览</h2>
          <button class="btn btn-ghost btn-sm" :disabled="weatherBusy" @click="queryWeather">
            {{ weatherBusy ? '查询中…' : '刷新天气' }}
          </button>
        </div>

        <div ref="weatherBlock" class="ov-block">
          <p class="ov-label">目的地天气</p>
          <ul v-if="weatherEntries.some((e) => e.advice)" class="ov-weather">
            <li v-for="e in weatherEntries" :key="e.city">
              <span class="ov-city">{{ e.city }}</span>
              <span v-if="e.advice" class="ov-advice">{{ e.advice }}</span>
              <span v-else class="tag">未查到</span>
            </li>
          </ul>
          <p v-else class="ov-empty">点右上「查目的地天气」，看看这几天要带什么。</p>
        </div>

        <div class="ov-block">
          <div class="ov-label-row">
            <p class="ov-label">行程日历</p>
            <button class="btn btn-ghost btn-sm" @click="exportCalendar">导出 .ics</button>
          </div>
          <ol v-if="tripDays.length" class="ov-days">
            <li v-for="d in tripDays" :key="d.date">
              <span class="ov-day-date num">{{ d.dateLabel }}</span>
              <span class="ov-day-sum">{{ d.summary }}</span>
            </li>
          </ol>
          <p v-else class="ov-empty">这个行程还没有内容。</p>
        </div>

        <div class="ov-block">
          <div class="ov-label-row">
            <p class="ov-label">路线地图</p>
            <button v-if="geoPoints.length" class="btn btn-ghost btn-sm" :disabled="geoBusy" @click="loadGeo">
              {{ geoBusy ? '取位置中…' : '刷新' }}
            </button>
          </div>
          <RealMap
            v-if="geoPoints.length"
            class="ov-map"
            :points="geoPoints"
            :height="240"
            label="行程目的地"
          />
          <p v-else class="ov-empty">{{ geoBusy ? '正在取目的地位置…' : (geoHint || '点「刷新」在地图上看看要去的几个地方。') }}</p>
          <p v-if="geoPoints.length && geoMissing.length" class="ov-empty">没定位到：{{ geoMissing.join('、') }}（点「刷新」再试）</p>
        </div>
      </section>

      <div v-if="canAssist" class="assist-bar">
        <button class="btn btn-ghost btn-sm" :disabled="assisting" @click="aiAssist">
          {{ assisting ? 'AI 补全中…' : 'AI 一键补全' }}
        </button>
        <span class="assist-hint">
          {{ modelReady ? '用你自己的模型补齐缺失的日期 / 时间 / 地点，补完仍要核对' : '未配置模型：去「我的 · 模型配置」填一个' }}
        </span>
      </div>

      <div v-if="assistPreview" class="assist-preview" role="status">
        <p class="assist-preview-title">将补全 {{ assistPreview.summary.count }} 项，确认后应用</p>
        <ul class="assist-list">
          <li v-for="(it, i) in assistPreview.summary.items" :key="'ai' + i">{{ it.text }}</li>
          <li v-for="(it, i) in assistPreview.summary.news" :key="'an' + i">{{ it.text }}</li>
        </ul>
        <div class="assist-actions">
          <button class="btn btn-primary btn-sm" @click="applyAssistResult">应用补全</button>
          <button class="btn btn-ghost btn-sm" @click="cancelAssist">取消</button>
        </div>
      </div>

      <!-- 长辈动态：长辈的动作 + 实时位置（双轨同步，没有服务端就只标同设备） -->
      <section class="paper-card elder-live" aria-label="长辈动态">
        <div class="elder-live-head">
          <h2 class="elder-live-title">长辈动态</h2>
          <span class="elder-live-mode" :class="{ on: syncOn }">{{ syncLabel }}</span>
        </div>

        <p v-if="!elderShare" class="elder-live-empty">
          先给长辈生成一次分享链接；长辈打开后，这趟行程的每一步都会回到这里。
        </p>

        <template v-else>
          <div class="elder-loc">
            <div class="elder-loc-head">
              <span class="elder-loc-label">长辈现在在哪</span>
              <span v-if="presence" class="elder-loc-time">{{ agoText(presence.at) }}更新</span>
            </div>
            <template v-if="presence">
              <p class="elder-loc-coord num">{{ coordText(presence.lat) }}, {{ coordText(presence.lng) }}</p>
              <p class="elder-loc-meta">
                <span v-if="presence.acc != null">精度约 ±{{ presence.acc }} 米</span>
                <span v-if="locStale" class="tag tag-warn">位置已 {{ minutesSince(presence.at) }} 分钟没更新</span>
              </p>
              <!-- 在线真实地图：长辈那边传一次位置，这里就跟着挪一次 -->
              <RealMap
                class="elder-loc-map"
                :lat="Number(presence.lat)"
                :lng="Number(presence.lng)"
                :label="'长辈位置 · ' + agoText(presence.at) + '更新'"
                :height="220"
              />
              <a v-if="mapUrl" class="btn btn-ghost btn-sm" :href="mapUrl" target="_blank" rel="noopener">在 OpenStreetMap 打开</a>
            </template>
            <p v-else class="elder-live-empty">
              长辈还没开始共享位置。位置要长辈自己在手机上点一下才会传过来。
            </p>
          </div>

          <div class="elder-timeline">
            <p v-if="!elderFeed.length" class="elder-live-empty">长辈还没打开过这次分享。</p>
            <ul v-else class="elder-feed">
              <li v-for="e in elderFeed" :key="e.id" class="elder-feed-item">
                <span class="elder-feed-text">{{ elderEventText(e) }}</span>
                <span class="elder-feed-time">{{ agoText(e.at) }}</span>
              </li>
            </ul>
          </div>
        </template>
      </section>

      <div v-if="!trip.segments.length" class="empty">
        <h2 class="empty-title">这个行程还没有任何一段</h2>
        <p class="empty-hint">可以去「导入」粘贴原文自动解析，也可以直接手动补一段。</p>
        <div class="empty-actions">
          <button class="btn btn-ghost" @click="navigate('/import')">去导入</button>
          <button class="btn btn-primary" @click="addingOpen = true">手动添加一段</button>
        </div>
      </div>

      <ul class="seg-list">
        <li v-for="s in trip.segments" :key="s.id" :id="'seg-' + s.id" class="paper-card seg" :class="{ 'seg-warn': s.manualConfirm, 'seg-flash': flashId === s.id }">
          <div v-if="s.manualConfirm" class="seg-alert">这一条待人工确认，建议对照原始短信</div>

          <div class="seg-body">
            <div class="seg-main">
              <span class="seg-icon" aria-hidden="true">{{ typeMeta(s.type).icon }}</span>
              <div class="seg-info">
                <div class="seg-top">
                  <span class="seg-type">{{ typeMeta(s.type).label }}</span>
                  <span v-if="s.code" class="seg-code num">{{ s.code }}</span>
                  <span v-if="s.manualConfirm" class="tag tag-err">待人工确认</span>
                </div>
                <p class="seg-route">
                  <template v-if="s.type === 'activity'">
                    <span v-if="s.timeOfDay">{{ s.timeOfDay }} · </span>{{ s.to || '待补地点' }}
                  </template>
                  <template v-else>{{ s.from }} → {{ s.to }}</template>
                </p>
                <div class="seg-meta">
                  <span v-if="s.dateInvalid" class="seg-date">
                    {{ s.dateLiteral || '日期不明' }} <span class="tag tag-err">日期写法需确认</span>
                  </span>
                  <span v-else class="seg-date">{{ s.date || '日期待定' }}</span>
                  <span v-if="s.departTime" class="seg-time">出发 {{ s.departTime }}</span>
                  <span v-if="s.arriveTime" class="seg-time">
                    到达 {{ s.arriveTime }} <span v-if="s.arriveNextDay" class="tag">次日</span>
                  </span>
                </div>
                <ul v-if="tipsOf(s).length" class="seg-tips">
                  <li v-for="(tip, ti) in tipsOf(s)" :key="ti">{{ tip }}</li>
                </ul>
                <p v-if="weatherOf(s)" class="seg-weather">天气：{{ weatherOf(s) }}</p>
                <p v-if="s.guide" class="seg-guide"><span class="seg-guide-t">出站后往哪走</span>{{ s.guide }}</p>
                <p v-if="s.note" class="seg-note">{{ s.note }}</p>
                <!-- 到了之后做什么：子女写的清单，长辈端勾了这里会亮 -->
                <div v-if="todosOf(s).length" class="seg-todos">
                  <p class="seg-todos-title">到了之后做什么</p>
                  <p
                    v-for="(t, ti) in todosOf(s)"
                    :key="ti"
                    class="seg-todo"
                    :class="['seg-todo-' + (t.level || 'normal'), { 'seg-todo-done': isTodoDone(s.id, ti) }]"
                  >
                    <span class="seg-todo-mark" aria-hidden="true">{{ isTodoDone(s.id, ti) ? '✓' : '○' }}</span>
                    <span class="seg-todo-text">{{ t.text }}</span>
                    <span class="tag">{{ TODO_LEVEL_TEXT[t.level] || '普通' }}</span>
                    <span v-if="isTodoDone(s.id, ti)" class="tag tag-brand">长辈已做</span>
                  </p>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm edit-toggle" :aria-expanded="editingId === s.id" @click="toggleEdit(s)">
                {{ editingId === s.id ? '收起' : '编辑' }}
              </button>
            </div>

            <form v-if="editingId === s.id" class="seg-form" @submit.prevent="saveSegment(s)">
              <div class="form-grid">
                <div class="form-field">
                  <label :for="'ed-date-' + s.id">日期</label>
                  <input :id="'ed-date-' + s.id" v-model="editForm.date" type="date" />
                  <small v-if="s.dateLiteral" class="form-hint">原文写法：{{ s.dateLiteral }}</small>
                </div>
                <div class="form-field">
                  <label :for="'ed-depart-' + s.id">出发时间</label>
                  <input :id="'ed-depart-' + s.id" v-model="editForm.departTime" type="time" />
                </div>
                <div class="form-field">
                  <label :for="'ed-arrive-' + s.id">到达时间</label>
                  <input :id="'ed-arrive-' + s.id" v-model="editForm.arriveTime" type="time" />
                  <select v-model="editForm.arrivalDay" aria-label="到达日期"><option value="auto">按时刻推断</option><option value="same">当天到达（已核对）</option><option value="next">次日到达（已核对）</option></select>
                  <label><input v-model="editForm.confirmed" type="checkbox" />已对照原始票据核对关键字段</label>
                </div>
                <div class="form-field">
                  <label :for="'ed-from-' + s.id">出发地</label>
                  <input :id="'ed-from-' + s.id" v-model="editForm.from" type="text" />
                </div>
                <div class="form-field">
                  <label :for="'ed-to-' + s.id">到达地</label>
                  <input :id="'ed-to-' + s.id" v-model="editForm.to" type="text" />
                </div>
                <div class="form-field">
                  <label :for="'ed-code-' + s.id">车次 / 航班号</label>
                  <input :id="'ed-code-' + s.id" v-model="editForm.code" type="text" />
                </div>
                <div class="form-field form-field-wide">
                  <label :for="'ed-note-' + s.id">备注</label>
                  <input :id="'ed-note-' + s.id" v-model="editForm.note" type="text" />
                </div>
                <div class="form-field form-field-wide">
                  <label :for="'ed-guide-' + s.id">出站后往哪走（到达指引，选填）</label>
                  <textarea
                    :id="'ed-guide-' + s.id"
                    v-model="editForm.guide"
                    rows="2"
                    placeholder="如：B 口出站，右转直走 100 米，公交站就在路口"
                  ></textarea>
                  <small class="form-hint">这段话会在长辈端卡片上置顶显示（深底白字），下了车一眼就能看到</small>
                </div>
                <div v-if="s.type === 'activity'" class="form-field">
                  <label :for="'ed-tod-' + s.id">时段（选填）</label>
                  <select :id="'ed-tod-' + s.id" v-model="editForm.timeOfDay">
                    <option value="">不限</option>
                    <option v-for="w in ['清晨', '早上', '上午', '中午', '下午', '傍晚', '晚上', '夜里', '凌晨']" :key="w" :value="w">{{ w }}</option>
                  </select>
                </div>
                <div class="form-field form-field-wide">
                  <label>到了之后做什么（可加多项，长辈端能勾）</label>
                  <div v-for="(t, ti) in editForm.todos" :key="'todo' + ti" class="todo-edit-row">
                    <input v-model="t.text" type="text" :aria-label="'清单第 ' + (ti + 1) + ' 项'" placeholder="如：买瓶水、拍张合影" />
                    <select v-model="t.level" :aria-label="'清单第 ' + (ti + 1) + ' 项优先级'">
                      <option v-for="lv in TODO_LEVELS" :key="lv.value" :value="lv.value">{{ lv.label }}</option>
                    </select>
                    <button type="button" class="btn btn-ghost btn-sm" @click="removeTodo(ti)">删除</button>
                  </div>
                  <button type="button" class="btn btn-ghost btn-sm todo-add" @click="addTodo">＋ 加一项</button>
                  <small class="form-hint">长辈端勾一下，这里会实时亮起来；颜色只分三档「重要 / 普通 / 随手」。</small>
                </div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary btn-sm">保存本段</button>
                <button type="button" class="btn btn-ghost btn-sm" @click="editingId = ''">取消</button>
                <button
                  type="button"
                  class="btn btn-danger btn-sm del-seg"
                  :class="{ arming: confirmKey === 'seg-' + s.id }"
                  @click="deleteSegment(s)"
                >{{ confirmKey === 'seg-' + s.id ? '确认删除？' : '删除本段' }}</button>
              </div>
            </form>
          </div>
        </li>
      </ul>

      <div class="add-seg">
        <button v-if="!addingOpen" class="btn btn-ghost add-seg-btn" @click="addingOpen = true">＋ 添加一段</button>
        <div v-else class="add-seg-picker" role="group" aria-label="选择要添加的段类型">
          <span class="add-seg-label">添加哪种？</span>
          <button
            v-for="t in ADD_TYPES" :key="t.type"
            class="btn btn-ghost btn-sm"
            @click="addSegment(t.type)"
          >{{ t.label }}</button>
          <button class="btn btn-ghost btn-sm" @click="addingOpen = false">取消</button>
        </div>
      </div>

      <section v-if="checklistItems.length" class="paper-card checklist" aria-label="行前提醒">
        <div class="checklist-head">
          <h2 class="checklist-title">行前提醒</h2>
          <span class="checklist-progress num">{{ clProgress.done }}/{{ clProgress.total }}</span>
        </div>
        <div v-for="g in checklistGrouped" :key="g.key" class="checklist-group">
          <p class="checklist-group-title">{{ g.title }}</p>
          <label v-for="it in g.items" :key="it.id" class="check-item">
            <input type="checkbox" :checked="it.done" @change="toggleItem(it.id)" />
            <span class="check-text" :class="{ done: it.done }">{{ it.text }}</span>
          </label>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.title-input {
  flex: 1;
  min-width: 200px;
  border: 1px solid transparent;
  background: transparent;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 6px 10px;
  border-radius: var(--r-s);
}
.title-input:hover { border-color: var(--c-line); background: var(--c-card); }
.title-input:focus { border-color: var(--c-brand); background: var(--c-card); }
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.issue-box { display: flex; flex-direction: column; margin-bottom: 16px; }
.issue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-m);
  background: var(--c-card);
  text-align: left;
}
.issue-head:hover { border-color: rgba(154, 107, 8, 0.5); }
.issue-head-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.issue-head-title { font-size: 14px; font-weight: 700; color: var(--c-ink-0); }
.issue-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.issue-caret { flex: none; font-size: 13px; font-weight: 600; color: var(--c-brand); }
.issue-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.issue {
  width: 100%;
  margin: 0;
  padding: 8px 12px;
  font-size: 14px;
  text-align: left;
  border: 0;
  border-left: 3px solid var(--c-line);
  border-radius: 0 var(--r-s) var(--r-s) 0;
  background: var(--c-bg-1);
  color: var(--c-ink-1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  cursor: pointer;
}
.issue:hover { background: var(--c-bg-2); }
.issue-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: none; }
.issue-locate { font-size: 12px; color: var(--c-brand); white-space: nowrap; }
.issue-error {
  border-left-color: var(--c-err);
  color: var(--c-err);
  background: rgba(179, 38, 30, 0.05);
}
.issue-warn {
  border-left-color: var(--c-warn);
  color: var(--c-warn);
  background: rgba(154, 107, 8, 0.06);
}
.issue-info { border-left-color: var(--c-ink-2); }

/* ---- 行程总览：天气 / 日历 / 地图 ---- */
.trip-overview { padding: 16px; margin-bottom: 16px; }
.ov-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.ov-block { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--c-line); }
.ov-block:first-of-type { margin-top: 8px; padding-top: 0; border-top: 0; }
.ov-label { margin: 0; font-size: 13px; font-weight: 700; color: var(--c-brand); }
.ov-label-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.ov-empty { margin: 8px 0 0; font-size: 13px; color: var(--c-ink-2); }
.ov-weather { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ov-weather li { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 14px; color: var(--c-ink-1); }
.ov-city { font-weight: 600; color: var(--c-ink-0); }
.ov-advice { color: var(--c-ink-1); }
.ov-days { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ov-days li { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 14px; }
.ov-day-date { flex: none; font-weight: 700; color: var(--c-ink-0); }
.ov-day-sum { color: var(--c-ink-1); min-width: 0; overflow-wrap: anywhere; }
.ov-map { display: block; margin-top: 8px; }

/* ---- 安全提醒（紧急求助 / 平安到达超时）---- */
.safety-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 14px 16px;
  margin-bottom: 16px;
  border-left: 5px solid var(--c-err);
  background: rgba(179, 38, 30, 0.05);
}
.safety-sos { border-left-color: var(--c-err); }
.safety-miss { border-left-color: var(--c-warn); background: rgba(154, 107, 8, 0.07); }
.safety-main { flex: 1; min-width: 220px; }
.safety-title { margin: 0; font-size: 16px; font-weight: 700; color: var(--c-ink-0); }
.safety-detail { margin: 4px 0 0; font-size: 13px; color: var(--c-ink-1); }
.safety-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.seg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.seg { padding: 0; overflow: hidden; scroll-margin-top: 80px; }
.seg-warn { border-color: rgba(154, 107, 8, 0.45); }
/* 从问题条目点进来时高亮这一段，方便一眼锁定 */
.seg-flash { animation: seg-flash 1s ease-out 2; }
@keyframes seg-flash {
  0%, 100% { box-shadow: 0 0 0 0 rgba(11, 107, 69, 0); }
  30% { box-shadow: 0 0 0 3px rgba(11, 107, 69, 0.5); }
}
.seg-alert {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--c-warn);
  background: rgba(154, 107, 8, 0.08);
  border-bottom: 1px dashed rgba(154, 107, 8, 0.35);
}
.seg-body { padding: 14px 16px; }
.seg-main { display: flex; gap: 12px; align-items: flex-start; }
.seg-icon {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--c-bg-2);
  color: var(--c-ink-0);
  font-size: 17px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.seg-info { flex: 1; min-width: 0; }
.seg-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.seg-type { font-weight: 600; }
.seg-code { color: var(--c-brand); font-weight: 700; letter-spacing: 1px; }
.seg-route { margin: 4px 0 0; font-size: 16px; }
.seg-meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
  color: var(--c-ink-1);
}
.seg-tips {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--c-ink-2);
}
.seg-tips li { margin: 2px 0; }
.seg-note { margin: 6px 0 0; font-size: 13px; color: var(--c-ink-2); }
.seg-weather { margin: 6px 0 0; font-size: 13px; color: var(--c-ink-1); }
.seg-guide {
  margin: 8px 0 0;
  padding: 8px 12px;
  border-left: 3px solid var(--c-brand);
  background: rgba(11, 107, 69, 0.05);
  font-size: 14px;
  color: var(--c-ink-0);
  overflow-wrap: anywhere;
}
.seg-guide-t {
  display: inline-block;
  margin-right: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--c-brand);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.edit-toggle { flex: none; }

/* ---- 到了之后做什么：只读展示 + 长辈勾选回显 ---- */
.seg-todos { margin-top: 10px; }
.seg-todos-title { margin: 0 0 4px; font-size: 13px; font-weight: 700; color: var(--c-brand); }
.seg-todo {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 0 4px;
  padding: 6px 10px;
  border: 1px solid var(--c-line);
  border-left: 4px solid var(--c-line);
  border-radius: var(--r-s);
  background: var(--c-bg-1);
  font-size: 14px;
  color: var(--c-ink-1);
}
.seg-todo-high { border-left-color: var(--c-err); }
.seg-todo-normal { border-left-color: var(--c-brand); }
.seg-todo-low { border-left-color: var(--c-ink-2); }
.seg-todo-mark { flex: none; font-weight: 700; }
.seg-todo-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.seg-todo-done .seg-todo-text { text-decoration: line-through; color: var(--c-ink-2); }
.todo-edit-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.todo-edit-row input { flex: 1; min-width: 0; }
.todo-edit-row select { flex: none; width: auto; }
.todo-add { border-style: dashed; }

.seg-form {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--c-line);
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.form-field label { display: block; font-size: 13px; color: var(--c-ink-1); margin-bottom: 4px; }
.form-field input { font-size: 14px; padding: 7px 10px; }
.form-field-wide { grid-column: 1 / -1; }
.form-hint { display: block; margin-top: 4px; font-size: 12px; color: var(--c-ink-2); }
.form-actions { margin-top: 12px; display: flex; gap: 8px; }

.add-seg { margin-top: 14px; display: flex; justify-content: center; }
.add-seg-btn { border-style: dashed; color: var(--c-ink-1); }
.add-seg-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  padding: 10px 14px;
  border: 1px dashed var(--c-line);
  border-radius: var(--r-m);
  background: var(--c-bg-1);
}
.add-seg-label { font-size: 13px; color: var(--c-ink-1); }
.del-seg { margin-left: auto; }

.assist-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.assist-hint { font-size: 12px; color: var(--c-ink-2); }
.assist-preview {
  padding: 12px 14px;
  margin-bottom: 16px;
  border: 1px solid var(--c-brand);
  border-radius: var(--r-m);
  background: rgba(11, 107, 69, 0.06);
}
.assist-preview-title { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: var(--c-brand); }
.assist-list { margin: 0; padding-left: 18px; font-size: 13px; color: var(--c-ink-1); }
.assist-list li { margin: 3px 0; }
.assist-actions { margin-top: 10px; display: flex; gap: 8px; }

.checklist { margin-top: 24px; padding: 16px; }
.checklist-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.checklist-title { margin: 0; font-size: 18px; }
.checklist-progress { font-size: 13px; color: var(--c-ink-2); }
.checklist-group { margin-top: 12px; }
.checklist-group-title { margin: 0 0 4px; font-size: 13px; font-weight: 700; color: var(--c-brand); }
.check-item { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; cursor: pointer; }
.check-item input[type="checkbox"] { width: auto; margin-top: 3px; flex: none; accent-color: var(--c-brand); }
.check-text { font-size: 14px; color: var(--c-ink-1); }
.check-text.done { color: var(--c-ink-2); text-decoration: line-through; }

/* ---- 长辈动态 ---- */
.elder-live { margin-bottom: 24px; padding: 16px; }
.elder-live-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.elder-live-title { margin: 0; font-size: 18px; }
.elder-live-mode { font-size: 12px; font-weight: 600; color: var(--c-ink-2); }
.elder-live-mode.on { color: var(--c-brand); }
.elder-live-empty { margin: 12px 0 0; font-size: 13px; color: var(--c-ink-2); }
.elder-loc {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-m);
  background: var(--c-bg-1);
}
.elder-loc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.elder-loc-label { font-size: 14px; font-weight: 700; }
.elder-loc-time { font-size: 12px; color: var(--c-ink-2); }
.elder-loc-coord { margin: 6px 0; font-size: 15px; font-weight: 700; color: var(--c-ink-0); overflow-wrap: anywhere; }
.elder-loc-meta { margin: 0 0 10px; display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--c-ink-2); }
.elder-loc-map { display: block; margin: 0 0 10px; }
.elder-timeline { margin-top: 16px; }
.elder-feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.elder-feed-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--c-line);
}
.elder-feed-item:last-child { border-bottom: 0; }
.elder-feed-text { font-size: 14px; color: var(--c-ink-1); min-width: 0; overflow-wrap: anywhere; }
.elder-feed-time { flex: none; font-size: 12px; color: var(--c-ink-2); }

@media (max-width: 640px) {
  .page-head { flex-direction: column; align-items: stretch; }
  .head-actions { justify-content: flex-end; }
}
</style>
