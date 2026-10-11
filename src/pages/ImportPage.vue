<script setup>
// 导入页（核心页）：粘贴原文 → runPipeline 解析 → 预览核对 → 确认入库。
// 草稿随账号桶自动保存（800ms 防抖），下次进来接着写。
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, uid, upsertTrip, setDraft, clearDraft } from '../core/store.js'
import { runPipeline, issueLabel } from '../core/agents.js'
import { runAssist, applyAssist, hasWork, extractTextFromImage } from '../core/ai.js'
import { loadModelConfig, isConfigured, reasonText } from '../core/model.js'

defineProps({ params: { type: Object, default: () => ({}) } })

const RAW_PLACEHOLDER = '例如：\n10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到\n住一晚 如家酒店(北京南站店)\n第二天高铁 G104 上海虹桥 -> 杭州东'

// 本地时区 'YYYY-MM-DD'
function fmt(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const raw = ref('')
const fallbackDate = ref(fmt(new Date()))
const restored = ref(false)
const parsing = ref(false)
const result = ref(null)

// ---- 草稿：输入停 800ms 且原文非空才落盘 ----
let draftTimer = null
let restoring = false
watch([raw, fallbackDate], ([r]) => {
  if (restoring) return
  clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    if (!r.trim()) return
    const saved = setDraft({ raw: r, fallbackDate: fallbackDate.value, savedAt: Date.now() })
    if (!saved.ok) toast('草稿没有保存到本机，请保留或复制原文后重试', 'err')
  }, 800)
})
onMounted(() => {
  const d = store.data.draft
  if (d && d.raw) {
    restoring = true
    raw.value = d.raw
    fallbackDate.value = d.fallbackDate || fmt(new Date())
    restored.value = true
    nextTick(() => { restoring = false })
  }
})

// ---- 模型能力标记（决定 AI 按钮是否可用）----
// 配置是设备级的，用户可能先去「模型配置」填完再回来，所以每次进页面重读一次。
const modelReady = ref(false)
const visionReady = ref(false)
function refreshModelFlags() {
  const cfg = loadModelConfig()
  modelReady.value = isConfigured(cfg)
  visionReady.value = isConfigured(cfg) && !!cfg.vision
}
onMounted(refreshModelFlags)

// ---- §E2 截图识字：认出的文字填进输入框，不自动解析 ----
const ocrBusy = ref(false)
const imgInput = ref(null)
function pickImage() { imgInput.value?.click() }
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(new Error('读取图片失败'))
    fr.readAsDataURL(file)
  })
}
async function onImagePicked(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 允许连续选同一张图
  if (!file) return
  const cfg = loadModelConfig()
  if (!isConfigured(cfg) || !cfg.vision) { toast(reasonText('no-vision'), 'warn'); return }
  ocrBusy.value = true
  try {
    const dataUrl = await readAsDataURL(file)
    const r = await extractTextFromImage(dataUrl, { cfg })
    if (!r.ok) { toast(reasonText(r.reason) + (r.detail ? `（${r.detail}）` : ''), 'err'); return }
    if (!r.text) { toast('没认出文字，换一张更清楚的截图试试', 'warn'); return }
    raw.value = raw.value.trim() ? raw.value.trim() + '\n' + r.text : r.text
    toast('已把图里的文字填进输入框，请核对后再解析', 'ok')
  } catch (err) {
    toast('识字失败：' + ((err && err.message) || err), 'err')
  } finally {
    ocrBusy.value = false
  }
}

// ---- §E1 AI 一键补全：先出预览，用户确认后再落地 ----
const assisting = ref(false)
const assistPreview = ref(null)
const canAssist = computed(() => !!(result.value && hasWork(result.value)))

async function aiAssist() {
  if (assisting.value) return
  const cfg = loadModelConfig()
  if (!isConfigured(cfg)) { toast('先去「我的 · 模型配置」填一个模型', 'warn'); return }
  assisting.value = true
  assistPreview.value = null
  try {
    const r = await runAssist(result.value, { cfg, today: fmt(new Date()), fallbackDate: fallbackDate.value || null })
    if (!r.ok) { toast(reasonText(r.reason) + (r.detail ? `（${r.detail}）` : ''), 'err'); return }
    assistPreview.value = { patches: r.patches, summary: r.summary }
  } catch (e) {
    toast('AI 补全失败：' + ((e && e.message) || e), 'err')
  } finally {
    assisting.value = false
  }
}
function applyAssistResult() {
  const p = assistPreview.value
  if (!p) return
  const r = applyAssist(result.value, p.patches, { today: fmt(new Date()) })
  assistPreview.value = null
  if (!r.ok) { toast(reasonText(r.reason), 'err'); return }
  toast(`已补全 ${r.filled + r.added} 项，标了「待人工确认」的段请再核对`, 'ok')
}
function cancelAssist() { assistPreview.value = null }

