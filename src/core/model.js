// 自定义模型配置（OpenAI 兼容协议）。
//
// 为什么要它：解析补漏（AI 补全待确认项）和截图识字都依赖一个"用户自己的模型"。
// 同类产品（Cherry Studio / Chatbox / LobeChat）的共识字段就是这四个：
//   Base URL + API Key + 模型名称 + 是否支持视觉；再补上温度与"走服务端代理"。
//
// 协议：POST {baseUrl}/chat/completions，取 choices[0].message.content。
// 策略：**直连优先**（浏览器直接打上游）；直连被 CORS / 网络挡住、且用户开了代理时，
//   回落自部署的 POST /api/model 由服务端转发（密钥只在这一次请求里经过自己的服务端）。
//
// 存储：设备级 localStorage（ptb:model），不进账号桶，密钥明文、只在浏览器里。
// 依赖：只 import store.js 的 KEYS / safeGet / safeSet / safeDel，其余零依赖。
import { KEYS, safeGet, safeSet, safeDel } from './store.js'

export const MODEL_PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', vision: true },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', vision: false },
  { id: 'dashscope', label: '通义千问（阿里云）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', vision: false },
  { id: 'ollama', label: 'Ollama（本机）', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', vision: false },
  { id: 'custom', label: '自定义', baseUrl: '', model: '', vision: false },
]

export function emptyModelConfig() {
  return {
    presetId: 'custom',
    baseUrl: '',
    apiKey: '',
    model: '',
    vision: false,
    temperature: 0.2,
    useProxy: false,
    timeoutMs: 30000,
  }
}

export function presetById(id) {
  return MODEL_PRESETS.find((p) => p.id === id) || null
}

// 白名单校验：localStorage 里的脏数据不许污染请求（key 类型错、温度越界都会被收回来）
export function normalizeModelConfig(raw) {
  const d = emptyModelConfig()
  if (!raw || typeof raw !== 'object') return d
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const num = (v, lo, hi, fb) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb)
  return {
    presetId: MODEL_PRESETS.some((p) => p.id === raw.presetId) ? raw.presetId : d.presetId,
    baseUrl: str(raw.baseUrl, 300),
    apiKey: str(raw.apiKey, 400),
    model: str(raw.model, 120),
    vision: !!raw.vision,
    temperature: num(raw.temperature, 0, 2, d.temperature),
    useProxy: !!raw.useProxy,
    timeoutMs: num(raw.timeoutMs, 3000, 120000, d.timeoutMs),
  }
}

export function loadModelConfig() {
  return normalizeModelConfig(safeGet(KEYS.model, null))
}
export function saveModelConfig(cfg) {
  const next = normalizeModelConfig(cfg)
  safeSet(KEYS.model, next)
  return next
}
export function clearModelConfig() {
  safeDel(KEYS.model)
}

// 有 baseUrl + 模型名就算配好了（Ollama 这类本机模型不需要 key）
export function isConfigured(cfg) {
  const c = cfg || {}
  return !!(c.baseUrl && c.model)
}
export function supportsVision(cfg) {
  return !!(cfg && cfg.vision)
}

// 选预设：只覆盖该预设提供的字段，用户手填过的 key / 代理开关保留
export function applyPreset(cfg, presetId) {
  const p = presetById(presetId)
  const base = normalizeModelConfig(cfg)
  if (!p) return { ...base, presetId }
  return {
    ...base,
    presetId,
    baseUrl: p.baseUrl || base.baseUrl,
    model: p.model || base.model,
    vision: p.vision,
  }
}

function endpoint(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '') + '/chat/completions'
}

function buildBody(conf, messages, temperature) {
  return {
    model: conf.model,
    messages,
    temperature: temperature != null ? temperature : conf.temperature,
  }
}

function timeoutController(ms) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  return { ctl, done: () => clearTimeout(timer) }
}

function errText(data, raw) {
  if (data && data.error && data.error.message) return String(data.error.message).slice(0, 200)
  return String(raw || '').slice(0, 200)
}

