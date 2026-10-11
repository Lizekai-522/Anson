<script setup>
// 最近账号：点一下带回登录框，账号名已帮填；列表只存在本机。
// 删除是两步确认的：连数据桶一起删，删了就真没了。
import { ref, onBeforeUnmount } from 'vue'
import { navigate } from '../core/router.js'
import { listAccounts, removeAccount } from '../core/accounts.js'
import { store, toast } from '../core/store.js'

defineOptions({ inheritAttrs: false })

const accounts = ref(listAccounts())
const isCurrent = (acc) => !!(store.account && store.account.id === acc.id)

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
function removeClick(acc) {
  if (!askConfirm('acc:' + acc.id)) return
  const res = removeAccount(acc.id)
  accounts.value = listAccounts()
  if (!res.ok) { toast('这个账号已经不在列表里了', 'warn'); return }
  if (res.loggedOut) {
    toast('账号已删除，已退出登录', 'warn')
    navigate('/')
    return
  }
  toast(`已删除账号「${res.name}」`, 'info')
}
onBeforeUnmount(() => clearTimeout(confirmTimer))

function initial(name) {
  const s = String(name || '').trim()
  return s ? [...s][0] : '？'
}

function contactOf(acc) {
  return acc.email || acc.phone || '没有留联系方式'
}

function relTime(ts) {
  if (!ts) return '从未登录'
  const diff = Date.now() - Number(ts)
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} 个月前`
  return `${Math.floor(mo / 12)} 年前`
}

function pick(acc) {
  sessionStorage.setItem('ptb:prefill', acc.name)
  navigate('/login')
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <span class="page-kicker">本机账号</span>
        <h1 class="page-title">最近账号</h1>
        <p class="page-sub">点一下回到登录框，账号名已帮你填好。</p>
      </div>
    </header>

    <section v-if="accounts.length" class="list" aria-label="这台设备上的账号">
      <div v-for="acc in accounts" :key="acc.id" class="acc-card paper-card">
        <button class="acc-pick" @click="pick(acc)">
          <span class="avatar" aria-hidden="true">{{ initial(acc.name) }}</span>
          <span class="acc-info">
            <span class="acc-name">
              {{ acc.name }}<span v-if="isCurrent(acc)" class="tag tag-brand acc-cur">当前登录</span>
            </span>
            <span class="acc-meta">{{ contactOf(acc) }}</span>
          </span>
          <span class="acc-time">上次登录：{{ relTime(acc.lastLogin) }}</span>
        </button>
        <button
          class="btn btn-danger btn-sm acc-del"
          :class="{ arming: confirmKey === 'acc:' + acc.id }"
          @click="removeClick(acc)"
        >{{ confirmKey === 'acc:' + acc.id ? '确认删除？' : '删除' }}</button>
      </div>
    </section>

    <section v-else class="empty">
      <p class="kicker">空</p>
      <h2 class="empty-title">这台设备还没有账号</h2>
      <p class="empty-hint">注册一个，就能开始粘贴行程了。</p>
      <button class="btn btn-primary" @click="navigate('/register')">去注册</button>
    </section>

    <aside class="note" role="note">列表只存在这台设备，清浏览器数据就没。</aside>
  </div>
</template>

<style scoped>
.page {
  max-width: 560px;
  margin: 0 auto;
  padding-top: 32px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.acc-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  transition: border-color 0.15s ease;
}
.acc-card:hover {
  border-color: rgba(11, 107, 69, 0.45);
}
.acc-pick {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px 0;
  text-align: left;
  border-radius: var(--r-s);
}
.acc-del { flex: none; }
.acc-del.arming { background: rgba(179, 38, 30, 0.08); border-color: var(--c-err); color: var(--c-err); }
.acc-cur { margin-left: 8px; }

.avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--c-bg-2);
  color: var(--c-ink-1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--f-sans);
  font-size: 19px;
  font-weight: 700;
  flex: none;
}

.acc-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.acc-name {
  font-weight: 700;
  color: var(--c-ink-0);
}
.acc-meta {
  font-size: 13px;
  color: var(--c-ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acc-time {
  margin-left: auto;
  font-size: 13px;
  color: var(--c-ink-2);
  flex: none;
}

.note {
  margin-top: 26px;
  font-size: 13px;
  color: var(--c-ink-2);
}

@media (max-width: 520px) {
  .acc-card {
    flex-wrap: wrap;
  }
  .acc-pick {
    flex-wrap: wrap;
  }
  .acc-time {
    margin-left: 58px;
    width: 100%;
  }
  .acc-del {
    margin-left: auto;
  }
}
</style>
