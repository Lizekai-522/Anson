// 阿里云短信（Dysmsapi SendSms，RPC 风格签名）。
// 只做一件事：把 { 手机号, 正文 } 变成一个签名正确的请求。请求构造是纯函数，可单测。
// 需要的环境变量（少一个就当没配置，前端自动回落本机短信）：
//   ALIYUN_SMS_AK_ID / ALIYUN_SMS_AK_SECRET / ALIYUN_SMS_SIGN / ALIYUN_SMS_TEMPLATE
//   ALIYUN_SMS_BASE_URL（可选，联调时指向 mock）
import crypto from 'node:crypto'

function percentEncode(s) {
  return encodeURIComponent(String(s)).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')
}

// 阿里云 RPC 签名：参数按字典序拼接 → StringToSign → HMAC-SHA1(secret + '&')
export function aliyunSignature(params, secret) {
  const canonical = Object.keys(params).sort()
    .map((k) => percentEncode(k) + '=' + percentEncode(params[k]))
    .join('&')
  const stringToSign = 'GET&%2F&' + percentEncode(canonical)
  return crypto.createHmac('sha1', secret + '&').update(stringToSign).digest('base64')
}

// 正文里的链接与 6 位码单独摘出来，方便短信模板里用 ${link} / ${code}
export function extractParts(text) {
  const link = (String(text || '').match(/https?:\/\/\S+/) || [''])[0]
  const code = (String(text || '').match(/(?:^|\D)(\d{6})(?:\D|$)/) || ['', ''])[1]
  return { link, code, text: String(text || '') }
}

// 纯函数：固定 nonce/timestamp 就得到确定的请求（签名可写成固定向量断言）。
// 默认值在调用时生成 —— 阿里云会拒绝重复的 SignatureNonce 和过期时间戳，写死会直接失败。
export function buildAliyunQuery({ phone, text, env, nonce = null, timestamp = null }) {
  const parts = extractParts(text)
  const params = {
    AccessKeyId: env.ALIYUN_SMS_AK_ID,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: String(phone || ''),
    RegionId: env.ALIYUN_SMS_REGION || 'cn-hangzhou',
    SignName: env.ALIYUN_SMS_SIGN,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: nonce || crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: env.ALIYUN_SMS_TEMPLATE,
    TemplateParam: JSON.stringify({ link: parts.link, code: parts.code, text: parts.text }),
    // 阿里云要的是「秒级 UTC、不带毫秒」的 ISO 时间
    Timestamp: timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  }
  params.Signature = aliyunSignature(params, env.ALIYUN_SMS_AK_SECRET)
  return params
}

export default {
  id: 'aliyun',
  configured(env) {
    return !!(env.ALIYUN_SMS_AK_ID && env.ALIYUN_SMS_AK_SECRET && env.ALIYUN_SMS_SIGN && env.ALIYUN_SMS_TEMPLATE)
  },
  async send({ to, text, env, fetchImpl = fetch }) {
    const params = buildAliyunQuery({ phone: to, text, env })
    const base = env.ALIYUN_SMS_BASE_URL || 'https://dysmsapi.aliyuncs.com'
    const url = base + '/?' + new URLSearchParams(params).toString()
    const r = await fetchImpl(url, { method: 'GET' })
    const data = await r.json().catch(() => null)
    if (!r.ok || !data || data.Code !== 'OK') {
      return { ok: false, reason: (data && (data.Message || data.Code)) || 'HTTP ' + r.status }
    }
    return { ok: true, detail: data.RequestId || '' }
  },
}