<script setup>
// 注册页：5 字段本地校验 + 后端重复映射回字段；不发短信不发邮件，界面明说。
import { reactive, ref } from 'vue'
import { navigate } from '../core/router.js'
import { toast, readPendingInvite, clearPendingInvite } from '../core/store.js'
import { ACCOUNT_HINT, rules, validateRegister, register } from '../core/accounts.js'

defineOptions({ inheritAttrs: false })

const form = reactive({ name: '', email: '', phone: '', password: '', confirm: '' })
const errors = reactive({ name: '', email: '', phone: '', password: '', confirm: '' })
const busy = ref(false)

const nameInput = ref(null)
const emailInput = ref(null)
const phoneInput = ref(null)
const passwordInput = ref(null)
const confirmInput = ref(null)
const inputRefs = {
  name: nameInput,
  email: emailInput,
  phone: phoneInput,
  password: passwordInput,
  confirm: confirmInput,
}
const ORDER = ['name', 'email', 'phone', 'password', 'confirm']

function onBlur(field) {
  if (field === 'confirm') {
    errors.confirm = form.confirm && form.password !== form.confirm ? '两次输入的密码不一致' : ''
  } else {
    errors[field] = rules[field](form[field])
  }
}

function focusFirstError() {
  const f = ORDER.find((k) => errors[k])
  if (f) inputRefs[f].value?.focus()
}

async function onSubmit() {
  if (busy.value) return
  Object.assign(errors, { name: '', email: '', phone: '', password: '', confirm: '' })
  const { errors: errs, ok } = validateRegister({ ...form })
  if (!ok) {
    Object.assign(errors, errs)
    focusFirstError()
    return
  }
  busy.value = true
  const r = await register({ ...form })
  if (!r.ok) {
    for (const [k, msg] of Object.entries(r.errors)) {
      if (msg) errors[k] = msg
    }
    focusFirstError()
    busy.value = false
    return
  }
  toast('注册成功', 'ok')
  // 之前点开过子女邀请链接：注册完直接接着接收
  const pending = readPendingInvite()
  if (pending) {
    clearPendingInvite()
    navigate('/receive/' + pending, { replace: true })
  } else {
    navigate('/home', { replace: true })
  }
}
</script>

<template>
  <div class="page">
    <section class="card paper-card">
      <h1>注册账号</h1>
      <p class="lead">信息只保存在这台设备的浏览器里。</p>

      <form novalidate @submit.prevent="onSubmit">
        <div class="field">
          <label for="reg-name">账号名</label>
          <input
            id="reg-name"
            ref="nameInput"
            v-model="form.name"
            name="name"
            placeholder="2-20 位，字母或汉字开头"
            autocomplete="username"
            @blur="onBlur('name')"
          />
          <p v-if="errors.name" role="alert" class="field-error">{{ errors.name }}</p>
        </div>

        <div class="field">
          <label for="reg-email">邮箱</label>
          <input
            id="reg-email"
            ref="emailInput"
            v-model="form.email"
            name="email"
            type="email"
            placeholder="登录时可以代替账号名"
            autocomplete="email"
            @blur="onBlur('email')"
          />
          <p v-if="errors.email" role="alert" class="field-error">{{ errors.email }}</p>
        </div>

        <div class="field">
          <label for="reg-phone">手机号</label>
          <input
            id="reg-phone"
            ref="phoneInput"
            v-model="form.phone"
            name="phone"
            type="tel"
            placeholder="1 开头的 11 位数字"
            autocomplete="tel"
            @blur="onBlur('phone')"
          />
          <p v-if="errors.phone" role="alert" class="field-error">{{ errors.phone }}</p>
        </div>

        <div class="field">
          <label for="reg-password">密码</label>
          <input
            id="reg-password"
            ref="passwordInput"
            v-model="form.password"
            name="password"
            type="password"
            autocomplete="new-password"
            @blur="onBlur('password')"
          />
          <p class="field-hint">至少 8 位，需同时含字母和数字，不能纯数字</p>
          <p v-if="errors.password" role="alert" class="field-error">{{ errors.password }}</p>
        </div>

        <div class="field">
          <label for="reg-confirm">确认密码</label>
          <input
            id="reg-confirm"
            ref="confirmInput"
            v-model="form.confirm"
            name="confirm"
            type="password"
            autocomplete="new-password"
            @blur="onBlur('confirm')"
          />
          <p v-if="errors.confirm" role="alert" class="field-error">{{ errors.confirm }}</p>
        </div>

        <button class="btn btn-primary submit" type="submit" :disabled="busy">
          {{ busy ? '注册中…' : '注册' }}
        </button>
      </form>

      <nav class="links" aria-label="其他入口">
        <a href="#/login">已有账号？去登录</a>
      </nav>
    </section>

    <aside class="note" role="note">{{ ACCOUNT_HINT }}</aside>
  </div>
</template>

<style scoped>
.page {
  max-width: 460px;
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

.field {
  margin-bottom: 16px;
}
.field label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--c-ink-1);
}

.field-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--c-err);
}
.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--c-ink-2);
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

.note {
  margin-top: 24px;
  padding: 0 6px;
  font-size: 13px;
  color: var(--c-ink-2);
}
</style>
