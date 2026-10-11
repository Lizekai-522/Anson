// 闽南话播报：把「念什么、用什么念」算清楚，播放本身交给页面。
//
// 三条路（按设备能力择优，都断网可用）：
//   1) 设备本身有闽南语/台语声音（nan-TW / zh-TW 等）→ 直接念**动态完整句**（带车次、站点、时刻，信息最全）
//   2) 没有这种声音，但有预录音频包 → 播**骨架句**音频（如「今仔日坐车，爱提早到车头等」），
//      屏幕上仍有完整文字，长辈至少听得到提醒
//   3) 都没有 → 如实提示「这台设备没有闽南语声音」，普通话照常可用
//
// 音频包来源：scripts/make-minnan-audio.py 用 Meta MMS-TTS 的 nan 模型离线合成
// （生成物在 public/audio/nan/，含 manifest.json 与 NOTICE.md）。模板句与音频一一对应。

export const AUDIO_BASE = 'audio/nan/'
export const AUDIO_MANIFEST = AUDIO_BASE + 'manifest.json'
// 每类卡片的模板句条数（与 scripts/minnan-templates.json 一一对应）
export const AUDIO_PER_KIND = 5

// 卡片 → 语音包类别。ride 里再分 train/flight/taxi，住宿 stay，游玩 play。
export function kindOf(card) {
  const type = card && card.type
  const kind = card && card.kind
  if (kind === 'play' || type === 'activity') return 'activity'
  if (kind === 'stay' || type === 'hotel') return 'hotel'
  if (type === 'train' || type === 'flight' || type === 'taxi') return type
  return 'generic'
}

const RIDE_NAME = { train: '坐车', flight: '坐飞机', taxi: '坐车' }

function hhmm(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return ''
  return `${Number(m[1])} 点 ${m[2]} 分`
}

// 动态完整句（汉字闽南语写法，沿用台语书写惯例）。
// 说明：句式与用词按通用写法整理，未由母语者逐句校对；建议后续人工复核一遍再上正式场合。
export function nanPhrase(card, { index } = {}) {
  const c = card || {}
  const no = Number.isInteger(index) ? `第 ${index + 1} 段：` : ''
  const kind = kindOf(c)
  if (kind === 'hotel') {
    const to = c.to || '旅社'
    return `${no}今仔日欲蹛 ${to}，到旅社共名讲出，就领会着锁匙。`
  }
  if (kind === 'activity') {
    const place = c.to ? `去 ${c.to}` : '去行行'
    const when = c.timeOfDay ? c.timeOfDay : ''
    return `${no}今仔日${when}欲${place}，慢慢仔行，毋免赶。`
  }
  const verb = RIDE_NAME[kind] || '坐车'
  const from = c.from ? `ùi ${c.from} ` : ''
  const to = c.to ? `去 ${c.to}` : '去目的地'
  const dep = hhmm(c.depart)
  const tail = dep ? `，${dep}出发` : ''
  return `${no}今仔日${verb}，${from}${to}${tail}。爱注意时间，提早到。`
}

// 设备声音挑选：nan 想找台语/闽南语声音；zh 找普通话
export function pickDeviceVoice(voices, want = 'nan') {
  const list = (voices || []).filter(Boolean)
  const match = (cands) => list.find((v) => {
    const lang = String(v.lang || '').toLowerCase()
    return cands.some((c) => lang.startsWith(c))
  })
  if (want === 'nan') return match(['nan', 'zh-tw', 'zh-hant', 'yue']) || null
  return match(['zh-cn', 'zh']) || null
}

// 从清单里为某类卡片挑一条音频（优先同类轮换，再退到 generic，最后退到任意一条）
export function pickAudioItem(kind, manifest, { index = 0, prefer = 'pack' } = {}) {
  const items = (manifest && manifest.items) || {}
  if (prefer !== 'pack') return null
  const n = ((Number(index) || 0) % AUDIO_PER_KIND) + 1
  const sameKind = `nan_${kind}_${n}`
  if (items[sameKind]) return { id: sameKind, ...items[sameKind] }
  const anyKind = Object.keys(items).find((k) => k.startsWith(`nan_${kind}_`))
  if (anyKind) return { id: anyKind, ...items[anyKind] }
  const generic = Object.keys(items).find((k) => k.startsWith('nan_generic_'))
  if (generic) return { id: generic, ...items[generic] }
  const any = Object.keys(items)[0]
  return any ? { id: any, ...items[any] } : null
}

// 决策：返回 { mode: 'device'|'pack'|'none', text, lang?, voice?, src?, id? }
export function resolveVoice({ voice = 'zh', card, index = 0, manifest = null, deviceVoices = [] } = {}) {
  const kind = kindOf(card)
  if (voice !== 'nan') {
    return {
      mode: 'device',
      text: (card && card.voice) || '',
      lang: 'zh-CN',
      voice: pickDeviceVoice(deviceVoices, 'zh'),
    }
  }
  const text = nanPhrase(card, { index })
  const dv = pickDeviceVoice(deviceVoices, 'nan')
  if (dv) return { mode: 'device', text, lang: dv.lang || 'nan-TW', voice: dv }
  const item = pickAudioItem(kind, manifest, { index })
  if (item && item.file) return { mode: 'pack', src: AUDIO_BASE + item.file, id: item.id, text: item.text || text }
  return { mode: 'none', text }
}

// 读离线音频清单：缺文件/解析失败/结构不对 → 空清单（不抛，自动走降级）
export async function loadNanManifest({ fetchImpl, base = '' } = {}) {
  const empty = { items: {} }
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  if (!doFetch) return empty
  try {
    const r = await doFetch(base + AUDIO_MANIFEST)
    if (!r || !r.ok) return empty
    const data = await r.json().catch(() => null)
    if (!data || typeof data !== 'object' || !data.items || typeof data.items !== 'object') return empty
    return data
  } catch {
    return empty
  }
}