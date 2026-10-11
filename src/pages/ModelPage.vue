<script setup>
// 模型配置：给「AI 补全 / 截图识字」配一个 OpenAI 兼容的模型。
// 字段对齐同类产品共识：Base URL + API Key + 模型名称 + 是否支持视觉（另加温度、代理开关）。
// 配置只存本机；页面上把"密钥存在哪、什么时候会经过服务端"如实写清楚。
import { reactive, ref, computed } from 'vue'
import { navigate } from '../core/router.js'
import { toast } from '../core/store.js'
import {
  MODEL_PRESETS, loadModelConfig, saveModelConfig, clearModelConfig,
  applyPreset, isConfigured, testConnection, reasonText,
} from '../core/model.js'

const form = reactive(loadModelConfig())
const showKey = ref(false)
const testing = ref(false)
const testNote = ref('')
const testErr = ref('')
const savedOk = ref(isConfigured(loadModelConfig()))

// 选预设：自动填 baseUrl 与默认模型名，用户手填的 key / 代理开关保留
function pickPreset(e) {
  Object.assign(form, applyPreset({ ...form }, e.target.value))
}

const ready = computed(() => isConfigured(form))

function save() {
  if (!ready.value) { toast('Base URL 和模型名称都要填', 'warn'); return }
  const next = saveModelConfig({ ...form })
  Object.assign(form, next)
  savedOk.value = true
  toast('模型配置已保存', 'ok')
}

function clearAll() {
  clearModelConfig()
  Object.assign(form, loadModelConfig())
  savedOk.value = false
  testNote.value = ''
  testErr.value = ''
  toast('已清除模型配置', 'info')
}

