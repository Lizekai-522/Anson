// 闽南话播报：模板句拼装 / 音频清单加载 / 设备声音挑选 / 三级决策（pack → device → none）。
// 音频包本身是可选的：清单为空时必须自动降级，不能把播报功能整体拖死。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  kindOf, nanPhrase, pickDeviceVoice, pickAudioItem, resolveVoice,
  loadNanManifest, AUDIO_BASE, AUDIO_PER_KIND,
} from '../../src/core/elderVoice.js'

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}
const itemCount = (m) => Object.keys((m && m.items) || {}).length
const HERE = path.dirname(fileURLToPath(import.meta.url))
const AUDIO_DIR = path.join(HERE, '..', '..', 'public', 'audio', 'nan')

test('kindOf：卡片类型映射到语音包类别', () => {
  ok(kindOf({ type: 'train' }) === 'train', 'train')
  ok(kindOf({ type: 'flight' }) === 'flight', 'flight')
  ok(kindOf({ type: 'taxi' }) === 'taxi', 'taxi')
  ok(kindOf({ type: 'hotel', kind: 'stay' }) === 'hotel', 'hotel/stay')
  ok(kindOf({ type: 'activity', kind: 'play' }) === 'activity', 'activity/play')
  ok(kindOf({ type: 'unknown' }) === 'generic', '未知类型退 generic')
  ok(kindOf(null) === 'generic', 'null 安全')
})

test('nanPhrase：带上段号、站点、时刻；缺字段用兜底说法', () => {
  const p = nanPhrase({ type: 'train', from: '城东站', to: '城西站', depart: '09:35' }, { index: 1 })
  ok(p.startsWith('第 2 段：'), '段号: ' + p)
  ok(p.includes('城东站') && p.includes('城西站'), '站点: ' + p)
  ok(p.includes('9 点 35 分'), '时刻口语化: ' + p)

  const bare = nanPhrase({ type: 'train' })
  ok(bare.includes('坐车') && bare.includes('目的地'), '缺站点给兜底: ' + bare)
  ok(nanPhrase({ type: 'hotel' }).includes('旅社'), '住宿兜底')
  ok(nanPhrase({ type: 'activity', timeOfDay: '下午', to: '公园' }).includes('下午'), '游玩带时段')
  ok(nanPhrase(null).length > 0, 'null 也不炸')
})

test('pickDeviceVoice：nan 优先台语/闽南语，再退 zh-TW；zh 找普通话', () => {
  const voices = [
    { name: 'Chinese', lang: 'zh-CN' },
    { name: 'Taiwan', lang: 'zh-TW' },
  ]
  ok(pickDeviceVoice(voices, 'nan').lang === 'zh-TW', 'nan 优先 zh-TW')
  ok(pickDeviceVoice(voices, 'zh').lang === 'zh-CN', 'zh 用 zh-CN')
  const nanVoice = [{ name: 'Min Nan', lang: 'nan-TW' }, { name: 'Taiwan', lang: 'zh-TW' }]
  ok(pickDeviceVoice(nanVoice, 'nan').lang === 'nan-TW', '有 nan 声音时优先它')
  ok(pickDeviceVoice([], 'nan') === null, '没有可用声音返回 null')
  ok(pickDeviceVoice(null, 'zh') === null, 'null 安全')
})

test('pickAudioItem：同类轮换 → 同 kind 任意 → generic → 任意；空清单返回 null', () => {
  const manifest = { items: {
    nan_train_1: { file: 'nan_train_1.mp3', text: 'a' },
    nan_train_2: { file: 'nan_train_2.mp3', text: 'b' },
    nan_generic_1: { file: 'nan_generic_1.mp3', text: 'g' },
    nan_taxi_1: { file: 'nan_taxi_1.mp3', text: 't' },
  } }
  ok(pickAudioItem('train', manifest, { index: 0 }).id === 'nan_train_1', '第一句')
  ok(pickAudioItem('train', manifest, { index: 1 }).id === 'nan_train_2', '第二句轮换')
  // index 超出同类句数 → 回落到同 kind 的第一条（同类优先于 generic）
  ok(pickAudioItem('train', manifest, { index: 4 }).id === 'nan_train_1', '同类回落: ' + pickAudioItem('train', manifest, { index: 4 }).id)
  // 该 kind 一条都没有 → generic
  ok(pickAudioItem('hotel', manifest, {}).id === 'nan_generic_1', '退 generic')
  ok(pickAudioItem('hotel', { items: { nan_taxi_1: { file: 'x.mp3' } } }, {}).id === 'nan_taxi_1', '再退任意一条')
  ok(pickAudioItem('train', { items: {} }, {}) === null, '空清单 null')
  ok(pickAudioItem('train', null, {}) === null, 'null 清单安全')
  ok(AUDIO_PER_KIND === 5, '每类 5 句（与模板一致）')
})

