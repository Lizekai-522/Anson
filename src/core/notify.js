// 短信 / 邮件双通道。浏览器自己发不了短信和邮件，这里不假装能发 —— 两条通道都是真能送到的路径：
//
// 通道一（零配置，永远可用）：sms: / mailto: 深链。调起用户自己手机上的短信 / 邮件 App，
//   正文里已经写好了链接和 6 位码，用户按一下发送即可。
// 通道二（配了才用）：POST 到可选的 notify 服务（server/notify-server.mjs），由服务端调
//   真实服务商（阿里云 / Twilio / Resend / 自建 webhook）直接送达。
//
// 判定与回落：探测服务端 /api/notify/config；没配 provider、请求失败或超过 3 秒，
// 一律回落到通道一，并把"实际走了哪条路"如实回报给页面展示。密钥只在服务端，前端零密钥。

const TIMEOUT_MS = 3000

export const KIND_SMS = 'sms'
export const KIND_EMAIL = 'email'

export function mailSubject(tripTitle) {
  return '安程：' + (tripTitle || '家人行程') + ' 已经排好'
}

// 短信与邮件共用同一份正文：短、直给、带上链接与 6 位码
export function notifyText({ link, code6, name, tripTitle }) {
  const who = name ? name + '的行程' : '行程'
  const tail = tripTitle ? '（' + tripTitle + '）' : ''
  const lines = ['【安程】' + who + tail + '已经排好了，点开就能看：', link || '']
  if (code6) lines.push('打不开就打开「安程」，输 6 位码：' + code6)
  return lines.join('\n')
}

export function buildSmsHref({ phone, text }) {
  // iOS 与 Android 对 sms: 的分隔符支持不一致，`?&body=` 两边都能吃下
  return 'sms:' + encodeURIComponent(phone || '') + '?&body=' + encodeURIComponent(text || '')
}

export function buildMailtoHref({ to, subject, text }) {
  const q = []
  if (subject) q.push('subject=' + encodeURIComponent(subject))
  if (text) q.push('body=' + encodeURIComponent(text))
  return 'mailto:' + encodeURIComponent(to || '') + (q.length ? '?' + q.join('&') : '')
}

// 服务端配了哪种 provider？没配返回 null（= 走通道一）
export async function probeChannel(kind, { base = '' } = {}) {
  try {
    const r = await fetch(base + '/api/notify/config', { cache: 'no-store', headers: { accept: 'application/json' } })
    if (!r.ok) return null
    const cfg = await r.json()
    const via = kind === KIND_SMS ? cfg && cfg.sms : cfg && cfg.email
    return via || null
  } catch {
    return null
  }
}

// 交给服务端发送。任何异常都返回 ok:false，由上层决定回落，不抛。
export async function sendViaServer({ channel, to, text, subject, base = '' }) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(base + '/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, to, text, subject }),
      signal: ctl.signal,
    })
    const data = await r.json().catch(() => null)
    if (!r.ok || !data || !data.ok) {
      return { ok: false, reason: (data && data.reason) || 'HTTP ' + r.status }
    }
    return { ok: true, via: data.via || 'server' }
  } catch (e) {
    return { ok: false, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

// 页面用的统一入口：能走服务端就走服务端，否则回落深链。
// 返回 { via:'server'|'device', ok, provider?, fallbackReason?, href }
export async function deliver({ channel, to, link, code6, name, tripTitle, base = '' }) {
  const text = notifyText({ link, code6, name, tripTitle })
  const href = channel === KIND_SMS
    ? buildSmsHref({ phone: to, text })
    : buildMailtoHref({ to, subject: mailSubject(tripTitle), text })

  const provider = await probeChannel(channel, { base })
  if (!provider) return { via: 'device', ok: true, href }

  const res = await sendViaServer({
    channel, to, text,
    subject: channel === KIND_EMAIL ? mailSubject(tripTitle) : '',
    base,
  })
  if (res.ok) return { via: 'server', ok: true, provider: res.via, href: '' }
  return { via: 'device', ok: true, href, fallbackReason: res.reason }
}