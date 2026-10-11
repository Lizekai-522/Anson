// 紧急求助（SOS）：只做「纯函数拼装」——挑首选联系人、地图链接、短信正文、sms:/tel: 深链。
// 为什么是纯函数：长辈端要零依赖可用，浏览器又发不出短信/电话，
// 所以这里只负责把「该拨给谁、正文写什么」算准，真正拨号/发短信交给系统 App。
//
// 隐私：地图链接只用经纬度，不带轨迹、不带任何身份信息。

// 首选联系人：优先用分享里指定的下标（pr），该位没有电话就退回第一位有电话的家人
export function pickPreferredContact(contacts, pr) {
  const list = (contacts || []).filter(Boolean)
  if (!list.length) return null
  const i = Number(pr)
  const at = Number.isInteger(i) && i >= 0 && i < list.length ? list[i] : null
  if (at && (at.phone || at.im)) return at
  return list.find((c) => c && (c.phone || c.im)) || null
}

// 经纬度是否可用（经纬度缺一不可，且要在合理范围内）
// 注意：null / 空串 是「没拿到位置」，不是 0（赤道/本初子午线），必须当无效
export function hasLocation(lat, lng) {
  const n = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v))
  const la = n(lat)
  const ln = n(lng)
  return Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180
}

// 位置链接（OpenStreetMap）：长辈的短信里带上它，家人点开就知道人在哪
export function mapLink(lat, lng) {
  if (!hasLocation(lat, lng)) return ''
  const la = Number(lat).toFixed(6)
  const ln = Number(lng).toFixed(6)
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${ln}#map=16/${la}/${ln}`
}

// 求助短信正文：短、直给、带上位置链接（没有定位时如实不写链接）
export function buildSosText({ name, tripTitle, lat, lng } = {}) {
  const who = name ? `我是${name}` : '我是家里的长辈'
  const trip = tripTitle ? `（${tripTitle}）` : ''
  const link = mapLink(lat, lng)
  const lines = [`【安程】${who}${trip}，我遇到困难，需要帮忙。`]
  if (link) lines.push('我现在的位置：' + link)
  else lines.push('手机暂时拿不到位置，请先打我电话。')
  return lines.join('\n')
}

export function buildTelHref(phone) {
  const p = String(phone || '').trim()
  return p ? 'tel:' + p : ''
}

// iOS 与 Android 对 sms: 的分隔符支持不一致，`?&body=` 两边都能吃下
export function buildSmsHref(phone, text) {
  const p = String(phone || '').trim()
  if (!p) return ''
  return 'sms:' + encodeURIComponent(p) + '?&body=' + encodeURIComponent(String(text || ''))
}

// 展示用：139****8821（只遮中间，家人自己认得出）
export function maskPhone(phone) {
  const p = String(phone || '').trim()
  if (p.length < 7) return p
  return p.slice(0, 3) + '****' + p.slice(-4)
}

// 首选联系人的一句话称呼：阿明（儿子）
export function contactLabel(c) {
  if (!c) return ''
  const name = String(c.name || '').trim()
  const rel = String(c.relation || '').trim()
  if (name && rel) return `${name}（${rel}）`
  return name || rel || '家人'
}