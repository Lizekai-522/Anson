// 通用 HTTP 网关：把 { channel, to, text, subject } 原样 POST 给你的网关/自建服务。
// 自建短信通道、企业微信/钉钉中转、邮件 SMTP 网关都能接这一条。
// 环境变量：NOTIFY_WEBHOOK_URL（必填）、NOTIFY_WEBHOOK_TOKEN（可选，作为 Bearer 发出）
export default {
  id: 'webhook',
  configured(env) {
    return !!env.NOTIFY_WEBHOOK_URL
  },
  async send({ to, text, subject, channel, env, fetchImpl = fetch }) {
    const headers = { 'content-type': 'application/json' }
    if (env.NOTIFY_WEBHOOK_TOKEN) headers.authorization = 'Bearer ' + env.NOTIFY_WEBHOOK_TOKEN
    const r = await fetchImpl(env.NOTIFY_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ channel, to: String(to || ''), subject: subject || '', text: String(text || '') }),
    })
    if (!r.ok) return { ok: false, reason: 'HTTP ' + r.status }
    const data = await r.json().catch(() => null)
    return { ok: true, detail: (data && data.id) || '' }
  },
}