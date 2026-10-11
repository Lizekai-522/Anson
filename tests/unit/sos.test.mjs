// 紧急求助纯函数：挑首选联系人 / 地图链接 / 短信正文 / tel:与sms: 深链 / 展示用脱敏。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  pickPreferredContact, hasLocation, mapLink, buildSosText,
  buildTelHref, buildSmsHref, maskPhone, contactLabel,
} from '../../src/core/sos.js'

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

const CONTACTS = [
  { name: '阿明', relation: '儿子', phone: '13800001111' },
  { name: '阿芳', relation: '女儿', phone: '13900002222' },
  { name: '只有微信', relation: '邻居', im: 'wx_123' },
]

test('pickPreferredContact：按下标取；越界/该位没电话都退回第一位有电话的', () => {
  ok(pickPreferredContact(CONTACTS, 1).name === '阿芳', '按下标取第二位')
  ok(pickPreferredContact(CONTACTS, 0).name === '阿明', '第一位')
  ok(pickPreferredContact(CONTACTS, 99).name === '阿明', '越界退第一位')
  ok(pickPreferredContact(CONTACTS, -1).name === '阿明', '负下标退第一位')
  ok(pickPreferredContact(CONTACTS, 2).name === '只有微信', '只有微信也算可联系')
  ok(pickPreferredContact([], 0) === null, '没有家人返回 null')
  ok(pickPreferredContact(null, 0) === null, 'null 安全')
  // 指定的人没有电话/微信 → 退到第一位可联系的
  const c = [{ name: '没号码' }, { name: '有号', phone: '13800000000' }]
  ok(pickPreferredContact(c, 0).name === '有号', '指定的人联系不上就退第一位')
})

test('hasLocation / mapLink：只有合法的经纬度才给链接', () => {
  ok(hasLocation(31.2304, 121.4737) === true, '合法坐标')
  ok(hasLocation(NaN, 1) === false && hasLocation(1, null) === false, '缺一个都不行')
  ok(hasLocation(91, 0) === false && hasLocation(0, 181) === false, '越界不算')
  ok(mapLink(31.2304, 121.4737).startsWith('https://www.openstreetmap.org/?mlat=31.230400&mlon=121.473700'), mapLink(31.2304, 121.4737))
  ok(mapLink('', '') === '', '没有坐标返回空串')
})

test('buildSosText：带上称呼与位置链接；拿不到位置时如实说明', () => {
  const withLoc = buildSosText({ name: '阿明', tripTitle: '去厦门', lat: 31.2304, lng: 121.4737 })
  ok(withLoc.includes('【安程】'), '带产品前缀')
  ok(withLoc.includes('阿明') && withLoc.includes('去厦门'), '带称呼与行程名')
  ok(withLoc.includes('我现在的位置：https://www.openstreetmap.org/'), '带位置链接')
  const noLoc = buildSosText({ name: '阿明', tripTitle: '', lat: null, lng: null })
  ok(!noLoc.includes('openstreetmap'), '没有位置就不写链接')
  ok(noLoc.includes('先打我电话'), '如实说明先打电话')
  ok(buildSosText({}).includes('家里的长辈'), '没名字也有兜底说法')
})

test('buildTelHref / buildSmsHref：深链形状（iOS/安卓都能吃下）', () => {
  ok(buildTelHref('13800001111') === 'tel:13800001111', buildTelHref('13800001111'))
  ok(buildTelHref('') === '' && buildTelHref(null) === '', '没号码给空串')
  const sms = buildSmsHref('13800001111', '你好 世界&测试')
  ok(sms.startsWith('sms:13800001111?&body='), sms)
  ok(sms.includes(encodeURIComponent('你好 世界&测试')), '正文已编码')
  ok(buildSmsHref('', 'x') === '', '没号码给空串')
})

test('maskPhone / contactLabel：展示用文案', () => {
  ok(maskPhone('13800001111') === '138****1111', maskPhone('13800001111'))
  ok(maskPhone('123') === '123', '太短原样返回')
  ok(contactLabel({ name: '阿明', relation: '儿子' }) === '阿明（儿子）', contactLabel({ name: '阿明', relation: '儿子' }))
  ok(contactLabel({ name: '阿明' }) === '阿明', '只有名字')
  ok(contactLabel(null) === '', 'null 安全')
})