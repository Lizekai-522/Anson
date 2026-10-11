// Twilio 短信（Messages API，HTTP Basic）。
// 环境变量：TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM
//   TWILIO_BASE_URL（可选，联调时指向 mock）
export default {
  id: 'twilio',
  configured(env) {
    return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM)
  },
  async send({ to, text, env, fetchImpl = fetch }) {
    const base = env.TWILIO_BASE_URL || 'https://api.twilio.com'
    const url = base + '/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Messages.json'
    const body = new URLSearchParams({ To: String(to || ''), From: env.TWILIO_FROM, Body: String(text || '') })
    const auth = Buffer.from(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN).toString('base64')
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + auth,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) return { ok: false, reason: (data && data.message) || 'HTTP ' + r.status }
    return { ok: true, detail: (data && data.sid) || '' }
  },
}