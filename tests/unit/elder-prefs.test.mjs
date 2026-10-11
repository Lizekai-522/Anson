// 长辈端显示偏好：白名单校验 + 三级优先级（长辈自己调过 > 分享预设 > 默认）。
// Node 环境没有 localStorage，先装内存版再动态导入被测模块。
import test from 'node:test'
import assert from 'node:assert/strict'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
  clear: () => mem.clear(),
}

const {
  loadElderPrefs, saveElderPrefs, resolveElderPrefs, elderScaleName, elderThemeName, elderVoiceName,
  isLegacyFamilyTitle, KEYS,
  saveLastElderTrip, loadLastElderTrip, clearLastElderTrip, ELDER_VOICES,
} = await import('../../src/core/store.js')

const ok = (cond, msg) => { if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg); assert.ok(cond, msg) }

test('没设过 → null，交给分享里的预设', () => {
  localStorage.clear()
  ok(loadElderPrefs() === null, '未设置应返回 null')
})

test('保存后可读回，落盘值在白名单内', () => {
  localStorage.clear()
  const saved = saveElderPrefs({ scale: 1.25, theme: 'night' })
  ok(saved.scale === 1.25 && saved.theme === 'night', '保存值原样返回')
  const back = loadElderPrefs()
  ok(back.scale === 1.25 && back.theme === 'night', '读回一致')
})

test('脏数据被拦下：缩放/主题不在白名单 → 回到默认', () => {
  localStorage.clear()
  localStorage.setItem(KEYS.elderPrefs, JSON.stringify({ scale: 99, theme: 'hotdog' }))
  const p = loadElderPrefs()
  ok(p.scale === 1 && p.theme === 'day', '非法值回到默认: ' + JSON.stringify(p))
})

test('优先级：长辈自己调过 > 分享预设 > 默认', () => {
  localStorage.clear()
  let r = resolveElderPrefs({ scale: 1.12, theme: 'contrast' })
  ok(r.scale === 1.12 && r.theme === 'contrast' && r.source === 'share', '用分享里的预设')

  saveElderPrefs({ scale: 1, theme: 'night' })
  r = resolveElderPrefs({ scale: 1.25, theme: 'contrast' })
  ok(r.scale === 1 && r.theme === 'night' && r.source === 'local', '长辈调过就以长辈为准')

  localStorage.clear()
  r = resolveElderPrefs(null)
  ok(r.scale === 1 && r.theme === 'day' && r.source === 'default', '都没设走默认')

  r = resolveElderPrefs({ scale: 'big', theme: 123 })
  ok(r.scale === 1 && r.theme === 'day', '分享里的脏值同样被拦下')

  // 旧的 'warm'/'white' 值已不在白名单：自动回落，不会把界面搞坏
  localStorage.clear()
  localStorage.setItem(KEYS.elderPrefs, JSON.stringify({ scale: 1, theme: 'warm' }))
  ok(loadElderPrefs().theme === 'day', '旧主题值 warm → 回落 day')
})

test('名称映射：合法值给人话，非法值不炸', () => {
  ok(elderScaleName(1.25) === '超大', '1.25 → 超大')
  ok(elderScaleName(1.12) === '大', '1.12 → 大')
  ok(elderScaleName(999) === '标准', '非法 → 标准')
  ok(elderThemeName('night') === '夜间', 'night → 夜间')
  ok(elderThemeName('contrast') === '高对比', 'contrast → 高对比')
  ok(elderThemeName('day') === '日间', 'day → 日间')
  ok(elderThemeName('x') === '日间', '非法 → 日间')
})

test('旧版子女视角称呼被识别出来（长辈页不显示这些）', () => {
  for (const v of ['爸爸', '妈妈', '爷爷', '奶奶', '外公', '外婆']) {
    ok(isLegacyFamilyTitle(v) === true, v + ' 应判为旧称呼')
  }
  for (const v of ['儿子', '老伴', '社区医生', '', null, undefined, '爸爸的朋友']) {
    ok(isLegacyFamilyTitle(v) === false, String(v) + ' 不应判为旧称呼')
  }
})

