<script setup>
// 分享页：选有效期 + 长辈端显示 → 生成自包含链接 + 6 位码 + 二维码 → 发短信/邮件给长辈。
import { ref, computed, onMounted, nextTick } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, uid, getTrip, saveShare, saveInvite, listShares, listInvites, ELDER_SCALES, ELDER_THEMES, elderScaleName, elderThemeName } from '../core/store.js'
import { encodeShare, buildShareUrl, makeShareCode, encodeTripInvite, buildInviteUrl, makeInviteCode, DEFAULT_TTL_DAYS } from '../core/share-codec.js'
import { buildElderCards, guessCity } from '../core/agents.js'
import { qrInfo } from '../core/qr.js'
import { deliver, probeChannel, KIND_SMS, KIND_EMAIL } from '../core/notify.js'
import { rules } from '../core/accounts.js'
import { revealCode } from '../core/motion.js'

const props = defineProps({ params: { type: Object, default: () => ({}) } })

// 本地时区 'YYYY-MM-DD'
function fmt(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function fmtDateTime(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${fmt(d)} ${hh}:${mm}`
}

const trip = computed(() => getTrip(props.params.tripId))
const tripParts = computed(() => (trip.value && trip.value.segments) || [])

// ---- 区1：有效期 ----
const TTL_OPTIONS = [7, 30, 90]
const days = ref(DEFAULT_TTL_DAYS())

// ---- 区1.5：长辈端显示（随分享一起打包，长辈打开就是子女选的这个样子）----
const elderScale = ref(1)
const elderTheme = ref('day')
// 位置共享：默认关。开了只是「允许」—— 长辈端还要自己点一次才会真的传位置。
const shareLocation = ref(false)

// ---- 区1.6：本次包含哪些家人 ----
// 每次生成时确认一次（默认全选），让「这次分享带了谁」是显式的、看得见的。
// 分组只是快捷勾选手段：点一下整组加入/取消。
const familyList = computed(() => store.data.family || [])
const familyGroups = computed(() => store.data.familyGroups || [])
const selected = ref({})
// 默认全选：只有被显式取消（false）的才不带上
function isPicked(id) { return selected.value[id] !== false }
function selectedFamily() { return familyList.value.filter((f) => isPicked(f.id)) }
const pickedCount = computed(() => selectedFamily().length)
function togglePicked(id) {
  selected.value = { ...selected.value, [id]: !isPicked(id) }
}
function groupAllPicked(g) {
  const ids = (g.memberIds || []).filter((id) => familyList.value.some((m) => m.id === id))
  return ids.length > 0 && ids.every((id) => isPicked(id))
}
function toggleGroupPicked(g) {
  const on = !groupAllPicked(g)
  const next = { ...selected.value }
  for (const id of (g.memberIds || [])) {
    if (familyList.value.some((m) => m.id === id)) next[id] = on
  }
  selected.value = next
}
function selectAllFamily(on) {
  const next = {}
  for (const m of familyList.value) next[m.id] = on
  selected.value = next
}

// ---- 首选联系人：紧急求助会打给这个人（默认第一位被选中的家人）----
const preferredId = ref('')
const pickedList = computed(() => selectedFamily())
// 选中的家人里，谁排第一谁就是默认首选（没显式改过就跟着第一位走）
const effectivePreferredId = computed(() => {
  const list = pickedList.value
  if (!list.length) return ''
  const want = preferredId.value
  return list.some((m) => m.id === want) ? want : list[0].id
})
// 首选在 contacts 里的下标（长辈端的 pr）
const preferredIndex = computed(() => {
  const id = effectivePreferredId.value
  const i = pickedList.value.findIndex((m) => m.id === id)
  return i >= 0 ? i : 0
})

// 目的地天气：子女在行程页查好后存在 trip.weather，这里按城市贴到每张卡上
function weatherForSeg(seg) {
  const t = trip.value
  if (!t || !t.weather || !seg) return ''
  const city = guessCity(seg.toCity || seg.to || '')
  return (city && t.weather[city]) || ''
}

// ---- 区2：生成分享 ----
// 二维码承载边长：248px 是"每格 ≥2.4px"与"手机屏放得下"之间的实测折中点
const QR_BOX = 248
const result = ref(null) // { url, code6, token, exp, dataUrl, qr, contactNames }
const linkInput = ref(null)
const codeRef = ref(null)
// 逐位拆开是为了让 GSAP 一位一位"翻"进来（分享这一步值得有点仪式感）
const codeDigits = computed(() => String((result.value && result.value.code6) || '').split(''))

function generate() {
  const t = trip.value
  if (!t) return
  result.value = null
  const now = Date.now()
  const chosen = selectedFamily()
  // 天气是按「段」查好的：贴到对应卡片上，随链接一起发给长辈
  const segs = t.segments || []
  const cards = buildElderCards(t, chosen).map((c, i) => ({ ...c, weather: weatherForSeg(segs[i]) }))
  const payload = {
    v: 1,
    eid: uid('eld'),
    cid: uid('card'),
    title: t.title,
    gen: now,
    exp: now + days.value * 86400000,
    cards,
    // 称呼按长辈视角存（FamilyPage 里已说明），连同「他对我的称呼」一起带过去
    contacts: chosen.map((f) => ({
      name: f.name,
      phone: f.phone,
      relation: f.relation || '',
      im: f.im || '',
      note: f.note || '',
      callsMe: f.callsMe || '',
    })),
    // pr = 紧急求助会打给谁（首选联系人在 contacts 里的下标）
    pr: preferredIndex.value,
    prefs: { scale: elderScale.value, theme: elderTheme.value, shareLocation: shareLocation.value },
  }
  const token = encodeShare(payload)
  const url = buildShareUrl(token)
  const code6 = makeShareCode(payload)
  const contactNames = chosen.map((f) => f.name)
  const saved = saveShare({
    id: uid('sh'),
    tripId: t.id,
    token,
    code6,
    createdAt: now,
    exp: payload.exp,
    title: t.title,
    contactNames,
  })
  if (!saved.ok) { toast('分享记录没有保存到本机，请清理空间后重试', 'err'); return }
  // 二维码：M 级优先，装不下退 L 级（容量更大）；两级都超上限才算装不下，
  // 那就让「复制链接 / 6 位码 / 发短信邮件」三条路兜底，不让分享卡在二维码上。
  const info = qrInfo(url, { box: QR_BOX })
  result.value = { url, code6, token, exp: payload.exp, dataUrl: info ? info.dataUrl : null, qr: info, contactNames }
  refreshChannels()
  nextTick(() => revealCode(codeRef.value))
  toast('分享链接已生成', 'ok')
}

// ---- 区2.5：分享给其他子女（自包含链接 + 6 位码，对方导入成自己的新行程）----
const inviteResult = ref(null)
// 逐位拆开是为了让 GSAP 一位一位"翻"进来，与长辈分享的 6 位码同一套呈现
const inviteDigits = computed(() => String((inviteResult.value && inviteResult.value.code6) || '').split(''))
const inviteSending = ref('')
const inviteNote = ref('')
const inviteErr = ref('')
function inviteRecords() {
  const t = trip.value
  if (!t) return []
  return listInvites().filter((v) => v.tripId === t.id)
}
function generateInvite() {
  const t = trip.value
  if (!t) return
  inviteResult.value = null
  const now = Date.now()
  const payload = {
    eid: uid('inv'),
    gen: now,
    title: t.title,
    startDate: t.startDate || '',
    exp: now + days.value * 86400000,
    segments: t.segments || [],
  }
  const token = encodeTripInvite(payload)
  const url = buildInviteUrl(token)
  const code6 = makeInviteCode(payload)
  const saved = saveInvite({ id: uid('inv'), tripId: t.id, token, code6, createdAt: now, exp: payload.exp, title: t.title })
  if (!saved.ok) { toast('邀请记录没有保存到本机，请清理空间后重试', 'err'); return }
  // 二维码与长辈分享同规格：M 级优先，装不下退 L 级；两级都超上限就退回「复制链接 / 6 位码」兜底。
  const info = qrInfo(url, { box: QR_BOX })
  inviteResult.value = { url, code6, exp: payload.exp, dataUrl: info ? info.dataUrl : null, qr: info }
  inviteNote.value = ''
  inviteErr.value = ''
  toast('子女邀请链接已生成', 'ok')
}

// 把子女邀请发出去：复用同一条短信/邮件双通道
async function sendInviteBy(kind) {
  inviteErr.value = ''
  inviteNote.value = ''
  if (!inviteResult.value) { inviteErr.value = '先生成子女邀请链接，再发出去'; return }
  const to = sendTo.value.trim()
  const bad = kind === KIND_SMS ? rules.phone(to) : rules.email(to)
  if (bad) { inviteErr.value = kind === KIND_SMS ? '手机号填 11 位，如 13800000000' : bad; return }
  inviteSending.value = kind
  try {
    const out = await deliver({
      channel: kind,
      to,
      link: inviteResult.value.url,
      code6: inviteResult.value.code6,
      name: store.account ? store.account.name : '',
      tripTitle: trip.value ? trip.value.title : '',
    })
    if (out.via === 'server') {
      inviteNote.value = `已通过服务端发到 ${to}（${out.provider}）`
      toast('已发送', 'ok')
    } else {
      inviteNote.value = `已打开你手机上的${kind === KIND_SMS ? '短信' : '邮件'}，链接与 6 位码都写好了，按发送就行`
      openHref(out.href)
    }
  } catch (e) {
    inviteErr.value = '发送失败：' + ((e && e.message) || e)
  } finally {
    inviteSending.value = ''
  }
}

// ---- 区3：发给长辈（短信 / 邮件双通道）----
// 服务端配了服务商就直接送达；没配就调起本机短信/邮件 App，正文已经写好。
// 页面把"实际走哪条路"如实写出来，不假装浏览器能自己发短信。
const sendTo = ref('')
const sendErr = ref('')
const sending = ref('')
const sendNote = ref('')
const channels = ref({ sms: null, email: null })

async function refreshChannels() {
  const [sms, email] = await Promise.all([probeChannel(KIND_SMS), probeChannel(KIND_EMAIL)])
  channels.value = { sms, email }
}
onMounted(refreshChannels)

const channelHint = computed(() => {
  const c = channels.value
  return [
    c.sms ? `短信已接通服务端（${c.sms}）` : '短信将用你手机上的短信 App',
    c.email ? `邮件已接通服务端（${c.email}）` : '邮件将用你手机上的邮件 App',
  ].join('；')
})

function openHref(href) {
  const a = document.createElement('a')
  a.href = href
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function sendBy(kind) {
  sendErr.value = ''
  sendNote.value = ''
  if (!result.value) { sendErr.value = '先生成分享链接，再发出去'; return }
  const to = sendTo.value.trim()
  const bad = kind === KIND_SMS ? rules.phone(to) : rules.email(to)
  if (bad) { sendErr.value = kind === KIND_SMS ? '手机号填 11 位，如 13800000000' : bad; return }
  sending.value = kind
  try {
    const out = await deliver({
      channel: kind,
      to,
      link: result.value.url,
      code6: result.value.code6,
      name: store.account ? store.account.name : '',
      tripTitle: trip.value ? trip.value.title : '',
    })
    if (out.via === 'server') {
      sendNote.value = `已通过服务端发到 ${to}（${out.provider}）`
      toast('已发送', 'ok')
    } else {
      sendNote.value = `已打开你手机上的${kind === KIND_SMS ? '短信' : '邮件'}，正文与 6 位码都写好了，按发送就行`
      openHref(out.href)
    }
  } catch (e) {
    sendErr.value = '发送失败：' + ((e && e.message) || e)
  } finally {
    sending.value = ''
  }
}

async function copyLink(url) {
  let ok = false
  try {
    await navigator.clipboard.writeText(url)
    ok = true
  } catch {
    // 降级：select + execCommand
    ok = fallbackCopy(url)
  }
  toast(ok ? '链接已复制' : '复制失败，请手动复制', ok ? 'ok' : 'warn')
}
function fallbackCopy(url) {
  const input = linkInput.value
  let el = null
  if (input && input.value === url) {
    el = input
  } else {
    el = document.createElement('textarea')
    el.value = url
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
  }
  if (el.focus) el.focus()
  el.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  if (el.tagName === 'TEXTAREA') el.remove()
  return ok
}
function previewElder() {
  if (!result.value) return
  window.open(result.value.url, '_blank')
}

// ---- 区3：分享记录 ----
const tripShares = computed(() => {
  const t = trip.value
  if (!t) return []
  return listShares().filter((s) => s.tripId === t.id)
})
function shareActive(s) {
  return Date.now() < s.exp
}
</script>

<template>
  <div class="page">
    <section v-if="!trip" class="empty">
      <p class="kicker">404</p>
      <h2 class="empty-title">行程不存在或已删除</h2>
      <p class="empty-hint">它可能已经被删掉了，回行程列表看看别的。</p>
      <button class="btn btn-primary" @click="navigate('/home')">回首页</button>
    </section>

    <template v-else>
      <header class="page-head">
        <div class="page-head-main">
          <span class="page-kicker">分享 · {{ tripParts.length }} 段</span>
          <h1 class="page-title">把行程发给长辈</h1>
          <p class="page-sub">{{ trip.title || '未命名行程' }}</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost" @click="navigate('/trip/' + trip.id)">返回行程</button>
        </div>
      </header>

      <section class="paper-card block" aria-label="分享有效期">
        <h2 class="block-title">有效期</h2>
        <div class="ttl-row">
          <label
            v-for="d in TTL_OPTIONS"
            :key="d"
            class="ttl-card"
            :class="{ active: days === d }"
          >
            <input v-model.number="days" class="ttl-radio" type="radio" name="ttl" :value="d" />
            <span class="ttl-num num">{{ d }}</span>
            <span class="ttl-unit">天</span>
          </label>
        </div>
        <p class="block-hint">过期后链接自动失效，长辈打开会看到「已过期」。</p>
      </section>

      <section class="paper-card block" aria-label="长辈端显示">
        <h2 class="block-title">长辈端显示</h2>
        <p class="block-hint">选好会跟着链接一起发过去，长辈打开就是你选的这个样子；长辈自己也能再调。</p>
        <div class="pref-row">
          <span class="pref-label">字大小</span>
          <div class="pref-opts" role="group" aria-label="长辈端字大小">
            <button
              v-for="s in ELDER_SCALES" :key="s"
              type="button"
              class="pref-btn"
              :class="{ active: elderScale === s }"
              :aria-pressed="elderScale === s"
              @click="elderScale = s"
            >{{ elderScaleName(s) }}</button>
          </div>
        </div>
        <div class="pref-row">
          <span class="pref-label">主题</span>
          <div class="pref-opts" role="group" aria-label="长辈端主题">
            <button
              v-for="t in ELDER_THEMES" :key="t"
              type="button"
              class="pref-btn"
              :class="{ active: elderTheme === t }"
              :aria-pressed="elderTheme === t"
              @click="elderTheme = t"
            >{{ elderThemeName(t) }}</button>
          </div>
        </div>
        <div class="pref-row">
          <span class="pref-label">位置共享</span>
          <label class="loc-switch">
            <input v-model="shareLocation" type="checkbox" />
            <span>{{ shareLocation ? '允许长辈共享位置' : '不允许' }}</span>
          </label>
        </div>
        <p class="block-hint">打开后，长辈端会出现「让子女看到我在哪」按钮。长辈得自己点一下才会传位置，随时能停；位置只保留最新一次。</p>
      </section>

      <!-- 本次包含的家人：默认全选，可按组一键加入/取消 -->
      <section class="paper-card block" aria-label="本次包含的家人">
        <div class="fam-pick-head">
          <h2 class="block-title">本次包含的家人</h2>
          <span class="fam-pick-count">已选 {{ pickedCount }} / {{ familyList.length }}</span>
        </div>
        <p class="block-hint">这些人的电话会出现在长辈端「家人电话」页。每次分享都重新确认一次，避免把不该给的电话带出去。</p>

        <template v-if="familyList.length">
          <div v-if="familyGroups.length" class="group-quick" role="group" aria-label="按分组快速选择">
            <button
              v-for="g in familyGroups" :key="g.id"
              type="button"
              class="pref-btn"
              :class="{ active: groupAllPicked(g) }"
              :aria-pressed="groupAllPicked(g)"
              @click="toggleGroupPicked(g)"
            >{{ g.name }}</button>
          </div>

          <div class="pick-list">
            <label v-for="f in familyList" :key="f.id" class="pick-item">
              <input type="checkbox" :checked="isPicked(f.id)" @change="togglePicked(f.id)" />
              <span class="pick-name">{{ f.name }}</span>
              <span v-if="f.relation" class="tag tag-brand">{{ f.relation }}</span>
              <span v-if="f.callsMe" class="tag">他叫你：{{ f.callsMe }}</span>
            </label>
          </div>

          <div class="pick-actions">
            <button type="button" class="btn btn-ghost btn-sm" @click="selectAllFamily(true)">全选</button>
            <button type="button" class="btn btn-ghost btn-sm" @click="selectAllFamily(false)">全不选</button>
          </div>
          <p v-if="!pickedCount" class="block-hint">一个家人都没选：这次的链接里不会带任何电话。</p>

          <!-- 首选联系人：长辈端「按住求助」会打给这个人 -->
          <div v-if="pickedList.length" class="pref-pick">
            <p class="pref-pick-title">紧急求助打给谁（首选联系人）</p>
            <label v-for="f in pickedList" :key="'pref' + f.id" class="pref-radio">
              <input
                type="radio"
                name="preferred"
                :value="f.id"
                :checked="effectivePreferredId === f.id"
                @change="preferredId = f.id"
              />
              <span>{{ f.name }}<template v-if="f.relation">（{{ f.relation }}）</template></span>
            </label>
            <p class="block-hint">长辈端顶部的「遇到困难，按住这个按钮」长按 1 秒就会拨给这个人，并把位置短信发给他。</p>
          </div>
        </template>
        <p v-else class="block-hint">还没有家人。去「家人」页添加后，这里就能选了。</p>
      </section>

      <section class="paper-card block" aria-label="生成分享链接">
        <h2 class="block-title">生成分享链接</h2>
        <button class="btn btn-primary" @click="generate">生成分享链接</button>

        <div v-if="result" class="result">
          <div class="qr-card">
            <img v-if="result.dataUrl" :src="result.dataUrl" :width="QR_BOX" :height="QR_BOX" alt="长辈端二维码" />
            <div v-else class="qr-fallback">
              <p class="qr-fallback-title">这次行程太长，二维码装不下</p>
              <p class="qr-fallback-hint">不用扫码也能送过去：复制下面的链接，或者用「发给长辈」发短信 / 邮件，任选一条。</p>
            </div>
          </div>
          <p v-if="result.qr && result.qr.pxPerModule < 2.4" class="qr-dense">
            行程较长，码比较密（每格 {{ result.qr.pxPerModule.toFixed(2) }}px）；扫不动就直接复制链接。
          </p>

          <div class="link-row">
            <label class="visually-hidden" for="share-url">分享链接</label>
            <input
              id="share-url"
              ref="linkInput"
              class="link-input"
              type="text"
              readonly
              :value="result.url"
              @focus="$event.target.select()"
            />
            <button class="btn btn-ghost" @click="copyLink(result.url)">复制链接</button>
          </div>

          <div class="code-row">
            <span class="code6 num" ref="codeRef">
              <span v-for="(d, i) in codeDigits" :key="i" class="code-digit">{{ d }}</span>
            </span>
            <p class="code-hint">长辈在本机打开长辈端可输码；扫码或点链接任何设备都行，不用登录</p>
          </div>

          <p class="pick-summary">
            本次包含的家人：{{ result.contactNames.length ? result.contactNames.join('、') : '（没有带家人电话）' }}
          </p>

          <button class="btn btn-ghost" @click="previewElder">预览长辈页</button>
        </div>
      </section>

      <section class="paper-card block" aria-label="发给长辈">
        <h2 class="block-title">发给长辈</h2>
        <p class="block-hint">填手机号或邮箱，把链接直接送过去。{{ channelHint }}</p>
        <div class="send-row">
          <label class="visually-hidden" for="send-to">手机号或邮箱</label>
          <input id="send-to" v-model="sendTo" class="send-input" type="text" autocomplete="off" placeholder="13800000000 或 name@example.com" />
          <button class="btn btn-primary" :disabled="sending !== ''" @click="sendBy(KIND_SMS)">
            {{ sending === KIND_SMS ? '发送中…' : '发短信' }}
          </button>
          <button class="btn btn-ghost" :disabled="sending !== ''" @click="sendBy(KIND_EMAIL)">
            {{ sending === KIND_EMAIL ? '发送中…' : '发邮件' }}
          </button>
        </div>
        <p v-if="sendErr" class="send-err" role="alert">{{ sendErr }}</p>
        <p v-if="sendNote" class="send-note" role="status">{{ sendNote }}</p>
      </section>

      <section class="paper-card block" aria-label="分享给其他子女">
        <h2 class="block-title">分享给其他子女</h2>
        <p class="block-hint">
          对方也是安程用户、但不是这台设备上的账号时用它：把这条行程生成一条自包含链接（带 6 位码），
          他登录安程后打开链接，就能把这条行程复制进自己的行程列表。
        </p>
        <button class="btn btn-primary" @click="generateInvite">生成子女邀请链接</button>

        <div v-if="inviteResult" class="result">
          <div class="qr-card">
            <img v-if="inviteResult.dataUrl" :src="inviteResult.dataUrl" :width="QR_BOX" :height="QR_BOX" alt="子女邀请二维码" />
            <div v-else class="qr-fallback">
              <p class="qr-fallback-title">这条邀请太长，二维码装不下</p>
              <p class="qr-fallback-hint">把下面的链接或 6 位码发给他也一样：对方登录安程后打开链接、或输码，都能把行程复制过去。</p>
            </div>
          </div>
          <p v-if="inviteResult.qr && inviteResult.qr.pxPerModule < 2.4" class="qr-dense">
            行程较长，码比较密（每格 {{ inviteResult.qr.pxPerModule.toFixed(2) }}px）；扫不动就复制链接或直接发 6 位码。
          </p>

          <div class="link-row">
            <label class="visually-hidden" for="invite-url">子女邀请链接</label>
            <input id="invite-url" class="link-input" type="text" readonly :value="inviteResult.url" @focus="$event.target.select()" />
            <button class="btn btn-ghost" @click="copyLink(inviteResult.url)">复制链接</button>
          </div>
          <div class="code-row">
            <span class="code6 num">
              <span v-for="(d, i) in inviteDigits" :key="i" class="code-digit">{{ d }}</span>
            </span>
            <p class="code-hint">对方在安程输这 6 位码就能接收，或直接打开上面的链接</p>
          </div>
          <p class="block-hint">有效期至 {{ fmt(new Date(inviteResult.exp)) }}，和上面的分享同一天数。</p>

          <div class="send-row">
            <label class="visually-hidden" for="invite-to">对方手机号或邮箱</label>
            <input id="invite-to" v-model="sendTo" class="send-input" type="text" autocomplete="off" placeholder="13800000000 或 name@example.com" />
            <button class="btn btn-primary" :disabled="inviteSending !== ''" @click="sendInviteBy(KIND_SMS)">
              {{ inviteSending === KIND_SMS ? '发送中…' : '发短信' }}
            </button>
            <button class="btn btn-ghost" :disabled="inviteSending !== ''" @click="sendInviteBy(KIND_EMAIL)">
              {{ inviteSending === KIND_EMAIL ? '发送中…' : '发邮件' }}
            </button>
          </div>
          <p v-if="inviteErr" class="send-err" role="alert">{{ inviteErr }}</p>
          <p v-if="inviteNote" class="send-note" role="status">{{ inviteNote }}</p>
        </div>

        <ul v-if="inviteRecords().length" class="share-list invite-history">
          <li v-for="v in inviteRecords()" :key="v.id" class="share-item">
            <div class="share-info">
              <p class="share-line">子女邀请 · 生成于 {{ fmtDateTime(v.createdAt) }}</p>
              <p class="share-line">6 位码 {{ v.code6 }} · 有效期至 {{ fmt(new Date(v.exp)) }}</p>
            </div>
            <div class="share-actions">
              <button class="btn btn-ghost btn-sm" @click="copyLink(buildInviteUrl(v.token))">复制链接</button>
            </div>
          </li>
        </ul>
      </section>

      <section class="paper-card block" aria-label="分享记录">
        <h2 class="block-title">本行程的分享记录</h2>
        <ul v-if="tripShares.length" class="share-list">
          <li v-for="s in tripShares" :key="s.id" class="share-item">
            <div class="share-info">
              <p class="share-line">生成于 {{ fmtDateTime(s.createdAt) }}</p>
              <p class="share-line">有效期至 {{ fmt(new Date(s.exp)) }}</p>
              <p v-if="s.contactNames && s.contactNames.length" class="share-line share-fam">
                本次家人：{{ s.contactNames.join('、') }}
              </p>
              <p v-else class="share-line share-fam">本次家人：（没带家人电话）</p>
            </div>
            <div class="share-actions">
              <span class="tag" :class="shareActive(s) ? 'tag-brand' : 'tag-err'">
                {{ shareActive(s) ? '有效' : '已过期' }}
              </span>
              <button class="btn btn-ghost btn-sm" @click="copyLink(buildShareUrl(s.token))">复制链接</button>
            </div>
          </li>
        </ul>
        <p v-else class="block-hint">还没有生成过分享。选好有效期，点上面的按钮。</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-head { align-items: flex-end; }

.block-title { margin-bottom: 12px; }
.block-hint { margin: 10px 0 0; font-size: 13px; color: var(--c-ink-1); }

/* 发给长辈：手机号/邮箱 + 两个通道按钮 */
.send-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; }
.send-input { flex: 1; min-width: 200px; }
.send-err { margin: 10px 0 0; font-size: 13px; color: var(--c-err); }
.send-note {
  margin: 10px 0 0;
  padding: 10px 12px;
  border-left: 3px solid var(--c-ok);
  background: rgba(46, 107, 52, 0.06);
  font-size: 13px;
  color: var(--c-ink-0);
}

/* 长辈端显示：字号 / 主题 */
.pref-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.pref-label { flex: none; font-size: 14px; color: var(--c-ink-1); }
.loc-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-s);
  background: var(--c-bg-1);
  font-size: 14px;
  color: var(--c-ink-1);
  cursor: pointer;
}
.loc-switch input { accent-color: var(--c-brand); }
.pref-opts { display: flex; gap: 8px; flex-wrap: wrap; }
.pref-btn {
  min-width: 76px;
  padding: 7px 14px;
  font-size: 14px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-s);
  background: var(--c-bg-1);
  color: var(--c-ink-1);
}
.pref-btn:hover { border-color: rgba(11, 107, 69, 0.45); color: var(--c-ink-0); }
.pref-btn.active {
  border-color: var(--c-brand);
  background: rgba(11, 107, 69, 0.06);
  color: var(--c-brand);
  font-weight: 600;
}

.ttl-row { display: flex; gap: 10px; flex-wrap: wrap; }
.ttl-card {
  flex: 1;
  min-width: 96px;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  padding: 14px 10px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-m);
  background: var(--c-card);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.ttl-card:hover { background: var(--c-bg-1); }
.ttl-card.active {
  border-color: var(--c-brand);
  background: rgba(11, 107, 69, 0.05);
  box-shadow: inset 0 0 0 1px var(--c-brand);
}
.ttl-radio { accent-color: var(--c-brand); align-self: center; }
.ttl-num { font-size: 26px; font-weight: 700; color: var(--c-ink-0); }
.ttl-card.active .ttl-num { color: var(--c-brand); }
.ttl-unit { font-size: 13px; color: var(--c-ink-2); }

.result {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px dashed var(--c-line);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.qr-card {
  align-self: center;
  background: #FFFFFF;
  padding: 12px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-m);
}
.qr-fallback { max-width: 248px; padding: 12px 8px; }
.qr-fallback-title { margin: 0 0 6px; font-size: 14px; font-weight: 600; color: var(--c-ink-0); }
.qr-fallback-hint { margin: 0; font-size: 13px; line-height: 1.7; color: var(--c-ink-1); }
.qr-dense { margin: 10px 0 0; text-align: center; font-size: 13px; color: var(--c-warn); }
.qr-card img { display: block; }

.link-row { display: flex; gap: 8px; align-items: stretch; }
.link-input { flex: 1; min-width: 0; font-size: 13px; color: var(--c-ink-1); }

.code-row { text-align: center; }
.code6 {
  display: inline-block;
  overflow: hidden;
  font-size: 44px;
  letter-spacing: 12px;
  margin-right: -12px; /* 抵消最后一个字的字距，视觉居中 */
  color: var(--c-brand);
  line-height: 1.2;
}
.code-digit { display: inline-block; }
.code-hint { margin: 6px 0 0; font-size: 13px; color: var(--c-ink-2); }

.share-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.share-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 0;
  border-bottom: 1px dashed var(--c-line);
}
.share-item:last-child { border-bottom: none; }
.share-info { min-width: 0; }
.share-line { margin: 2px 0 0; font-size: 14px; color: var(--c-ink-1); }
.share-actions { display: flex; align-items: center; gap: 8px; }

/* ---- 本次包含的家人 ---- */
.fam-pick-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.fam-pick-count { font-size: 13px; color: var(--c-ink-2); }
.group-quick { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 4px; }
.pick-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.pick-item {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--c-line);
  border-radius: var(--r-s);
  background: var(--c-bg-1);
  cursor: pointer;
}
.pick-item input { width: auto; accent-color: var(--c-brand); }
.pick-name { font-size: 15px; font-weight: 600; }
.pick-actions { display: flex; gap: 8px; margin-top: 12px; }
.pref-pick {
  margin-top: 14px;
  padding: 14px;
  border: 1px dashed var(--c-line);
  border-radius: var(--r-m);
  background: var(--c-bg-1);
}
.pref-pick-title { margin: 0 0 10px; font-size: 14px; font-weight: 700; color: var(--c-ink-0); }
.pref-radio {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  font-size: 15px;
  color: var(--c-ink-0);
  cursor: pointer;
}
.pref-radio input { width: auto; accent-color: var(--c-brand); }
.pick-summary {
  margin: 0;
  padding: 10px 12px;
  border-left: 3px solid var(--c-brand);
  background: rgba(11, 107, 69, 0.05);
  font-size: 13px;
  color: var(--c-ink-0);
  overflow-wrap: anywhere;
}
.share-fam { color: var(--c-ink-2); }
.invite-history { margin-top: 14px; }
</style>
