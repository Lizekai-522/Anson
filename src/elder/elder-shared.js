// 长辈端三个页面共用的纯函数（不持有状态，方便各视图复用与单测）。
import { isLegacyFamilyTitle } from '../core/store.js'

export function pad2(n) { return String(n).padStart(2, '0') }

// 本地时区 YYYY-MM-DD
export function todayStr(d = new Date()) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

export function dateLabel(d = new Date()) {
  return '今天 ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + '日一二三四五六'[d.getDay()]
}

// "2026-10-08" → "10月8日"：卡片上标日子的窄格式（整趟行程跨天时用）
export function dayText(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number)
  if (!y || !m || !d) return ''
  return m + '月' + d + '日'
}

// 卡片编号（01/02/…）：替代原来的圆形图标，纯文字更克制
export function cardNo(i) { return pad2(i + 1) }

export function cardKey(c, i) {
  return c && c.segId != null && c.segId !== '' ? String(c.segId) : 'i' + i
}

export function timeRange(c) {
  const d = (c && c.depart) || ''
  const a = (c && c.arrive) || ''
  if (d && a) return d + ' - ' + a
  return d || a || ''
}

// 卡片按钮的读屏标签：说清「这是哪一段 + 现在是展开还是收起 + 走完没有」
export function cardAria(c, i, expanded, done) {
  const verb = expanded ? '收起详情' : '展开详情'
  const state = done ? '已经走完，' : ''
  if (!c) return state + verb
  if (c.kind === 'play') {
    const head = [c.timeOfDay, c.title || c.to || '游玩安排'].filter(Boolean).join(' ')
    return head + '，' + state + verb
  }
  if (c.kind === 'stay') return (c.code ? c.code + ' ' : '') + '住宿' + (c.to ? '在' + c.to : '') + '，' + state + verb
  return (c.code ? c.code + ' ' : '') + (c.from || '') + '到' + (c.to || '') + '，' + state + verb
}

// 家人：称呼（长辈视角的）在前，姓名与号码在后；旧版子女视角的称呼一律不显示
export function contactTitle(p) {
  const rel = String((p && p.relation) || '').trim()
  if (rel && !isLegacyFamilyTitle(rel)) return rel
  return (p && p.name) || '家人'
}

export function contactSub(p) {
  const parts = []
  if (String((p && p.name) || '').trim() && contactTitle(p) !== p.name) parts.push(p.name)
  if (p && p.phone) parts.push(p.phone)
  if (p && p.im) parts.push('微信/QQ ' + p.im)
  return parts.join(' · ')
}

// 复制到剪贴板：异步 API 失败就退回 select + execCommand（长辈端在 http 环境也可能打开）
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      el.remove()
      return ok
    } catch {
      return false
    }
  }
}