// 统一解析上游回包：非 2xx / 缺 content 都返回结构化错误，不抛
async function readResponse(r) {
  const raw = await r.text().catch(() => '')
  let data = null
  try { data = JSON.parse(raw) } catch { data = null }
  if (!r.ok) return { ok: false, reason: 'http-' + r.status, detail: errText(data, raw) }
  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content
  if (typeof content !== 'string' || !content) {
    return { ok: false, reason: 'bad-response', detail: errText(data, raw) }
  }
  return { ok: true, content }
}

async function requestDirect(conf, messages, temperature) {
  const { ctl, done } = timeoutController(conf.timeoutMs)
  try {
    const headers = { 'content-type': 'application/json' }
    if (conf.apiKey) headers.authorization = 'Bearer ' + conf.apiKey
    const r = await fetch(endpoint(conf.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(buildBody(conf, messages, temperature)),
      signal: ctl.signal,
    })
    return await readResponse(r)
  } catch (e) {
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    done()
  }
}

async function requestProxy(conf, messages, temperature) {
  const { ctl, done } = timeoutController(conf.timeoutMs)
  try {
    const r = await fetch('/api/model', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: conf.baseUrl,
        apiKey: conf.apiKey,
        model: conf.model,
        messages,
        temperature: temperature != null ? temperature : conf.temperature,
      }),
      signal: ctl.signal,
    })
    const data = await r.json().catch(() => null)
    if (!r.ok || !data || data.ok !== true) {
      return { ok: false, reason: data?.reason || 'http-' + r.status, detail: String(data?.detail || '').slice(0, 200) }
    }
    if (typeof data.content !== 'string' || !data.content.trim()) return { ok: false, reason: 'bad-response' }
    return { ok: true, content: data.content }
  } catch (e) {
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    done()
  }
}

// 主入口：直连优先 → 失败且开了代理 → 走 /api/model
// 返回 { ok:true, content } | { ok:false, reason, detail?, via? }
export async function chat(messages, { cfg, temperature } = {}) {
  const conf = normalizeModelConfig(cfg)
  if (!isConfigured(conf)) return { ok: false, reason: 'not-configured' }
  const direct = await requestDirect(conf, messages, temperature)
  if (direct.ok) return { ok: true, content: direct.content, via: 'direct' }
  if (!conf.useProxy) return { ...direct, via: 'direct' }
  const viaProxy = await requestProxy(conf, messages, temperature)
  if (viaProxy.ok) return { ok: true, content: viaProxy.content, via: 'proxy' }
  return { ok: false, reason: viaProxy.reason, detail: viaProxy.detail, via: 'proxy', directReason: direct.reason }
}

// 测试连接：发一条极短请求，只关心能否走通
export async function testConnection(cfg) {
  const r = await chat([{ role: 'user', content: 'ping' }], { cfg, temperature: 0 })
  if (!r.ok) return r
  return { ok: true, via: r.via, sample: String(r.content).trim().slice(0, 40) }
}

// 把错误码翻译成给用户看的话
export function reasonText(reason) {
  const map = {
    'not-configured': '还没配置模型，先去「模型配置」填 Base URL 和模型名称',
    'network': '连不上这个地址（可能是地址写错，或浏览器跨域被挡）',
    'timeout': '请求超时了，检查网络或把超时时间调大',
    'bad-response': '对方回了，但不是标准的接口格式',
    'no-vision': '当前模型没开「支持图片」，去模型配置里打开，或换一个支持视觉的模型',
    'bad-json': '模型没按要求的 JSON 格式回答，可以再试一次',
    'nothing-found': '模型没能从原文里补出确定的信息',
    'nothing-to-do': '没有需要补的地方了',
    'bad-patches': '补全结果格式不对，已忽略',
  }
  if (reason && reason.startsWith('http-')) {
    const code = reason.slice(5)
    if (code === '401' || code === '403') return 'API Key 不对或没权限'
    if (code === '404') return '地址不对（404）：Base URL 结尾通常是 /v1'
    if (code === '429') return '请求太频繁或额度不足'
    return '接口返回 ' + code
  }
  return map[reason] || '调用失败：' + reason
}

// 给多模态消息用的图片 dataURL（截图识字）
export function imageContent(dataUrl) {
  return { type: 'image_url', image_url: { url: dataUrl } }
}