// ---- 解析 ----
async function parse() {
  if (parsing.value) return
  if (!raw.value.trim()) {
    toast('请先粘贴行程原文', 'warn')
    return
  }
  parsing.value = true
  try {
    result.value = runPipeline(raw.value, { today: fmt(new Date()), fallbackDate: fallbackDate.value || null })
  } catch (e) {
    toast('解析失败：' + (e && e.message ? e.message : '未知错误'), 'err')
  } finally {
    parsing.value = false
  }
}
function resetResult() {
  result.value = null
}

// 待确认项数量：问题 + 看不懂的原文行。解析结果里先把它们顶到最上面，
// 免得用户扫过一屏卡片就点了「确认导入」。
const reviewCount = computed(() => {
  const r = result.value
  if (!r) return 0
  return ((r.issues && r.issues.length) || 0) + ((r.unparsed && r.unparsed.length) || 0)
})

// ---- 确认导入 ----
function confirmImport() {
  if (!result.value) return
  const trip = { ...result.value, id: uid('trip'), createdAt: Date.now(), updatedAt: Date.now() }
  const saved = upsertTrip(trip)
  if (!saved.ok) { toast('没有保存到本机，原文和预览仍在，请复制原文或重试', 'err'); return }
  clearTimeout(draftTimer)
  clearDraft()
  toast('行程已导入', 'ok')
  navigate('/trip/' + trip.id)
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
function todosOf(seg) {
  return (seg && Array.isArray(seg.todos)) ? seg.todos : []
}

onBeforeUnmount(() => {
  clearTimeout(draftTimer)
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <span class="page-kicker">导入 · 粘贴原文</span>
        <h1 class="page-title">把原文粘进来，剩下的我来排</h1>
        <p class="page-sub">短信、行程单、聊天记录原样粘贴即可；看不懂的地方会标出来让你确认。</p>
      </div>
    </header>

    <form class="paper-card editor" @submit.prevent="parse">
      <div class="ocr-row">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="ocrBusy" @click="pickImage">
          {{ ocrBusy ? '识字中…' : '传一张车票截图识字' }}
        </button>
        <span class="ocr-hint">
          {{ visionReady ? '认出的文字会填进输入框，你核对后再解析' : '当前模型没开「支持图片」，可先去「我的 · 模型配置」打开' }}
        </span>
        <input
          ref="imgInput"
          class="visually-hidden"
          type="file"
          accept="image/*"
          aria-label="选择车票截图"
          @change="onImagePicked"
        />
      </div>

      <div class="field">
        <label for="raw-input">粘贴行程原文</label>
        <textarea
          id="raw-input"
          v-model="raw"
          rows="9"
          :placeholder="RAW_PLACEHOLDER"
          spellcheck="false"
        ></textarea>
      </div>
      <div class="aux-row">
        <div class="fallback">
          <label for="fallback-date">兜底日期</label>
          <input id="fallback-date" v-model="fallbackDate" type="date" />
        </div>
        <p class="aux-hint">行程原文里写了日期时，以原文为准</p>
      </div>

      <p v-if="restored" class="restore-bar" role="status">已恢复上次没发完的草稿</p>

      <div class="editor-actions">
        <button type="submit" class="btn btn-primary" :disabled="parsing">
          {{ parsing ? '解析中…' : '解析行程' }}
        </button>
      </div>
    </form>

    <section v-if="result" class="preview" aria-label="解析结果预览">
      <h2 class="section-title">解析结果</h2>

      <div v-if="reviewCount" class="review" aria-label="需要确认的地方">
        <p class="review-title">先看这 {{ reviewCount }} 处，确认无误再导入</p>
        <p
          v-for="(iss, ii) in result.issues"
          :key="'iss' + ii"
          class="issue"
          :class="'issue-' + iss.level"
          :role="iss.level === 'error' ? 'alert' : undefined"
        >
          <span class="issue-msg">{{ iss.message }}</span>
          <span v-if="issueLabel(iss.code)" class="tag">{{ issueLabel(iss.code) }}</span>
        </p>
        <div v-if="result.unparsed && result.unparsed.length" class="unparsed" role="alert">
          <p class="unparsed-title">这几行没看懂，请手动补充</p>
          <p v-for="(line, li) in result.unparsed" :key="li" class="unparsed-line">{{ line }}</p>
        </div>

        <div v-if="canAssist" class="assist">
          <button class="btn btn-ghost btn-sm" :disabled="assisting" @click="aiAssist">
            {{ assisting ? 'AI 补全中…' : 'AI 一键补全' }}
          </button>
          <span class="assist-hint">
            {{ modelReady ? '用你自己的模型补齐上面的空缺，补完仍要核对' : '未配置模型：去「我的 · 模型配置」填一个' }}
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
      </div>

      <ul class="seg-list">
        <li v-for="s in result.segments" :key="s.id" class="paper-card seg">
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
              <p v-if="s.type === 'activity' && s.note" class="seg-note">{{ s.note }}</p>
              <p v-if="s.guide" class="seg-guide">出站后往哪走：{{ s.guide }}</p>
              <p v-if="todosOf(s).length" class="seg-todo-hint">到了之后做什么：{{ todosOf(s).map((t) => t.text).join('、') }}</p>
              <ul v-if="tipsOf(s).length" class="seg-tips">
                <li v-for="(tip, ti) in tipsOf(s)" :key="ti">{{ tip }}</li>
              </ul>
            </div>
          </div>
        </li>
      </ul>

      <div class="confirm-row">
        <button class="btn btn-primary" @click="confirmImport">确认导入</button>
        <button class="btn btn-ghost" @click="resetResult">重新解析</button>
      </div>
    </section>

    <aside class="paper-card note-card">
      <p>解析会经过三道工序：理解原文 → 翻成人话 → 合理性检查。解析仅供参考，关键信息请核对。</p>
    </aside>
  </div>
</template>

<style scoped>
.editor { padding: 18px; }
.field label { display: block; font-size: 14px; color: var(--c-ink-1); margin-bottom: 6px; }
textarea { resize: vertical; line-height: 1.7; font-size: 14px; }

.aux-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.fallback { display: flex; align-items: center; gap: 8px; }
.fallback label { font-size: 14px; color: var(--c-ink-1); flex: none; }
.fallback input { width: auto; }
.aux-hint { margin: 0; font-size: 12px; color: var(--c-ink-2); }

.restore-bar {
  margin: 14px 0 0;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--c-warn);
  background: rgba(154, 107, 8, 0.07);
  border: 1px solid rgba(154, 107, 8, 0.35);
  border-radius: var(--r-s);
}

.editor-actions { margin-top: 14px; }

.ocr-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.ocr-hint { font-size: 12px; color: var(--c-ink-2); }

.assist { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.assist-hint { font-size: 12px; color: var(--c-ink-2); }
.assist-preview {
  padding: 12px 14px;
  border: 1px solid var(--c-brand);
  border-radius: var(--r-m);
  background: rgba(11, 107, 69, 0.06);
}
.assist-preview-title { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: var(--c-brand); }
.assist-list { margin: 0; padding-left: 18px; font-size: 13px; color: var(--c-ink-1); }
.assist-list li { margin: 3px 0; }
.assist-actions { margin-top: 10px; display: flex; gap: 8px; }

.section-title { margin: 24px 0 12px; font-size: 20px; letter-spacing: 1px; }

/* 待确认区：顶在预览卡片之前，用户先看到"要核对什么"再去看卡片 */
.review { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
.review-title { margin: 0 0 2px; font-size: 14px; font-weight: 700; color: var(--c-ink-0); }

.seg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.seg { padding: 14px 16px; }
.seg-main { display: flex; gap: 12px; }
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
.seg-guide { margin: 6px 0 0; font-size: 13px; color: var(--c-ink-1); }
.seg-todo-hint { margin: 6px 0 0; font-size: 13px; color: var(--c-brand); }

.issue {
  margin: 0;
  padding: 8px 12px;
  font-size: 14px;
  border-left: 3px solid var(--c-line);
  border-radius: 0 var(--r-s) var(--r-s) 0;
  background: var(--c-bg-1);
  color: var(--c-ink-1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
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

.unparsed {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(154, 107, 8, 0.4);
  border-radius: var(--r-s);
  background: rgba(154, 107, 8, 0.07);
}
.unparsed-title { margin: 0 0 6px; font-size: 14px; font-weight: 600; color: var(--c-warn); }
.unparsed-line { margin: 4px 0 0; font-size: 13px; color: var(--c-ink-1); }

.confirm-row { margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap; }

.note-card {
  margin-top: 24px;
  padding: 12px 16px;
}
.note-card p { margin: 0; font-size: 13px; color: var(--c-ink-2); }
</style>
