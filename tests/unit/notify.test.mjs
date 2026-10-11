// 短信/邮件双通道：深链构造、正文组装、通道探测、回落判定、阿里云签名向量。
// 这里断言的都是"真能送到"的路径：要么服务端真发，要么调起本机 App。
import test from 'node:test'
import assert from 'node:assert/strict'

const { buildSmsHref, buildMailtoHref, notifyText, mailSubject, probeChannel, sendViaServer, deliver } =
  await import('../../src/core/notify.js')
const { default: aliyun, buildAliyunQuery } = await import('../../server/providers/aliyun.mjs')
const twilio = (await import('../../server/providers/twilio.mjs')).default
const resend = (await import('../../server/providers/resend.mjs')).default
const webhook = (await import('../../server/providers/webhook.mjs')).default
const { activeProviders } = await import('../../server/app.mjs')

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

const SAMPLE = {
  link: 'https://an.example/#/e/abc.def',
  code6: '839201',
  name: '小明',
  tripTitle: '五一出游',
}

function stubFetch(impl) {
  const prev = globalThis.fetch
  globalThis.fetch = impl
  return () => { globalThis.fetch = prev }
}

test('短信深链：中文、换行、链接都正确编码', () => {
  const text = notifyText(SAMPLE)
  const href = buildSmsHref({ phone: '13800001111', text })
  ok(href.startsWith('sms:13800001111?&body='), '形如 sms:<号>?&body=…: ' + href.slice(0, 40))
  const body = decodeURIComponent(href.split('body=')[1])
  ok(body === text, '解码回来与正文完全一致')
  ok(body.includes(SAMPLE.link), '正文带链接')
  ok(body.includes('839201'), '正文带 6 位码')
  ok(body.includes('\n'), '正文有换行（短信里分行更好读）')
  ok(href.includes('%0A'), '换行已编码，不会把 URI 截断')
})

test('邮件深链：收件人 / 主题 / 正文都编码', () => {
  const href = buildMailtoHref({ to: 'son@example.com', subject: mailSubject('五一出游'), text: notifyText(SAMPLE) })
  ok(href.startsWith('mailto:son%40example.com?'), '形如 mailto:<收件人>?…: ' + href.slice(0, 30))
  ok(href.includes('subject='), '带主题')
  ok(href.includes('body='), '带正文')
  const subject = decodeURIComponent(href.match(/subject=([^&]*)/)[1])
  ok(subject.includes('五一出游'), '主题里有行程名: ' + subject)
})

test('正文首行是「安程」+ 谁的行程，长辈一眼知道是谁发的', () => {
  const text = notifyText(SAMPLE)
  ok(text.startsWith('【安程】'), '带产品名：' + text.split('\n')[0])
  ok(text.includes('小明的行程'), '带子女账号名')
  ok(text.includes('五一出游'), '带行程名')
  ok(!notifyText({ ...SAMPLE, code6: '' }).includes('6 位码'), '没码时不提 6 位码')
})

test('服务端通道探测：未配置 / 网络错误 / 非 2xx 都返回 null（= 回落本机）', async () => {
  let restore = stubFetch(async () => ({ ok: true, json: async () => ({ sms: null, email: null }) }))
  ok((await probeChannel('sms')) === null, '服务端没配 → null')
  restore()

  restore = stubFetch(async () => { throw new Error('ECONNREFUSED') })
  ok((await probeChannel('sms')) === null, '连不上 → null')
  restore()

  restore = stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }))
  ok((await probeChannel('sms')) === null, '500 → null')
  restore()

  restore = stubFetch(async () => ({ ok: true, json: async () => ({ sms: 'aliyun', email: 'resend' }) }))
  ok((await probeChannel('sms')) === 'aliyun', '配了 aliyun 就返回 aliyun')
  ok((await probeChannel('email')) === 'resend', '配了 resend 就返回 resend')
  restore()
})

test('服务端发送：失败与异常都不抛，只回 ok:false（由上层决定回落）', async () => {
  let restore = stubFetch(async () => ({ ok: true, json: async () => ({ ok: true, via: 'aliyun' }) }))
  let out = await sendViaServer({ channel: 'sms', to: '13800001111', text: 'x' })
  ok(out.ok === true && out.via === 'aliyun', '成功走服务端')
  restore()

  restore = stubFetch(async () => ({ ok: false, status: 502, json: async () => ({ ok: false, reason: 'quota' }) }))
  out = await sendViaServer({ channel: 'sms', to: '13800001111', text: 'x' })
  ok(out.ok === false && out.reason === 'quota', '服务商报错要把原因带回来')
  restore()

  restore = stubFetch(async () => { throw new Error('boom') })
  out = await sendViaServer({ channel: 'sms', to: '13800001111', text: 'x' })
  ok(out.ok === false && out.reason === 'network', '网络异常归为 network')
  restore()
})

