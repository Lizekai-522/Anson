<script setup>
// 登录页：账号名 / 邮箱 / 手机号任一可登录，失败文案统一不泄露账号存在性。
import { reactive, ref, onMounted } from 'vue'
import { navigate } from '../core/router.js'
import { toast, readPendingInvite, clearPendingInvite } from '../core/store.js'
import { ACCOUNT_HINT, login } from '../core/accounts.js'

defineOptions({ inheritAttrs: false })

const form = reactive({ identifier: '', password: '' })
const error = ref('')
const busy = ref(false)

// 从「最近账号」页带回来的账号名，填一次就删
onMounted(() => {
  const pre = sessionStorage.getItem('ptb:prefill')
  if (pre) {
    form.identifier = pre
    sessionStorage.removeItem('ptb:prefill')
  }
})

async function onSubmit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const r = await login(form.identifier, form.password)
  if (r.ok) {
    toast('欢迎回来，' + r.account.name, 'ok')
    // 之前点开过子女邀请链接：登录后直接接着接收
    const pending = readPendingInvite()
    if (pending) {
      clearPendingInvite()
      navigate('/receive/' + pending, { replace: true })
    } else {
      navigate('/home', { replace: true })
    }
  } else {
    error.value = r.error
    toast(r.error, 'err')
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <section class="card paper-card">
      <h1>登录</h1>
      <p class="lead">账号名、邮箱或手机号，任一种都能进。</p>

      <form novalidate @submit.prevent="onSubmit">
        <p v-if="error" role="alert" class="form-error">{{ error }}</p>

        <div class="field">
          <label for="login-identifier">账号名 / 邮箱 / 手机号</label>
          <input
            id="login-identifier"
            v-model="form.identifier"
            name="identifier"
            placeholder="任一种都可以"
            autocomplete="username"
          />
        </div>

        <div class="field">
          <label for="login-password">密码</label>
          <input
            id="login-password"
            v-model="form.password"
            name="password"
            type="password"
            autocomplete="current-password"
          />
        </div>

        <button class="btn btn-primary submit" type="submit" :disabled="busy">
          {{ busy ? '登录中…' : '登录' }}
        </button>
      </form>

      <nav class="links" aria-label="其他入口">
        <a href="#/register">没有账号？去注册</a>
        <span class="sep" aria-hidden="true">｜</span>
        <a href="#/accounts">最近账号</a>
        <span class="sep" aria-hidden="true">｜</span>
        <a href="#/">返回</a>
      </nav>
    </section>

    <aside class="note" role="note">
      <p>{{ ACCOUNT_HINT }}</p>
      <p>登录失败时不会透露账号是否存在，这是防骚扰设计。</p>
    </aside>
  </div>
</template>

<style scoped>
.page {
  max-width: 430px;
  margin: 0 auto;
  padding-top: 32px;
}

.card {
  padding: 28px 26px 24px;
}
.card h1 {
  margin: 0 0 4px;
  font-size: 24px;
}
.lead {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--c-ink-2);
}

.form-error {
  margin: 0 0 14px;
  padding: 10px 12px;
  color: var(--c-err);
  font-size: 14px;
  background: rgba(179, 38, 30, 0.06);
  border: 1px solid rgba(179, 38, 30, 0.35);
  border-radius: var(--r-s);
}

.field {
  margin-bottom: 16px;
}
.field label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--c-ink-1);
}

.submit {
  width: 100%;
  margin-top: 6px;
}

.links {
  margin-top: 18px;
  text-align: center;
  font-size: 13px;
  color: var(--c-ink-2);
}
.sep {
  margin: 0 8px;
}

.note {
  margin-top: 24px;
  padding: 0 6px;
  font-size: 13px;
  color: var(--c-ink-2);
}
.note p {
  margin: 4px 0;
}
</style>
