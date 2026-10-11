<script setup>
// 接收其他子女分享的行程：贴链接 / 输 6 位码 / 直接打开 /receive/<token>。
// 纯前端无后端账号，所以「分享给另一个子女」= 一条自包含链接，接收方把它复制成自己的新行程。
// 未登录时先把 token 暂存本机，登录/注册成功后自动回到这里继续。
import { ref, computed, onMounted, watch } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, uid, upsertTrip, setPendingInvite } from '../core/store.js'
import { decodeTripInvite, extractToken } from '../core/share-codec.js'

const props = defineProps({ params: { type: Object, default: () => ({}) } })

function pad2(n) { return String(n).padStart(2, '0') }
function todayStr(d = new Date()) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}
function fmt(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

// 'idle'（贴链接）| 'ok' | 'expired' | 'malformed' | 'needlogin' | 'imported'
const state = ref('idle')
const token = ref('')
const payload = ref(null)
const input = ref('')
const inputErr = ref('')
const importedTripId = ref('')

// token 的校验和（`.` 前那段）：用来给「已经加入过」去重
const checksum = computed(() => {
  const t = token.value
  const i = t.indexOf('.')
  return i > 0 ? t.slice(0, i) : ''
})

const TYPE_LABEL = { train: '高铁', flight: '航班', hotel: '酒店', taxi: '打车', activity: '游玩' }
const summary = computed(() => {
  const segs = (payload.value && payload.value.segments) || []
  const c = {}
  for (const s of segs) c[s.type] = (c[s.type] || 0) + 1
  return Object.keys(c).map((k) => `${TYPE_LABEL[k] || '行程'} ${c[k]}`).join(' · ')
})
const segCount = computed(() => ((payload.value && payload.value.segments) || []).length)
const rangeText = computed(() => {
  const segs = (payload.value && payload.value.segments) || []
  const dates = segs.map((s) => s.date).filter(Boolean).sort()
  if (!dates.length) return '日期待定'
  return dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + ' ~ ' + dates[dates.length - 1]
})

function alreadyImported() {
  const sum = checksum.value
  if (!sum) return null
  return (store.data.trips || []).find((t) => t && t.importedFrom === sum) || null
}

function resolveToken(t) {
  token.value = t || ''
  inputErr.value = ''
  if (!t) { state.value = 'idle'; payload.value = null; return }
  let res = null
  try { res = decodeTripInvite(t, { today: todayStr() }) } catch { res = { ok: false, reason: 'malformed' } }
  if (res && res.ok) {
    payload.value = res.payload
    const dup = alreadyImported()
    if (!store.account) {
      // 未登录：先记下，登录后自动回来
      setPendingInvite(t)
      state.value = 'needlogin'
    } else {
      state.value = dup ? 'imported' : 'ok'
    }
  } else if (res && res.reason === 'expired') {
    payload.value = res.payload || null
    state.value = 'expired'
  } else {
    payload.value = null
    state.value = 'malformed'
  }
}

onMounted(() => resolveToken(props.params.token || ''))
watch(() => props.params.token, (t) => resolveToken(t || ''))

function submitInput() {
  inputErr.value = ''
  const raw = input.value.trim()
  if (!raw) { inputErr.value = '把链接粘进来，或输入 6 位码'; return }
  const tk = extractToken(raw)
  if (tk) { resolveToken(tk); return }
  const code = raw.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(code)) { inputErr.value = '看不出这是链接或 6 位码'; return }
  let found = null
  try {
    const ls = window.localStorage
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i)
      if (!key || key.indexOf('ptb:data:') !== 0) continue
      let bucket = null
      try { bucket = JSON.parse(ls.getItem(key)) } catch { bucket = null }
      const list = bucket && Array.isArray(bucket.invites) ? bucket.invites : []
      const hit = list.find((v) => v && v.code6 != null && String(v.code6) === code)
      if (hit) { found = hit; break }
    }
  } catch { found = null }
  if (!found || !found.token) {
    inputErr.value = '本机没有这个 6 位码对应的行程（6 位码只在生成它的这台设备上有效，跨设备请用链接）'
    return
  }
  input.value = ''
  resolveToken(found.token)
}

function doImport() {
  const p = payload.value
  if (!p) return
  const dup = alreadyImported()
  if (dup) { state.value = 'imported'; importedTripId.value = dup.id; toast('这条行程已经加入过了', 'warn'); return }
  const now = Date.now()
  const trip = {
    id: uid('trip'),
    title: p.title || '家人行程',
    startDate: p.startDate || null,
    segments: (p.segments || []).map((s, i) => ({ ...s, id: `seg${i}_${now.toString(36)}${i}` })),
    issues: p.issues || [],
    raw: '',
    importedFrom: checksum.value,
    createdAt: now,
    updatedAt: now,
  }
  if (!upsertTrip(trip).ok) { toast('没有保存到本机，请保留邀请链接后重试', 'err'); return }
  importedTripId.value = trip.id
  toast('行程已加入你的列表', 'ok')
  navigate('/trip/' + trip.id)
}

