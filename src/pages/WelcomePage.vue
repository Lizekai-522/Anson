<script setup>
// 身份选择页：爸妈免登录直达长辈端，子女走账号体系。
// 版式走编辑式：品牌字标 + 一句陈述 + 生成式轨迹场 + 两条编号入口（用细线分隔，不做卡片墙）。
import { computed } from 'vue'
import { navigate } from '../core/router.js'
import { store } from '../core/store.js'
import { ACCOUNT_HINT } from '../core/accounts.js'
import BrandMark from '../components/BrandMark.vue'
import RouteField from '../components/RouteField.vue'

defineOptions({ inheritAttrs: false })

const kidCta = computed(() => (store.account ? '进入行程' : '去登录'))

function goElder() {
  navigate('/e')
}
function goKid() {
  navigate(store.account ? '/home' : '/login')
}
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="brand-row">
        <BrandMark :size="24" tone="brand" />
        <span class="wordmark">安程</span>
        <span class="kicker">ANCHENG</span>
      </div>
      <h1 class="hero-line">子女把行程排好，<br />长辈打开就能看懂</h1>
      <p class="hero-sub">粘贴一次行程原文，自动排成长辈看得清的大字页面；链接发过去，免登录、免安装。</p>
      <div v-if="store.account" class="session-row">
        <span class="tag tag-brand">当前账号：{{ store.account.name }}</span>
        <button class="btn btn-primary btn-sm" @click="navigate('/home')">直接去行程</button>
      </div>
    </header>

    <RouteField :height="136" :routes="12" />

    <section class="entries" aria-label="选择身份">
      <button class="entry" @click="goElder">
        <span class="entry-kicker">01 / 长辈</span>
        <span class="entry-title">我是爸妈</span>
        <span class="entry-desc">不用登录，直接看行程；也可以输入子女给的 6 位码。</span>
        <span class="entry-cta">进入长辈端 →</span>
      </button>

      <button class="entry" @click="goKid">
        <span class="entry-kicker">02 / 子女</span>
        <span class="entry-title">我是子女</span>
        <span class="entry-desc">粘贴行程原文，自动生成长辈能看的大字页面。</span>
        <span class="entry-cta">{{ kidCta }} →</span>
      </button>
    </section>

    <nav class="links" aria-label="账号入口">
      <a href="#/register">注册新账号</a>
      <span class="sep" aria-hidden="true">·</span>
      <a href="#/accounts">最近账号</a>
    </nav>

    <aside class="note" role="note">
      <p class="note-title">先说清楚</p>
      <p class="note-text">{{ ACCOUNT_HINT }}</p>
    </aside>
  </div>
</template>

<style scoped>
.page {
  max-width: 680px;
  margin: 0 auto;
  padding-top: 12px;
}

.hero { padding: 8px 0 4px; }
.brand-row { display: flex; align-items: center; gap: 9px; }
.wordmark { font-family: var(--f-sans); font-size: 20px; font-weight: 800; letter-spacing: 2px; }
.hero-line {
  margin: 20px 0 10px;
  font-family: var(--f-sans);
  font-size: 38px;
  font-weight: 800;
  line-height: 1.28;
  letter-spacing: 0.5px;
}
.hero-sub { margin: 0; max-width: 30em; font-size: 15px; line-height: 1.7; color: var(--c-ink-1); }
.session-row {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.entries { margin-top: 28px; border-top: 1px solid var(--c-line); }
.entry {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 4px 16px;
  width: 100%;
  padding: 20px 2px;
  text-align: left;
  border-bottom: 1px solid var(--c-line);
}
.entry-kicker {
  grid-column: 1 / -1;
  font-family: var(--f-mono);
  font-size: 11px;
  letter-spacing: 2.2px;
  text-transform: uppercase;
  color: var(--c-ink-2);
}
.entry-title { font-family: var(--f-sans); font-size: 23px; font-weight: 800; letter-spacing: 0.5px; }
.entry-desc {
  grid-column: 1 / -1;
  font-size: 13px;
  line-height: 1.7;
  color: var(--c-ink-1);
}
/* 入口 CTA：外观做成按钮（描边 + 内边距），但外层 .entry 已是 <button>，
   这里不能再来一个真 <button>（button 嵌套 button 非法，会破坏整行点击），
   所以保持 span，只把视觉做成按钮。 */
.entry-cta {
  grid-row: 2;
  grid-column: 2;
  align-self: center;
  padding: 7px 14px;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-brand);
  background: transparent;
  border: 1px solid var(--c-brand);
  border-radius: var(--r-s);
  white-space: nowrap;
  transition: background-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.entry:hover .entry-title { color: var(--c-brand); }
.entry:hover .entry-cta { background: var(--c-brand); color: #fff; }

.links {
  margin-top: 22px;
  font-size: 14px;
  color: var(--c-ink-2);
}
.sep { margin: 0 8px; }

.note {
  margin-top: 30px;
  padding: 14px 0 0;
  border-top: 1px solid var(--c-line);
}
.note-title { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: var(--c-brand); }
.note-text { margin: 0; font-size: 13px; color: var(--c-ink-1); }
</style>