test('resolveVoice：普通话走设备；闽南话优先设备台语声音，其次音频包，最后如实说没有', () => {
  const card = { type: 'train', from: 'A站', to: 'B站', depart: '08:00', voice: '你坐 G1 出发' }

  const zh = resolveVoice({ voice: 'zh', card, deviceVoices: [{ name: 'C', lang: 'zh-CN' }] })
  ok(zh.mode === 'device' && zh.lang === 'zh-CN', '普通话走设备 TTS')
  ok(zh.text === '你坐 G1 出发', '普通话用卡片自带的播报词')

  const nanDevice = resolveVoice({ voice: 'nan', card, deviceVoices: [{ name: 'M', lang: 'nan-TW' }] })
  ok(nanDevice.mode === 'device' && nanDevice.lang === 'nan-TW', '有台语声音就用设备念')
  ok(nanDevice.text.includes('第 1 段') && nanDevice.text.includes('A站'), '念的是动态完整句: ' + nanDevice.text)

  const manifest = { items: { nan_train_1: { file: 'nan_train_1.mp3', text: '今仔日坐车' } } }
  const nanPack = resolveVoice({ voice: 'nan', card, deviceVoices: [{ name: 'C', lang: 'zh-CN' }], manifest })
  ok(nanPack.mode === 'pack', '没有台语声音但有音频包 → 播音频')
  ok(nanPack.src === AUDIO_BASE + 'nan_train_1.mp3', 'src: ' + nanPack.src)

  const none = resolveVoice({ voice: 'nan', card, deviceVoices: [], manifest: { items: {} } })
  ok(none.mode === 'none', '两样都没有 → none（页面会如实提示）')
})

test('loadNanManifest：缺文件/坏 JSON/结构不对都回落空清单，不抛', async () => {
  const empty = async (impl) => itemCount(await loadNanManifest({ fetchImpl: impl })) === 0
  ok(await empty(async () => ({ ok: false })), '404 → 空清单')
  ok(await empty(async () => { throw new Error('offline') }), '网络失败 → 空清单')
  ok(await empty(async () => ({ ok: true, json: async () => { throw new Error('bad') } })), '坏 JSON → 空清单')
  ok(await empty(async () => ({ ok: true, json: async () => ({ version: 1 }) })), '没有 items → 空清单')
  const m = await loadNanManifest({
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: { a: { file: 'a.mp3' } } }) }),
  })
  ok(itemCount(m) === 1, '正常清单可读')
  ok(!!(await loadNanManifest({})).items, '没有 fetch 也返回空清单结构')
})

test('音频包若已生成：总体积 < 300KB（超了就该重跑脚本）', () => {
  if (!fs.existsSync(AUDIO_DIR)) return
  const mp3s = fs.readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.mp3'))
  if (!mp3s.length) return // 走降级链，不算失败
  const total = mp3s.reduce((n, f) => n + fs.statSync(path.join(AUDIO_DIR, f)).size, 0)
  ok(total < 300 * 1024, '音频总体积 ' + total + ' 字节应 < 300KB')
  // 清单里的每一项都必须真的有文件
  const manifest = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, 'manifest.json'), 'utf8'))
  for (const [id, it] of Object.entries(manifest.items || {})) {
    ok(fs.existsSync(path.join(AUDIO_DIR, it.file)), id + ' 对应的文件存在')
  }
})