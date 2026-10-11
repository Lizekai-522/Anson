// 分享链接 v2：紧凑载荷的长度上限 / 往返一致 / 二维码可扫性 / v1 老链接兼容。
// 这组断言存在的理由：链接长度直接决定二维码能不能扫，回归时必须挡住"又变长了"。
import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.location = { origin: 'https://example.com', pathname: '/' }

const { runPipeline, buildElderCards } = await import('../../src/core/agents.js')
const { encodeShare, decodeShare, buildShareUrl, makeShareCode, encodeTripInvite } = await import('../../src/core/share-codec.js')
const { qrInfo } = await import('../../src/core/qr.js')

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

const CONTACTS = [
  { name: '小明', phone: '13800001111', relation: '儿子', im: 'son_wechat_1', note: '住得近，有事先打给他', callsMe: '妈' },
  { name: '王医生', phone: '13900002222', relation: '社区医生', im: '', note: '', callsMe: '' },
]

function tripOf(n) {
  const raw = Array.from({ length: n }, (_, i) =>
    `2026年5月20日 早上G880${i + 1}次从上海虹桥站到北京南站 08:0${i}发车 11:0${i}到`).join('\n')
  return runPipeline(raw, { today: '2026-05-20' })
}

function payloadOf(n) {
  const trip = tripOf(n)
  return {
    v: 1,
    eid: 'eld_test',
    cid: 'card_test',
    title: trip.title,
    gen: Date.now(),
    // 线上格式是秒精度（36 进制秒），所以测试载荷也按秒取整，才能逐字段比对
    exp: Math.floor((Date.now() + 7 * 86400000) / 1000) * 1000,
    cards: buildElderCards(trip),
    contacts: CONTACTS,
    prefs: { scale: 1.12, theme: 'night', shareLocation: false },
  }
}

test('链接长度：1/2/4 段都压到可扫区间（含 2 位家人的实测基线）', () => {
  for (const [n, cap] of [[1, 460], [2, 700], [4, 1050]]) {
    const url = buildShareUrl(encodeShare(payloadOf(n)))
    ok(url.length <= cap, `${n} 段链接 ${url.length} 字符应 ≤ ${cap}`)
  }
})

test('二维码：1/2/4 段都能生成，且每格 ≥ 2.4px（这是真正的可用边界）', () => {
  for (const n of [1, 2, 4]) {
    const url = buildShareUrl(encodeShare(payloadOf(n)))
    const info = qrInfo(url, { box: 280 })
    ok(!!info, `${n} 段应能生成二维码`)
    ok(info.pxPerModule >= 2.4, `${n} 段每格 ${info.pxPerModule.toFixed(2)}px 应 ≥ 2.4px`)
    ok(info.dataUrl.startsWith('data:image/svg+xml,'), `${n} 段二维码是 SVG data URL`)
  }
})

test('往返一致：解码后的卡片/联系人/偏好与编码前逐字段相同', () => {
  for (const n of [1, 3, 5]) {
    const p = payloadOf(n)
    const res = decodeShare(encodeShare(p))
    ok(res.ok === true, `${n} 段应解码成功`)
    const fields = ['kind', 'icon', 'code', 'title', 'from', 'to', 'date', 'depart', 'arrive', 'voice', 'tips']
    const before = p.cards.map((c) => fields.map((f) => c[f]))
    const after = res.payload.cards.map((c) => fields.map((f) => c[f]))
    ok(JSON.stringify(after) === JSON.stringify(before), `${n} 段卡片应逐字段一致（含播报词与提示）`)
    ok(JSON.stringify(res.payload.contacts) === JSON.stringify(p.contacts), `${n} 段联系人一致`)
    ok(JSON.stringify(res.payload.prefs) === JSON.stringify(p.prefs), `${n} 段偏好一致`)
    ok(res.payload.exp === p.exp, `${n} 段有效期一致（秒级精度）`)
  }
})

