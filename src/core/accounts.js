// 账号体系：诚实是底线 —— 不发短信、不发邮件、不假装能找回密码。
// 界面必须明说：账号只存在这台设备。
// 登录失败统一显示「账号或密码不对」，不泄露"某人注册过没有"。
import { KEYS, safeGet, safeSet, safeDel, store, attachAccount, detachAccount } from './store.js'

export const ACCOUNT_HINT = '账号与行程只存在这台设备，换台设备就是另一个世界。发短信/邮件是可选的：没配服务商就用你手机上的 App 发。'

// ---- 校验规则 ----
export const rules = {
  name(v) {
    if (!v) return '请填写账号名'
    if (!/^[A-Za-z\u4e00-\u9fa5][A-Za-z0-9_\-\u4e00-\u9fa5]{1,19}$/u.test(v)) return '账号名 2-20 位，字母或汉字开头，可用字母数字下划线连字符'
    return ''
  },
  email(v) {
    if (!v) return '请填写邮箱'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return '邮箱格式不对'
    return ''
  },
  phone(v) {
    if (!v) return '请填写手机号'
    if (!/^1\d{10}$/.test(v)) return '手机号应为 1 开头的 11 位数字'
    return ''
  },
  password(v) {
    if (!v) return '请填写密码'
    if (v.length < 8) return '密码至少 8 位'
    if (/^\d+$/.test(v)) return '密码不能是纯数字'
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return '密码必须同时包含字母和数字'
    return ''
  },
}

export function validateRegister({ name, email, phone, password, confirm }) {
  const errors = {}
  errors.name = rules.name(name)
  errors.email = rules.email(email)
  errors.phone = rules.phone(phone)
  errors.password = rules.password(password)
  errors.confirm = password !== confirm ? '两次输入的密码不一致' : ''
  return { errors, ok: !errors.name && !errors.email && !errors.phone && !errors.password && !errors.confirm }
}

// ---- 密码哈希：任何情况不存明文 ----
// 安全上下文：salt + Web Crypto SHA-256（s1: 前缀）
// 非安全上下文（单文件双击打开）：降级为多轮弱哈希（w1: 前缀）
function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function weakHashMulti(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  let s = str
  for (let round = 0; round < 2048; round++) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i) ^ (round & 0xff)
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0
      h2 = (Math.imul(h2 + c + i, 2654435761) >>> 0) ^ h1
    }
    s = h1.toString(36) + '.' + h2.toString(36) + '.' + round
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

export async function hashPassword(password, salt) {
  const material = salt + '::' + password
  if (globalThis.crypto && globalThis.crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
      return 's1:' + toHex(buf)
    } catch { /* fallthrough */ }
  }
  return 'w1:' + weakHashMulti(material)
}

export function randomSalt() {
  const arr = new Uint8Array(8)
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(arr)
  else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function loadAccounts() {
  return safeGet(KEYS.accounts, [])
}

function saveAccounts(list) {
  safeSet(KEYS.accounts, list)
}

// 供「最近账号」页展示：不回传哈希
export function listAccounts() {
  return loadAccounts()
    .map(({ id, name, email, phone, lastLogin }) => ({ id, name, email, phone, lastLogin }))
    .sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0))
}

// 删掉一个本机账号：连同它的数据桶一起清掉（数据只在本地，删了就是删了）。
// 删的是当前登录账号时，会话一并退出，避免"登录着但数据桶已不存在"的半死状态。
export function removeAccount(id) {
  const accounts = loadAccounts()
  const target = accounts.find((a) => a.id === id)
  if (!target) return { ok: false, reason: 'not-found' }
  saveAccounts(accounts.filter((a) => a.id !== id))
  safeDel(KEYS.data(id))
  let loggedOut = false
  if (store.account && store.account.id === id) {
    detachAccount()
    loggedOut = true
  }
  return { ok: true, name: target.name, loggedOut }
}

export function isIdentifierTaken(identifier) {
  const v = String(identifier || '').trim().toLowerCase()
  return loadAccounts().some((a) =>
    a.name.toLowerCase() === v || a.email.toLowerCase() === v || a.phone === v
  )
}

export async function register({ name, email, phone, password, confirm }) {
  const { ok, errors } = validateRegister({ name, email, phone, password, confirm })
  if (!ok) return { ok: false, errors }

  const accounts = loadAccounts()
  const dup = accounts.find((a) =>
    a.name.toLowerCase() === name.toLowerCase() ||
    a.email.toLowerCase() === email.toLowerCase() ||
    a.phone === phone
  )
  if (dup) {
    const errors2 = {}
    if (dup.name.toLowerCase() === name.toLowerCase()) errors2.name = '这个账号名已经被用了'
    else if (dup.email.toLowerCase() === email.toLowerCase()) errors2.email = '这个邮箱已经注册过'
    else errors2.phone = '这个手机号已经注册过'
    return { ok: false, errors: errors2 }
  }

  const salt = randomSalt()
  const hash = await hashPassword(password, salt)
  const account = {
    id: 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: name.trim(),
    email: email.trim(),
    phone: phone.trim(),
    salt, hash,
    createdAt: Date.now(),
    lastLogin: Date.now(),
  }
  accounts.push(account)
  saveAccounts(accounts)
  attachAccount(account)
  safeSet(KEYS.session, { accountId: account.id, ts: Date.now() })
  return { ok: true, account: publicAccount(account) }
}

// 三种标识任一可登录：账号名 / 邮箱 / 手机号
export async function login(identifier, password) {
  const v = String(identifier || '').trim()
  if (!v || !password) return { ok: false, error: '账号或密码不对' }
  const lv = v.toLowerCase()
  const account = loadAccounts().find((a) =>
    a.name.toLowerCase() === lv || a.email.toLowerCase() === lv || a.phone === v
  )
  if (!account) return { ok: false, error: '账号或密码不对' }
  const hash = await hashPassword(password, account.salt)
  if (hash !== account.hash) return { ok: false, error: '账号或密码不对' }

  account.lastLogin = Date.now()
  const accounts = loadAccounts().map((a) => (a.id === account.id ? account : a))
  saveAccounts(accounts)
  safeSet(KEYS.session, { accountId: account.id, ts: Date.now() })
  attachAccount(account)
  return { ok: true, account: publicAccount(account) }
}

export function currentSession() {
  const s = safeGet(KEYS.session, null)
  if (!s || !s.accountId) return null
  return loadAccounts().find((a) => a.id === s.accountId) || null
}

export function logout() {
  detachAccount()
}

export function publicAccount(a) {
  return { id: a.id, name: a.name, email: a.email, phone: a.phone }
}
