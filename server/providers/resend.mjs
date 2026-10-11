// Resend 邮件（Emails API，Bearer）。
// 环境变量：RESEND_API_KEY / RESEND_FROM（如 "安程 <noreply@your.domain>"）
//   RESEND_BASE_URL（可选，联调时指向 mock）
export default {
  id: 'resend',
  configured(env) {
    return !!(env.RESEND_API_KEY && env.RESEND_FROM)
  },
  async send({ to, text, subject, env, fetchImpl = fetch }) {
    const base = env.RESEND_BASE_URL || 'https://api.resend.com'
    const r = await fetchImpl(base + '/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.RESEND_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [String(to || '')],
        subject: subject || '安程：家人行程已经排好',
        text: String(text || ''),
      }),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) return { ok: false, reason: (data && (data.message || data.name)) || 'HTTP ' + r.status }
    return { ok: true, detail: (data && data.id) || '' }
  },
}