// ---- 第六轮：屏幕常亮 / 播报语言 / 勾完自动读 ----

test('新开关项：默认值是「常亮开 / 普通话 / 自动读开」', () => {
  localStorage.clear()
  const p = loadElderPrefs()
  ok(p === null, '没设过仍返回 null')
  const r = resolveElderPrefs(null)
  ok(r.wake === true && r.voice === 'zh' && r.autoRead === true, '默认全开 + 普通话: ' + JSON.stringify(r))
})

test('新开关项：保存后可读回；关闭状态也能记住', () => {
  localStorage.clear()
  const saved = saveElderPrefs({ scale: 1, theme: 'day', wake: false, voice: 'nan', autoRead: false })
  ok(saved.wake === false && saved.voice === 'nan' && saved.autoRead === false, '保存值正确')
  const back = loadElderPrefs()
  ok(back.wake === false && back.voice === 'nan' && back.autoRead === false, '读回一致')
})

test('新开关项：脏值被白名单拦下（voice 不在名单就回普通话）', () => {
  localStorage.clear()
  localStorage.setItem(KEYS.elderPrefs, JSON.stringify({ voice: 'klingon', wake: 'yes', autoRead: 0 }))
  const p = loadElderPrefs()
  ok(p.voice === 'zh', '非法语言回普通话: ' + p.voice)
  ok(p.wake === true && p.autoRead === true, '非 false 一律按「开」处理（脏数据不把体验搞坏）')
  ok(ELDER_VOICES.join() === 'zh,nan', '语言只有普通话与闽南话')
  ok(elderVoiceName('nan') === '闽南话' && elderVoiceName('x') === '普通话', '语言名称映射')
})

test('新开关项：只认本机，分享预设带不动它们', () => {
  localStorage.clear()
  // 分享里塞了这几个字段也不该生效（设备能力/长辈自己的选择）
  const r = resolveElderPrefs({ scale: 1.25, theme: 'night', wake: false, voice: 'nan', autoRead: false })
  ok(r.scale === 1.25 && r.theme === 'night', '字号主题仍按分享走')
  ok(r.wake === true && r.voice === 'zh' && r.autoRead === true, '三个开关不随分享: ' + JSON.stringify(r))
})

// ---- 「记住这台手机」----

test('last：存得进读得出；非法 token 拒绝', () => {
  localStorage.clear()
  ok(loadLastElderTrip() === null, '没存过返回 null')
  const rec = saveLastElderTrip({ token: 'abc.def-ghi', title: '去厦门看阿明', startDate: '2026-10-11' })
  ok(rec && rec.token === 'abc.def-ghi', '存成功')
  const back = loadLastElderTrip()
  ok(back.token === 'abc.def-ghi' && back.title === '去厦门看阿明' && back.startDate === '2026-10-11', '读回一致')
  ok(back.savedAt > 0, '带时间戳')
})

test('last：token 形状不对一律拒绝（不写脏数据、读出来也是 null）', () => {
  localStorage.clear()
  for (const bad of ['', 'nonsense', 'no-dot', '.', 'abc.']) {
    ok(saveLastElderTrip({ token: bad }) === null, JSON.stringify(bad) + ' 不该被存下')
  }
  ok(loadLastElderTrip() === null, '本机没有合法记录')
  // 手工往 localStorage 塞脏值 → 读出来仍然是 null
  localStorage.setItem(KEYS.elderLast, JSON.stringify({ token: 'nonsense' }))
  ok(loadLastElderTrip() === null, '脏值被拦下')
  localStorage.setItem(KEYS.elderLast, JSON.stringify({ token: 'a.b', title: 123 }))
  ok(loadLastElderTrip().title === '123', '非字符串标题转成字符串（不炸）')
})

test('last：能清掉（点「换一个行程」时用）', () => {
  localStorage.clear()
  saveLastElderTrip({ token: 'x.y', title: 't', startDate: '' })
  ok(loadLastElderTrip() !== null, '先确认存上了')
  clearLastElderTrip()
  ok(loadLastElderTrip() === null, '清掉后读不到')
})