function goLogin() {
  if (token.value) setPendingInvite(token.value)
  navigate('/login')
}
function cancel() {
  navigate(store.account ? '/home' : '/')
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <span class="page-kicker">接收行程</span>
        <h1 class="page-title">别人分享给你的行程</h1>
        <p class="page-sub">对方把行程链接（或 6 位码）发给你，在这里粘进来就能加进自己的行程列表。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="cancel">返回</button>
      </div>
    </header>

    <!-- 没带 token：贴链接或输码 -->
    <section v-if="state === 'idle'" class="paper-card block">
      <h2 class="block-title">粘贴链接或输入 6 位码</h2>
      <div class="recv-row">
        <label class="visually-hidden" for="recv-input">行程链接或 6 位码</label>
        <input id="recv-input" v-model="input" class="recv-input" type="text" autocomplete="off" placeholder="https://…#/receive/… 或 123456" />
        <button class="btn btn-primary" @click="submitInput">查看</button>
      </div>
      <p v-if="inputErr" class="send-err" role="alert">{{ inputErr }}</p>
      <p class="block-hint">6 位码只在「生成它的那台设备」上有效；跨设备请让对方直接发链接。</p>
    </section>

    <!-- 有效期或链接有问题 -->
    <section v-else-if="state === 'expired'" class="paper-card block">
      <h2 class="block-title">这条邀请过期了</h2>
      <p class="block-hint">让分享给你的家人重新生成一次，旧链接就不能用了。</p>
      <button class="btn btn-primary" @click="resolveToken('')">换个链接</button>
    </section>

    <section v-else-if="state === 'malformed'" class="paper-card block">
      <h2 class="block-title">链接好像不对</h2>
      <p class="block-hint">可能复制漏了字符。让对方再发一次，或改成粘贴完整链接。</p>
      <button class="btn btn-primary" @click="resolveToken('')">换个链接</button>
    </section>

    <!-- 未登录：先登录再接收 -->
    <section v-else-if="state === 'needlogin'" class="paper-card block">
      <h2 class="block-title">先登录，再接收这条行程</h2>
      <p class="block-hint">已经帮你记住了这条链接，登录后会直接回到这里。</p>
      <div v-if="payload" class="recv-preview">
        <p class="recv-title">{{ payload.title || '家人行程' }}</p>
        <p class="recv-meta">{{ segCount }} 段 · {{ rangeText }}</p>
        <p v-if="summary" class="recv-meta">{{ summary }}</p>
      </div>
      <div class="recv-actions">
        <button class="btn btn-primary" @click="goLogin">去登录</button>
        <a class="btn btn-ghost" href="#/register">没有账号？去注册</a>
      </div>
    </section>

    <!-- 已经加入过了 -->
    <section v-else-if="state === 'imported'" class="paper-card block">
      <h2 class="block-title">这条行程已经加入过了</h2>
      <p class="block-hint">不用再导入一次。打开它，或者继续接收别的行程。</p>
      <div class="recv-actions">
        <button v-if="importedTripId" class="btn btn-primary" @click="navigate('/trip/' + importedTripId)">打开这条行程</button>
        <button class="btn btn-ghost" @click="resolveToken('')">接收别的</button>
      </div>
    </section>

    <!-- 正常的预览 + 导入 -->
    <section v-else-if="state === 'ok'" class="paper-card block">
      <h2 class="block-title">要加入这条行程吗</h2>
      <div class="recv-preview">
        <p class="recv-title">{{ payload.title || '家人行程' }}</p>
        <p class="recv-meta">{{ segCount }} 段 · {{ rangeText }}</p>
        <p v-if="summary" class="recv-meta">{{ summary }}</p>
      </div>
      <ul class="recv-segs">
        <li v-for="(s, i) in payload.segments" :key="i" class="recv-seg">
          <span class="recv-seg-type">{{ TYPE_LABEL[s.type] || '行程' }}</span>
          <span class="recv-seg-text">
            <template v-if="s.type === 'activity'">{{ s.timeOfDay ? s.timeOfDay + ' · ' : '' }}{{ s.to || '待补地点' }}</template>
            <template v-else>{{ s.from || '—' }} → {{ s.to || '—' }}</template>
          </span>
          <span v-if="s.date" class="recv-seg-date">{{ s.date }}</span>
        </li>
      </ul>
      <p class="block-hint">导入后是你自己的一份新行程，可以随意改动，不影响对方那份。</p>
      <div class="recv-actions">
        <button class="btn btn-primary" @click="doImport">加入我的行程</button>
        <button class="btn btn-ghost" @click="cancel">取消</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.recv-row { display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; }
.recv-input { flex: 1; min-width: 220px; }
.recv-preview {
  padding: 14px 16px;
  margin: 12px 0;
  border-left: 3px solid var(--c-brand);
  background: rgba(11, 107, 69, 0.05);
}
.recv-title { margin: 0; font-size: 18px; font-weight: 700; }
.recv-meta { margin: 4px 0 0; font-size: 13px; color: var(--c-ink-1); }
.recv-segs {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  border-top: 1px solid var(--c-line);
}
.recv-seg {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 0;
  border-bottom: 1px dashed var(--c-line);
  font-size: 14px;
}
.recv-seg-type { flex: none; font-weight: 600; color: var(--c-brand); }
.recv-seg-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.recv-seg-date { flex: none; font-size: 12px; color: var(--c-ink-2); font-family: var(--f-mono); }
.recv-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
.send-err { margin: 10px 0 0; font-size: 13px; color: var(--c-err); }
</style>