test('紧凑载荷确实变小：键名压到最短、可推导字段不进链接', () => {
  const p = payloadOf(1)
  const token = encodeShare(p)
  const head = decodeShare(token)
  ok(head.ok === true, 'token 可解')
  const body = Buffer.from(token.slice(token.indexOf('.') + 1).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  ok(!body.includes('voice'), '链接正文里不应出现 voice 字段')
  ok(!body.includes('上海虹桥站') === false, '站名这类真实数据仍要在链接里（自包含）')
  ok(body.includes('"c":[['), '卡片是数组化的紧凑形态')
})

test('v1 老链接仍能打开（历史分享不失效）', () => {
  // 手工复刻 v1 的封装：JSON + FNV-1a 校验和 + base64url
  const fnv1a = (str) => {
    let h = 0x811c9dc5
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
    return h >>> 0
  }
  const legacy = {
    v: 1, eid: 'eld_old', cid: 'card_old', title: '老行程', gen: 1700000000000,
    exp: Date.now() + 86400000,
    cards: [{ kind: 'ride', icon: '车', code: 'G1', title: '高铁', from: 'A站', to: 'B站', date: '2026-05-20', depart: '08:00', arrive: '09:00', voice: '你坐 G1 从 A站 出发。', tips: ['带好身份证'], segId: 'seg1' }],
    contacts: [{ name: '小明', phone: '13800001111', relation: '儿子' }],
  }
  const json = JSON.stringify(legacy)
  const bin = Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const token = fnv1a(json).toString(36).padStart(7, '0') + '.' + bin
  const res = decodeShare(token)
  ok(res.ok === true, 'v1 链接应能解码')
  ok(res.payload.cards.length === 1, 'v1 卡片原样保留')
  ok(res.payload.cards[0].voice === legacy.cards[0].voice, 'v1 的播报词直接用链接里的')
})

test('坏链接：校验和不符 / 结构不对 / 空值都判 malformed', () => {
  const good = encodeShare(payloadOf(1))
  ok(decodeShare(good).ok === true, '原样能解')
  const broken = good.slice(0, good.length - 2) + (good.endsWith('AA') ? 'BB' : 'AA')
  ok(decodeShare(broken).ok === false, '改一个字符就应判坏')
  ok(decodeShare('').ok === false, '空值判坏')
  ok(decodeShare('nonsense').ok === false, '没有分隔符判坏')
  ok(decodeShare('abcd.!!!!').ok === false, '非法 base64 判坏')
})

test('过期链接：返回 expired 并带出载荷（页面可提示"让子女重发"）', () => {
  const p = payloadOf(1)
  p.exp = Date.now() - 1000
  const res = decodeShare(encodeShare(p))
  ok(res.ok === false && res.reason === 'expired', '应判过期')
  ok(!!res.payload, '过期仍带出载荷（便于页面判断）')
})

test('6 位码：同一载荷稳定、不同载荷不同', () => {
  const p = payloadOf(1)
  const a = makeShareCode(p)
  ok(/^\d{6}$/.test(a), '是 6 位数字: ' + a)
  ok(a === makeShareCode(p), '同一载荷稳定（纯函数）')
  const b = makeShareCode({ ...p, eid: 'other' })
  ok(a !== b, '换 elderId 码就变')
})

test('有效期按秒精度往返：跨设备过期判断不会差半秒', () => {
  const p = payloadOf(1)
  const res = decodeShare(encodeShare(p))
  ok(res.ok === true, '能解')
  ok(Math.abs(res.payload.exp - p.exp) < 1000, '秒级精度：误差 < 1 秒')
})

test('位置开关：f[2] 往返；旧两位链接按「不允许」处理（向后兼容）', () => {
  const on = payloadOf(1)
  on.prefs.shareLocation = true
  const rOn = decodeShare(encodeShare(on))
  ok(rOn.ok === true, '开着也能解')
  ok(rOn.payload.prefs.shareLocation === true, '开关带上了')
  ok(rOn.payload.prefs.scale === 1.12 && rOn.payload.prefs.theme === 'night', '字号主题不受影响')

  // 开关关闭时不往 f 里塞第三位（省二维码容量）
  const token = encodeShare(payloadOf(1))
  const off = decodeShare(token)
  ok(off.payload.prefs.shareLocation === false, '默认关')

  // 老链接：f 只有 [scale, theme] 两位 → 解码视为不允许
  const legacy = payloadOf(1)
  const t2 = encodeShare(legacy)
  const body = Buffer.from(t2.slice(t2.indexOf('.') + 1).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  ok(/"f":\[[^\]]*\]/.test(body), '载荷里有 f 数组')
  ok(!/"f":\[[^\]]*,[^,\]]*,/.test(body), '关闭时 f 只有两位')
})