test('deliver：能走服务端就走服务端，不能就走本机并交回深链', async () => {
  const restore = stubFetch(async (url, opts) => {
    if (String(url).includes('/api/notify/config')) {
      return { ok: true, json: async () => ({ sms: 'twilio', email: 'resend' }) }
    }
    return { ok: true, json: async () => ({ ok: true, via: 'twilio' }) }
  })
  const viaServer = await deliver({ channel: 'sms', to: '13800001111', ...SAMPLE })
  ok(viaServer.via === 'server' && viaServer.provider === 'twilio', '配了就真走服务端')
  ok(viaServer.href === '', '走服务端时不需要深链')
  restore()

  const restore2 = stubFetch(async () => { throw new Error('offline') })
  const viaDevice = await deliver({ channel: 'email', to: 'son@example.com', ...SAMPLE })
  ok(viaDevice.via === 'device', '服务端不可用 → 回落本机')
  ok(viaDevice.href.startsWith('mailto:'), '交回一个可点的邮件深链')
  restore2()
})

test('服务端 provider 选择：缺任一变量都不算配置，专用服务商优先于通用网关', () => {
  ok(aliyun.configured({}) === false, '阿里云缺配置 → 未配置')
  ok(aliyun.configured({ ALIYUN_SMS_AK_ID: 'a', ALIYUN_SMS_AK_SECRET: 'b', ALIYUN_SMS_SIGN: 's' }) === false, '缺模板 → 未配置')
  ok(aliyun.configured({ ALIYUN_SMS_AK_ID: 'a', ALIYUN_SMS_AK_SECRET: 'b', ALIYUN_SMS_SIGN: 's', ALIYUN_SMS_TEMPLATE: 't' }) === true, '齐全 → 已配置')
  ok(twilio.configured({ TWILIO_ACCOUNT_SID: 'a', TWILIO_AUTH_TOKEN: 'b' }) === false, 'Twilio 缺 From → 未配置')
  ok(resend.configured({ RESEND_API_KEY: 'k' }) === false, 'Resend 缺 From → 未配置')
  ok(webhook.configured({ NOTIFY_WEBHOOK_URL: 'https://x' }) === true, '网关只要 URL')

  ok(activeProviders({}).sms === null, '什么都没配 → sms 为 null')
  const both = activeProviders({ ALIYUN_SMS_AK_ID: 'a', ALIYUN_SMS_AK_SECRET: 'b', ALIYUN_SMS_SIGN: 's', ALIYUN_SMS_TEMPLATE: 't', NOTIFY_WEBHOOK_URL: 'https://x' })
  ok(both.sms.id === 'aliyun', '有专用服务商时优先用它')
  const onlyHook = activeProviders({ NOTIFY_WEBHOOK_URL: 'https://x' })
  ok(onlyHook.sms.id === 'webhook' && onlyHook.email.id === 'webhook', '只有网关时短信邮件都走网关')
})

test('阿里云请求：固定 nonce/时间戳 → 签名确定，且任何参数变化都会改签名', () => {
  const env = {
    ALIYUN_SMS_AK_ID: 'ak', ALIYUN_SMS_AK_SECRET: 'sk',
    ALIYUN_SMS_SIGN: '安程', ALIYUN_SMS_TEMPLATE: 'SMS_1',
  }
  const a = buildAliyunQuery({ phone: '13800001111', text: notifyText(SAMPLE), env, nonce: 'n1', timestamp: '2026-05-20T00:00:00Z' })
  const b = buildAliyunQuery({ phone: '13800001111', text: notifyText(SAMPLE), env, nonce: 'n1', timestamp: '2026-05-20T00:00:00Z' })
  ok(a.Signature === b.Signature, '同输入签名稳定')
  ok(a.Action === 'SendSms' && a.PhoneNumbers === '13800001111', '动作与收件人正确')
  ok(a.TemplateParam.includes(SAMPLE.link), '模板参数里带链接')
  ok(a.TemplateParam.includes('839201'), '模板参数里带 6 位码')
  const c = buildAliyunQuery({ phone: '13900002222', text: notifyText(SAMPLE), env, nonce: 'n1', timestamp: '2026-05-20T00:00:00Z' })
  ok(a.Signature !== c.Signature, '换号码签名就变（说明签名覆盖了参数）')
})