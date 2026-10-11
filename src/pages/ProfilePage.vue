<script setup>
// 我的：账号信息、诚实声明、数据备份/清空、退出登录、关于。
import { saveAccountData } from '../core/store.js'
import { ref, reactive, computed, onBeforeUnmount } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, persist, mergeBackup } from '../core/store.js'
import { ACCOUNT_HINT, logout, updateAccount } from '../core/accounts.js'

defineProps({ params: { type: Object, default: () => ({}) } })

// 本地时区 'YYYY-MM-DD'
function fmt(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 账号是响应式的：改名/换头像后顶栏与这里都立即更新
const account = computed(() => store.account || { name: '?', email: '', phone: '', avatar: '' })
const initial = computed(() => String(account.value.name || '?').slice(0, 1))

// ---- 资料编辑 ----
const editing = ref(false)
const form = reactive({ name: '', email: '', phone: '' })
const errs = reactive({ name: '', email: '', phone: '' })
function startEdit() {
  form.name = account.value.name || ''
  form.email = account.value.email || ''
  form.phone = account.value.phone || ''
  errs.name = errs.email = errs.phone = ''
  editing.value = true
}
function cancelEdit() {
  errs.name = errs.email = errs.phone = ''
  editing.value = false
}
function saveProfile() {
  const a = store.account
  if (!a) return
  const res = updateAccount(a.id, { name: form.name, email: form.email, phone: form.phone })
  if (!res.ok) {
    errs.name = (res.errors && res.errors.name) || ''
    errs.email = (res.errors && res.errors.email) || ''
    errs.phone = (res.errors && res.errors.phone) || ''
    toast('有几处需要改一下', 'warn')
    return
  }
  errs.name = errs.email = errs.phone = ''
  editing.value = false
  toast('资料已保存', 'ok')
}

// ---- 头像上传：裁成正方形缩到 256px 再存，避免大图撑爆 localStorage ----
const avatarInput = ref(null)
function pickAvatar() { avatarInput.value?.click() }
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
function shrinkSquare(dataUrl, size) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = size; c.height = size
      const ctx = c.getContext('2d')
      const s = Math.min(img.width, img.height) // 居中取最大的正方形
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}
async function onAvatarPicked(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 清空 value，允许连续选同一张
  if (!file) return
  if (!/^image\//.test(file.type)) { toast('请选一张图片', 'warn'); return }
  try {
    const raw = await readAsDataUrl(file)
    const small = await shrinkSquare(raw, 256)
    const a = store.account
    const res = updateAccount(a.id, { avatar: small })
    if (!res.ok) { toast('头像保存失败', 'err'); return }
    toast('头像已更新', 'ok')
  } catch {
    toast('头像读取失败', 'err')
  }
}
function removeAvatar() {
  const a = store.account
  if (!a || !a.avatar) return
  updateAccount(a.id, { avatar: '' })
  toast('已恢复默认头像', 'info')
}

// ---- 导出数据备份 ----
function exportBackup() {
  const json = JSON.stringify(store.data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `安程-备份-${fmt(new Date())}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast('备份文件已导出', 'ok')
}

// ---- 从备份文件恢复（合并导入：按 id 去重，不覆盖现有数据）----
const backupInput = ref(null)
function pickBackup() { backupInput.value?.click() }
async function onBackupPicked(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 清空 value，允许连续选同一个文件
  if (!file) return
  let json = null
  try { json = JSON.parse(await file.text()) } catch { json = null }
  const res = mergeBackup(store.data, json)
  if (!res.ok) { toast('这不是有效的备份文件', 'err'); return }
  const parts = []
  if (res.added.trips) parts.push(`${res.added.trips} 条行程`)
  if (res.added.family) parts.push(`${res.added.family} 位家人`)
  if (res.added.shares) parts.push(`${res.added.shares} 条分享记录`)
  if (res.added.familyGroups) parts.push(`${res.added.familyGroups} 个家人分组`)
  if (!parts.length) { toast('没有可恢复的新内容', 'warn'); return }
  if (!saveAccountData(res.data).ok) { toast('备份没有保存到本机，请保留备份文件并重试', 'err'); return }
  toast(`已恢复 ${parts.join('、')}${res.skipped ? `，跳过 ${res.skipped} 条重复或无效` : ''}`, 'ok')
}

// ---- 清空数据（两步确认）----
const confirmKey = ref('')
let confirmTimer = null
function askConfirm(key) {
  if (confirmKey.value === key) {
    confirmKey.value = ''
    clearTimeout(confirmTimer)
    return true
  }
  confirmKey.value = key
  clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => { confirmKey.value = '' }, 3000)
  return false
}
function clearDataClick() {
  if (!askConfirm('clear-data')) return
  store.data.trips = []
  store.data.family = []
  store.data.shares = []
  store.data.familyGroups = []
  store.data.invites = []
  store.data.draft = null
  persist()
  toast('已清空', 'warn')
}

// ---- 清理缓存与残留（两步确认）----
// 与「清空本账号数据」互不替代：这里清的是**设备级**的 Service Worker 缓存与同步/长辈端残留键，
// 账号数据一条不动。清完 reload，让新版页面重新接管。
const cleaning = ref(false)
async function clearCacheClick() {
  if (!askConfirm('clear-cache')) return
  cleaning.value = true
  let removed = 0
  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      removed += keys.length
    }
  } catch {}
  try {
    const ls = window.localStorage
    const doomed = []
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i)
      // 同步镜像与长辈端勾选记录都是可重建的残留；账号桶（ptb:data:*）不碰
      if (k && (k.indexOf('ptb:sync:') === 0 || k.indexOf('ptb:elder:state:') === 0)) doomed.push(k)
    }
    doomed.forEach((k) => ls.removeItem(k))
    removed += doomed.length
  } catch {}
  toast(`已清理 ${removed} 项缓存与残留，正在重新载入`, 'ok')
  setTimeout(() => { location.reload() }, 400)
}

// ---- 退出登录 ----
function doLogout() {
  logout()
  toast('已退出', 'info')
  navigate('/')
}
onBeforeUnmount(() => clearTimeout(confirmTimer))
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <span class="page-kicker">我的 · 本机账号</span>
        <h1 class="page-title">账号与数据</h1>
      </div>
    </header>

    <section class="paper-card account-card">
      <div class="avatar-wrap">
        <button
          type="button"
          class="avatar"
          :class="{ 'avatar-img': account.avatar }"
          aria-label="更换头像"
          @click="pickAvatar"
        >
          <img v-if="account.avatar" :src="account.avatar" alt="当前头像" />
          <span v-else aria-hidden="true">{{ initial }}</span>
        </button>
        <input
          ref="avatarInput"
          class="visually-hidden"
          type="file"
          accept="image/*"
          aria-label="选择头像图片"
          @change="onAvatarPicked"
        />
        <div class="avatar-actions">
          <button type="button" class="btn btn-ghost btn-sm" @click="pickAvatar">上传头像</button>
          <button v-if="account.avatar" type="button" class="btn btn-ghost btn-sm" @click="removeAvatar">恢复默认</button>
        </div>
      </div>

      <div class="account-info">
        <template v-if="!editing">
          <div class="account-head">
            <h2 class="account-name">{{ account.name }}</h2>
            <button type="button" class="btn btn-ghost btn-sm" @click="startEdit">编辑资料</button>
          </div>
          <p v-if="account.email" class="account-line">{{ account.email }}</p>
          <p v-if="account.phone" class="account-line">{{ account.phone }}</p>
        </template>
        <form v-else class="account-form" @submit.prevent="saveProfile">
          <div class="form-field">
            <label for="acc-name">账号名</label>
            <input id="acc-name" v-model="form.name" type="text" autocomplete="off" />
            <small v-if="errs.name" class="form-err">{{ errs.name }}</small>
          </div>
          <div class="form-field">
            <label for="acc-email">邮箱</label>
            <input id="acc-email" v-model="form.email" type="email" autocomplete="off" />
            <small v-if="errs.email" class="form-err">{{ errs.email }}</small>
          </div>
          <div class="form-field">
            <label for="acc-phone">手机号</label>
            <input id="acc-phone" v-model="form.phone" type="tel" autocomplete="off" />
            <small v-if="errs.phone" class="form-err">{{ errs.phone }}</small>
          </div>
          <div class="account-form-actions">
            <button type="submit" class="btn btn-primary btn-sm">保存</button>
            <button type="button" class="btn btn-ghost btn-sm" @click="cancelEdit">取消</button>
          </div>
        </form>
      </div>
    </section>

    <section class="paper-card hint-card" role="note">
      <p class="hint-title">先说清楚</p>
      <p class="hint-text">{{ ACCOUNT_HINT }}</p>
    </section>

    <section class="paper-card block" aria-label="数据">
      <h2 class="block-title">数据</h2>
      <div class="row">
        <div class="row-text">
          <p class="row-title">导出数据备份</p>
          <p class="row-desc">把行程、家人、分享记录打包成一个 JSON 文件存到本地。</p>
        </div>
        <button class="btn btn-ghost" @click="exportBackup">导出数据备份</button>
      </div>
      <div class="row">
        <div class="row-text">
          <p class="row-title">从备份文件恢复</p>
          <p class="row-desc">选一个之前导出的 JSON，按 id 去重合并进来，不覆盖现有数据。</p>
        </div>
        <button class="btn btn-ghost" @click="pickBackup">选择备份文件</button>
        <input
          ref="backupInput"
          class="visually-hidden"
          type="file"
          accept="application/json,.json"
          aria-label="选择备份文件"
          @change="onBackupPicked"
        />
      </div>
      <div class="row row-danger">
        <div class="row-text">
          <p class="row-title">清理缓存与残留</p>
          <p class="row-desc">清掉这台设备上的离线缓存、同步镜像与长辈端勾选记录，然后自动重新载入。账号里的行程、家人不受影响。</p>
        </div>
        <button
          class="btn btn-ghost"
          :class="{ arming: confirmKey === 'clear-cache' }"
          :disabled="cleaning"
          @click="clearCacheClick"
        >{{ confirmKey === 'clear-cache' ? '确认清理？' : '清理缓存与残留' }}</button>
      </div>
      <div class="row row-danger">
        <div class="row-text">
          <p class="row-title">清空本账号数据</p>
          <p class="row-desc">删掉这台设备上本账号的全部行程、家人、分组和分享记录，不可恢复。</p>
        </div>
        <button
          class="btn btn-danger"
          :class="{ arming: confirmKey === 'clear-data' }"
          @click="clearDataClick"
        >{{ confirmKey === 'clear-data' ? '确认清空？' : '清空本账号数据' }}</button>
      </div>
    </section>

    <section class="paper-card block" aria-label="模型配置">
      <h2 class="block-title">模型配置</h2>
      <div class="row">
        <div class="row-text">
          <p class="row-title">自定义模型</p>
          <p class="row-desc">接一个 OpenAI 兼容的模型，用来做「AI 补全」和「截图识字」。填 Base URL、模型名称、API Key，只存在这台设备上。</p>
        </div>
        <a class="btn btn-ghost" href="#/model">去设置</a>
      </div>
    </section>

    <section class="paper-card block" aria-label="账号">
      <h2 class="block-title">账号</h2>
      <div class="row">
        <div class="row-text">
          <p class="row-title">退出登录</p>
          <p class="row-desc">退出后可在最近账号里选人，需输密码</p>
        </div>
        <button class="btn btn-ghost" @click="doLogout">退出登录</button>
      </div>
      <div class="row">
        <div class="row-text">
          <p class="row-title">切换账号</p>
          <p class="row-desc">数据按账号隔离，换账号看到的是另一个人的行程。</p>
        </div>
        <a class="btn btn-ghost" href="#/accounts">去切换</a>
      </div>
    </section>

    <section class="paper-card block about" aria-label="关于">
      <h2 class="block-title">关于</h2>
      <ul class="about-list">
        <li>版本 v1.0.0</li>
        <li>纯本地存储：数据只在这台设备的浏览器里（localStorage 键 ptb:*）</li>
        <li>没有后端，没有云端同步</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.account-card {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  padding: 18px;
  margin-bottom: 14px;
}
.avatar-wrap { flex: none; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.avatar {
  width: 56px;
  height: 56px;
  padding: 0;
  border-radius: 50%;
  background: var(--c-bg-2);
  color: var(--c-brand);
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px var(--c-line);
  overflow: hidden;
  cursor: pointer;
}
.avatar:hover { box-shadow: inset 0 0 0 2px var(--c-brand); }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.account-info { flex: 1; min-width: 200px; }
.account-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.account-name { margin: 0; font-size: 20px; letter-spacing: 1px; }
.account-line { margin: 3px 0 0; font-size: 14px; color: var(--c-ink-2); }

.account-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.form-field label { display: block; font-size: 13px; color: var(--c-ink-1); margin-bottom: 4px; }
.form-field input { font-size: 14px; padding: 7px 10px; }
.form-err { display: block; margin-top: 4px; font-size: 12px; color: var(--c-err); }
.account-form-actions { grid-column: 1 / -1; display: flex; gap: 8px; }

.hint-card {
  padding: 14px 18px;
  margin-bottom: 14px;
  border: 1px solid rgba(11, 107, 69, 0.35);
  background: rgba(11, 107, 69, 0.04);
}
.hint-title { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--c-brand); }
.hint-text { margin: 0; font-size: 14px; color: var(--c-ink-1); }

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 0;
  border-bottom: 1px dashed var(--c-line);
}
.row:last-child { border-bottom: none; padding-bottom: 0; }
.row:first-of-type { padding-top: 6px; }
.row-text { flex: 1; min-width: 220px; }
.row-title { margin: 0; font-size: 15px; }
.row-desc { margin: 2px 0 0; font-size: 13px; color: var(--c-ink-2); }

.about-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--c-ink-2);
}
.about-list li { margin: 3px 0; }
</style>