async function runTest() {
  if (!ready.value) { testErr.value = '先填 Base URL 和模型名称'; return }
  testing.value = true
  testNote.value = ''
  testErr.value = ''
  try {
    const r = await testConnection({ ...form })
    if (r.ok) {
      const via = r.via === 'proxy' ? '服务端代理' : '浏览器直连'
      testNote.value = `连通了（走${via}）` + (r.sample ? `；返回：${r.sample}` : '')
    } else {
      testErr.value = reasonText(r.reason) + (r.detail ? `（${r.detail}）` : '')
    }
  } catch (e) {
    testErr.value = '调用失败：' + ((e && e.message) || e)
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <span class="page-kicker">我的 · 模型配置</span>
        <h1 class="page-title">自定义模型</h1>
        <p class="page-sub">接你自己的模型来做「AI 补全」和「截图识字」。只要接口兼容 OpenAI 就行。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="navigate('/profile')">返回我的</button>
      </div>
    </header>

    <section class="paper-card block" aria-label="模型连接">
      <h2 class="block-title">连接</h2>

      <div class="field">
        <label for="preset">服务商</label>
        <select id="preset" :value="form.presetId" @change="pickPreset">
          <option v-for="p in MODEL_PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <p class="field-hint">选一个预设会自动填好地址和默认模型名，也可以选「自定义」自己写。</p>
      </div>

      <div class="field">
        <label for="base-url">Base URL</label>
        <input id="base-url" v-model.trim="form.baseUrl" type="url" autocomplete="off" spellcheck="false" placeholder="https://api.deepseek.com/v1" />
        <p class="field-hint">接口根地址，结尾一般是 <span class="num">/v1</span>；请求时自动拼 <span class="num">/chat/completions</span>。</p>
      </div>

      <div class="field">
        <label for="api-key">API Key</label>
        <div class="key-row">
          <input
            id="api-key"
            v-model.trim="form.apiKey"
            :type="showKey ? 'text' : 'password'"
            autocomplete="off"
            spellcheck="false"
            placeholder="sk-…"
          />
          <button type="button" class="btn btn-ghost btn-sm" :aria-pressed="showKey" @click="showKey = !showKey">
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </div>
        <p class="field-hint">本机模型（如 Ollama）可以不填。</p>
      </div>

      <div class="field">
        <label for="model-name">模型名称</label>
        <input id="model-name" v-model.trim="form.model" type="text" autocomplete="off" spellcheck="false" placeholder="deepseek-chat" />
      </div>

      <div class="field">
        <label for="temperature">温度（越低越稳）</label>
        <div class="range-row">
          <input id="temperature" v-model.number="form.temperature" type="range" min="0" max="1" step="0.1" />
          <span class="num range-val">{{ Number(form.temperature).toFixed(1) }}</span>
        </div>
        <p class="field-hint">解析行程这类结构化任务建议 0.2 或更低。</p>
      </div>
    </section>

    <section class="paper-card block" aria-label="能力与网络">
      <h2 class="block-title">能力与网络</h2>

      <label class="check-row" for="vision">
        <input id="vision" v-model="form.vision" type="checkbox" />
        <span class="check-text">
          <span class="check-title">这个模型支持图片（视觉）</span>
          <span class="check-desc">打开后，「截图识字」才能用。纯文本模型请关掉。</span>
        </span>
      </label>

      <label class="check-row" for="use-proxy">
        <input id="use-proxy" v-model="form.useProxy" type="checkbox" />
        <span class="check-text">
          <span class="check-title">直连失败时走服务端代理</span>
          <span class="check-desc">浏览器常被跨域拦住。打开后，直连失败会把这一次请求交给你自己部署的 <span class="num">/api/model</span> 转发；不打开就只直连。</span>
        </span>
      </label>
    </section>

    <section class="paper-card block" aria-label="操作">
      <div class="actions">
        <button class="btn btn-primary" :disabled="testing" @click="runTest">
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button class="btn btn-ghost" @click="save">保存</button>
        <button class="btn btn-danger" @click="clearAll">清除</button>
      </div>
      <p v-if="testErr" class="msg msg-err" role="alert">{{ testErr }}</p>
      <p v-if="testNote" class="msg msg-ok" role="status">{{ testNote }}</p>
      <p v-if="savedOk" class="msg msg-hint" role="status">已保存的配置在本机生效。</p>
    </section>

    <aside class="paper-card note-card" role="note">
      <p class="note-title">密钥放在哪</p>
      <p class="note-text">API Key 只存在这台设备的浏览器里（localStorage 的 <span class="num">ptb:model</span>），不会上传、不进备份、不跟账号同步；换一台设备要重新填。只有你打开「走服务端代理」并且直连失败时，这一次请求（含 Key）才会经过你自己部署的服务端。</p>
    </aside>
  </div>
</template>

<style scoped>
.field { margin-bottom: 16px; }
.field label { display: block; margin-bottom: 6px; font-size: 14px; color: var(--c-ink-1); }
.field-hint { margin: 6px 0 0; font-size: 12px; color: var(--c-ink-2); }

.key-row { display: flex; gap: 8px; align-items: stretch; }
.key-row input { flex: 1; min-width: 0; }

.range-row { display: flex; align-items: center; gap: 12px; }
.range-row input[type="range"] { flex: 1; padding: 0; accent-color: var(--c-brand); }
.range-val { font-size: 15px; color: var(--c-ink-1); min-width: 2.5em; }

.check-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--c-line);
  cursor: pointer;
}
.check-row:last-child { border-bottom: none; padding-bottom: 0; }
.check-row input[type="checkbox"] { width: auto; margin-top: 3px; accent-color: var(--c-brand); flex: none; }
.check-text { display: flex; flex-direction: column; gap: 2px; }
.check-title { font-size: 15px; }
.check-desc { font-size: 13px; color: var(--c-ink-2); }

.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.msg { margin: 12px 0 0; font-size: 13px; }
.msg-err { color: var(--c-err); }
.msg-ok { color: var(--c-ok); }
.msg-hint { color: var(--c-ink-2); }

.note-card { padding: 14px 16px; }
.note-title { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: var(--c-brand); }
.note-text { margin: 0; font-size: 13px; line-height: 1.7; color: var(--c-ink-1); }
</style>