test('往返一致：CJK + emoji + 生僻字在站点/备注里原样保留', () => {
  const p = payloadOf(1)
  const from = '上海虹桥站'
  const to = '乌鲁木齐𠮷野家站🏔️'
  const note = '到了给「老伴」打个电话☎️，别走散'
  p.cards = [{ kind: 'ride', type: 'train', icon: '车', code: 'Z99', title: '直达车', from, to, date: '2026-05-20', depart: '08:00', arrive: '11:00', arriveNextDay: false, manualConfirm: false, note, hotelNights: null, seatClass: null, voice: '', tips: [], segId: 'seg0' }]
  const res = decodeShare(encodeShare(p))
  ok(res.ok === true, '能解')
  ok(res.payload.cards[0].from === from, '出发地逐字一致: ' + res.payload.cards[0].from)
  ok(res.payload.cards[0].to === to, '到达地含生僻字与 emoji 一致: ' + res.payload.cards[0].to)
  ok(res.payload.cards[0].note === note, '备注含中文引号与 emoji 一致: ' + res.payload.cards[0].note)
})

// ---- 第六轮：家人「他对我的称呼」与 v3 邀请互不串味 ----

test('家人 callsMe：第 6 列往返；旧链接（只有 2~5 列）解出空串', () => {
  const p = payloadOf(1)
  p.contacts = [
    { name: '小明', phone: '13800001111', relation: '儿子', im: '', note: '', callsMe: '妈' },
  ]
  const res = decodeShare(encodeShare(p))
  ok(res.ok === true, '能解')
  ok(res.payload.contacts[0].callsMe === '妈', 'callsMe 带上: ' + res.payload.contacts[0].callsMe)

  // 旧链接：家人只有 2 列（姓名+手机） → callsMe 回落空串，不炸
  const legacy = payloadOf(1)
  legacy.contacts = [{ name: '小明', phone: '13800001111' }]
  const old = decodeShare(encodeShare(legacy))
  ok(old.ok === true, '旧形态也能解')
  ok(old.payload.contacts[0].callsMe === '', '缺列回落空串')
  ok(old.payload.contacts[0].name === '小明', '其余字段不受影响')
})

test('decodeShare 拒收 v3 子女邀请（两条通路互不干扰）', () => {
  const trip = tripOf(1)
  const invite = encodeTripInvite({ title: trip.title, startDate: trip.startDate, exp: Date.now() + 86400000, segments: trip.segments })
  const asElder = decodeShare(invite)
  ok(asElder.ok === false && asElder.reason === 'malformed', '长辈端把 v3 判为坏链接: ' + JSON.stringify(asElder.reason))
})

test('首选联系人 pr：下标往返；缺省/越界都回落 0', () => {
  const p = payloadOf(1)
  p.pr = 1
  const res = decodeShare(encodeShare(p))
  ok(res.ok === true, '能解')
  ok(res.payload.pr === 1, 'pr 带上: ' + res.payload.pr)

  // 第一位（pr=0）是默认值：不往链接里写，解出来仍是 0
  const first = payloadOf(1)
  first.pr = 0
  const r0 = decodeShare(encodeShare(first))
  ok(r0.payload.pr === 0, '默认首选解出 0')

  // 越界/非整数一律回落 0（不然长辈端会打错人）
  for (const bad of [9, -1, 1.5, 'x', null]) {
    const q = payloadOf(1)
    q.pr = bad
    const r = decodeShare(encodeShare(q))
    ok(r.payload.pr === 0, '坏值 ' + JSON.stringify(bad) + ' 回落 0: ' + r.payload.pr)
  }
})