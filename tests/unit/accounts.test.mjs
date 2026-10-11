// 账号体系单测：校验规则 / 注册登录 / 统一错误文案不泄露账号存在性 / 删除账号。
// Node 环境没有 localStorage，先装一个内存版，再动态导入被测模块。
import test from 'node:test'
import assert from 'node:assert/strict'

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: (k) => { mem.delete(k) },
  clear: () => mem.clear(),
}

const { register, login, listAccounts, removeAccount, logout, validateRegister, ACCOUNT_HINT } =
  await import('../../src/core/accounts.js')
const { KEYS, store, persist } = await import('../../src/core/store.js')

const ok = (cond, msg) => { if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg); assert.ok(cond, msg) }

let seq = 0
async function makeAccount() {
  const u = 'u' + Date.now().toString(36) + (seq++)
  const password = 'Passw0rd1'
  const res = await register({
    name: u,
    email: u + '@test.local',
    phone: '1' + String(Date.now() + seq * 137).slice(-10),
    password,
    confirm: password,
  })
  ok(res.ok === true, '注册应成功: ' + JSON.stringify(res.errors))
  return { name: u, password, account: res.account }
}

test('validateRegister：五个字段逐条拦截，合法表单放行', () => {
  const bad = validateRegister({ name: '', email: '', phone: '', password: '', confirm: '' })
  ok(bad.ok === false, '空表单不通过')
  for (const k of ['name', 'email', 'phone', 'password']) {
    ok(typeof bad.errors[k] === 'string' && bad.errors[k].length > 0, k + ' 应有错误提示')
  }
  const mism = validateRegister({ name: 'ab', email: 'a@b.com', phone: '13800000000', password: 'Passw0rd1', confirm: 'Passw0rd2' })
  ok(mism.ok === false, '两次密码不一致不通过')
  const noDigit = validateRegister({ name: 'ab', email: 'a@b.com', phone: '13800000000', password: 'abcdefgh', confirm: 'abcdefgh' })
  ok(noDigit.ok === false, '纯字母密码不通过')
  const good = validateRegister({ name: 'abc', email: 'a@b.com', phone: '13800000000', password: 'Passw0rd1', confirm: 'Passw0rd1' })
  ok(good.ok === true, '合法表单通过: ' + JSON.stringify(good.errors))
})

test('注册后可出现在账号列表，且不回传哈希/盐', async () => {
  const a = await makeAccount()
  const found = listAccounts().find((x) => x.id === a.account.id)
  ok(!!found, '列表中有新账号')
  ok(found.hash === undefined && found.salt === undefined, '不回传哈希/盐')
  ok(found.name === a.name && !!found.email, '基础字段完整')
})

test('落盘不含明文密码', async () => {
  await makeAccount()
  const raw = localStorage.getItem(KEYS.accounts)
  ok(!raw.includes('Passw0rd1'), '账号列表里没有明文密码')
})

test('账号名 / 邮箱 / 手机号 三种标识都能登录', async () => {
  const a = await makeAccount()
  for (const ident of [a.account.name, a.account.email, a.account.phone]) {
    logout()
    const r = await login(ident, a.password)
    ok(r.ok === true, '用「' + ident + '」登录应成功')
    ok(r.account.id === a.account.id, '登录到同一账号')
  }
})

test('登录失败：不区分「账号不存在」与「密码不对」', async () => {
  const a = await makeAccount()
  const noSuch = await login('nobody_' + Date.now().toString(36), 'Whatever1')
  const wrongPw = await login(a.name, 'WrongPass1')
  ok(noSuch.ok === false && wrongPw.ok === false, '两种都失败')
  ok(noSuch.error === wrongPw.error, '文案完全一致，不泄露账号是否存在: ' + noSuch.error)
  ok(noSuch.error === '账号或密码不对', '统一文案')
})

test('重复注册：账号名 / 邮箱 / 手机号分别被拦下', async () => {
  const a = await makeAccount()
  const dupName = await register({ name: a.account.name, email: 'x' + Date.now() + '@t.local', phone: '1' + String(Date.now()).slice(-10), password: a.password, confirm: a.password })
  ok(dupName.ok === false && !!dupName.errors.name, '账号名重复被拦')
  const dupMail = await register({ name: 'n' + Date.now().toString(36), email: a.account.email, phone: '1' + String(Date.now() + 7).slice(-10), password: a.password, confirm: a.password })
  ok(dupMail.ok === false && !!dupMail.errors.email, '邮箱重复被拦')
  const dupPhone = await register({ name: 'p' + Date.now().toString(36), email: 'p' + Date.now() + '@t.local', phone: a.account.phone, password: a.password, confirm: a.password })
  ok(dupPhone.ok === false && !!dupPhone.errors.phone, '手机号重复被拦')
})

test('removeAccount：删列表 + 清数据桶 + 当前会话一并退出', async () => {
  const a = await makeAccount()
  store.data.trips.push({ id: 't1', title: '临时行程', segments: [] })
  persist()
  ok(localStorage.getItem(KEYS.data(a.account.id)) !== null, '数据桶已落盘')

  const res = removeAccount(a.account.id)
  ok(res.ok === true && res.loggedOut === true, '删除成功且退出登录')
  ok(!listAccounts().some((x) => x.id === a.account.id), '账号列表里没了')
  ok(localStorage.getItem(KEYS.data(a.account.id)) === null, '数据桶已清')
  ok(localStorage.getItem(KEYS.session) === null, '会话已清')
  ok(store.account === null, '内存登录态已清')
})

test('removeAccount：删别的账号，不影响当前登录', async () => {
  const a = await makeAccount()
  const b = await makeAccount() // b 是当前登录
  const res = removeAccount(a.account.id)
  ok(res.ok === true && res.loggedOut === false, '未把自己踢下线')
  ok(store.account && store.account.id === b.account.id, '当前账号仍是 b')
})

test('removeAccount：不存在的 id → not-found，不动任何数据', async () => {
  const a = await makeAccount()
  const res = removeAccount('acc_not_exist')
  ok(res.ok === false && res.reason === 'not-found', '返回 not-found')
  ok(listAccounts().some((x) => x.id === a.account.id), '其他账号不受影响')
})

test('诚实边界：提示文案明说数据只在本地、短信邮件要看服务商', () => {
  ok(ACCOUNT_HINT.includes('只存在这台设备'), '含「只存在这台设备」')
  ok(ACCOUNT_HINT.includes('发短信/邮件'), '说明短信/邮件是可选的（不再声称完全没有）')
  ok(ACCOUNT_HINT.includes('没配服务商'), '说明没配服务商时的真实行为')
})