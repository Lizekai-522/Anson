<script setup>
// 应用外壳：路由守卫、导航、抽屉（弹簧动画/焦点陷阱）、吐司、快捷键。
// 长辈端（#/e/...）完全绕开本外壳 —— 它没有动画、没有浮层特权。
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, navigate, matchPath } from './core/router.js'
import { store } from './core/store.js'
import { createSpring, prefersReducedMotion } from './core/spring.js'
import { enterPage } from './core/motion.js'
import BrandMark from './components/BrandMark.vue'

import WelcomePage from './pages/WelcomePage.vue'
import LoginPage from './pages/LoginPage.vue'
import RegisterPage from './pages/RegisterPage.vue'
import RecentAccountsPage from './pages/RecentAccountsPage.vue'
import HomePage from './pages/HomePage.vue'
import ImportPage from './pages/ImportPage.vue'
import TripPage from './pages/TripPage.vue'
import FamilyPage from './pages/FamilyPage.vue'
import SharePage from './pages/SharePage.vue'
import ProfilePage from './pages/ProfilePage.vue'
import ModelPage from './pages/ModelPage.vue'
import ReceivePage from './pages/ReceivePage.vue'
import ElderPage from './elder/ElderPage.vue'

const ROUTES = [
  { path: '/', comp: WelcomePage, public: true, title: '安程' },
  { path: '/login', comp: LoginPage, public: true, title: '登录' },
  { path: '/register', comp: RegisterPage, public: true, title: '注册账号' },
  { path: '/accounts', comp: RecentAccountsPage, public: true, title: '最近账号' },
  { path: '/home', comp: HomePage, title: '行程' },
  { path: '/import', comp: ImportPage, title: '导入行程' },
  { path: '/trip/:id', comp: TripPage, title: '行程详情' },
  { path: '/family', comp: FamilyPage, title: '家人' },
  { path: '/share/:tripId', comp: SharePage, title: '分享' },
  { path: '/receive', comp: ReceivePage, public: true, title: '接收行程' },
  { path: '/receive/:token', comp: ReceivePage, public: true, title: '接收行程' },
  { path: '/profile', comp: ProfilePage, title: '我的' },
  { path: '/model', comp: ModelPage, title: '模型配置' },
]

const route = useRoute()
const mainRef = ref(null)
// 顶栏右侧只放"我是谁"这一个身份入口（导航里已有「我的」页，不再重复第二个同名按钮）
const initial = computed(() => String((store.account && store.account.name) || '?').slice(0, 1))
const isElder = computed(() => route.path === '/e' || route.path.startsWith('/e/'))
// 页面切换的入场动效：只作用于子女端内容区（长辈端一行都不动）
watch(() => route.path, () => {
  if (isElder.value) return
  nextTick(() => enterPage(mainRef.value, 'page:' + route.path))
})
const matched = computed(() => {
  if (isElder.value) return { comp: ElderPage, params: {}, title: '长辈端', public: true }
  for (const r of ROUTES) {
    const params = matchPath(r.path, route.path)
    if (params) return { comp: r.comp, params, title: r.title, public: !!r.public }
  }
  return null
})
const routeParams = computed(() => matched.value?.params || {})
const notFound = computed(() => !isElder.value && !matched.value)

// 路由守卫：未登录访问受保护页 → 回登录；长辈端永远免登录直达
watch([() => route.path, () => store.ready], ([path, ready]) => {
  if (!ready || isElder.value) return
  const m = matched.value
  if (m && !m.public && !store.account) navigate('/login', { replace: true })
  if (path === '/login' && store.account) navigate('/home', { replace: true })
}, { immediate: true })

watch(() => matched.value?.title, (t) => { document.title = t ? `${t} · 安程` : '安程' })

const NAV = [
  { path: '/home', label: '行程', match: (p) => p === '/home' || p.startsWith('/trip/') },
  { path: '/import', label: '导入', match: (p) => p === '/import' },
  { path: '/family', label: '家人', match: (p) => p === '/family' },
  { path: '/profile', label: '我的', match: (p) => p === '/profile' },
]

// ---- 抽屉：弹簧驱动、可打断、焦点陷阱、ESC/遮罩可关 ----
const drawer = reactive({ open: false, title: '' })
const drawerSlots = ref(null) // 由页面注入的渲染函数
const maskRef = ref(null)
const panelRef = ref(null)
let lastFocus = null

const drawerSpring = createSpring(-104, { stiffness: 320, damping: 34 })
let unsubSpring = null

function applyDrawer(v) {
  if (panelRef.value) panelRef.value.style.transform = `translateX(${v}%)`
  if (maskRef.value) maskRef.value.style.opacity = String(Math.max(0, Math.min(1, (v + 104) / 104 * 0.5)))
}
function openDrawer(title, contentFn) {
  drawer.title = title || ''
  drawerSlots.value = contentFn || null
  drawer.open = true
  lastFocus = document.activeElement
  if (!unsubSpring) unsubSpring = drawerSpring.onUpdate(applyDrawer)
  nextTick(() => {
    applyDrawer(drawerSpring.value)
    drawerSpring.setTarget(0)
    const f = panelRef.value?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ;(f || panelRef.value)?.focus?.()
  })
}
function closeDrawer() {
  drawerSpring.setTarget(-104)
  drawer.open = false
  if (lastFocus?.focus) lastFocus.focus()
}
function onDrawerKeydown(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); return }
  if (e.key !== 'Tab' || !panelRef.value) return
  const els = Array.from(panelRef.value.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.disabled && el.offsetParent !== null)
  if (!els.length) return
  const first = els[0], last = els[els.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

// 抽屉拖拽：1:1 跟手 + 松手速度交接
let dragStartX = null
function panelPointerdown(e) {
  dragStartX = e.clientX
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
function panelPointermove(e) {
  if (dragStartX == null) return
  const dx = e.clientX - dragStartX
  drawerSpring.dragTo(Math.max(0, Math.min(104, (dx / Math.max(1, window.innerWidth * 0.42)) * 104)))
}
function panelPointerup() {
  if (dragStartX == null) return
  dragStartX = null
  const v = drawerSpring.value
  drawerSpring.release(v > 34 ? -104 : 0)
  if (v > 34) { drawer.open = false; if (lastFocus?.focus) lastFocus.focus() }
  else drawer.open = true
}

// ---- 快捷键 ----
function onKeydown(e) {
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const map = { '1': '/home', '2': '/import', '3': '/family', '4': '/profile' }
    if (map[e.key] && store.account) { e.preventDefault(); navigate(map[e.key]) }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (prefersReducedMotion()) drawerSpring.reduced = true
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  unsubSpring?.()
  drawerSpring.destroy()
})
</script>

<template>
  <!-- 长辈端：独立渲染，不套外壳，零动画零浮层 -->
  <ElderPage v-if="isElder" />

  <div v-else class="kid-shell">
    <a class="skip-to-content" href="#main-content">跳过导航，直接看内容</a>

    <header v-if="store.account" class="topbar">
      <div class="topbar-inner">
        <button type="button" class="logo" aria-label="安程 · 回到行程" @click="navigate('/home')">
          <BrandMark :size="22" tone="brand" />
          <span class="logo-text">安程</span>
          <span class="logo-latin" aria-hidden="true">ANCHENG</span>
        </button>
        <nav aria-label="主导航" class="mainnav">
          <button
            v-for="n in NAV" :key="n.path"
            class="navlink" :class="{ active: n.match(route.path) }"
            @click="navigate(n.path)"
          >{{ n.label }}</button>
        </nav>
        <div class="topbar-user">
          <button
            type="button"
            class="who-btn"
            :aria-label="'我的账号：' + store.account.name"
            @click="navigate('/profile')"
          >
            <span class="who-avatar" aria-hidden="true">{{ initial }}</span>
            <span class="who">{{ store.account.name }}</span>
          </button>
        </div>
      </div>
    </header>

    <main id="main-content" class="main" ref="mainRef" tabindex="-1">
      <component
        v-if="matched && store.ready"
        :is="matched.comp"
        :params="routeParams"
        @open-drawer="openDrawer"
      />
      <section v-else-if="notFound && store.ready" class="empty">
        <p class="kicker">404</p>
        <h2 class="empty-title">页面走丢了</h2>
        <p class="empty-hint">这个地址不存在。回首页看看？</p>
        <div class="empty-actions">
          <button class="btn btn-primary" @click="navigate(store.account ? '/home' : '/')">回首页</button>
        </div>
      </section>
    </main>

    <!-- 吐司 -->
    <div class="toasts" role="status" aria-live="polite">
      <div v-for="t in store.toasts" :key="t.id" class="toast" :class="'toast-' + t.kind">{{ t.msg }}</div>
    </div>

    <!-- 抽屉：半透明是浮层的特权 -->
    <div
      v-if="drawer.open"
      class="drawer-mask" ref="maskRef"
      @click="closeDrawer"
    ></div>
    <div
      v-if="drawer.open"
      class="drawer-panel"
      ref="panelRef"
      role="dialog"
      aria-modal="true"
      :aria-label="drawer.title || '详情'"
      tabindex="-1"
      @keydown="onDrawerKeydown"
      @pointerdown="panelPointerdown"
      @pointermove="panelPointermove"
      @pointerup="panelPointerup"
      @pointercancel="panelPointerup"
    >
      <div class="drawer-head">
        <h2>{{ drawer.title }}</h2>
        <button class="btn btn-ghost btn-sm" @click="closeDrawer">关闭</button>
      </div>
      <div class="drawer-body">
        <component :is="drawerSlots" v-if="drawerSlots" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.kid-shell { min-height: 100vh; position: relative; }

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(246, 247, 245, 0.92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--c-line);
}
.topbar-inner {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 20px;
  height: 58px;
  display: flex;
  align-items: center;
  gap: 18px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
}
.logo-text { font-family: var(--f-sans); font-size: 18px; font-weight: 800; letter-spacing: 2px; }
.logo-latin {
  font-family: var(--f-mono);
  font-size: 10px;
  letter-spacing: 2.4px;
  color: var(--c-ink-2);
  transform: translateY(1px);
}

.mainnav { display: flex; gap: 4px; flex: 1; }
.navlink {
  padding: 7px 14px;
  border-radius: var(--r-s);
  color: var(--c-ink-1);
  font-size: 15px;
}
.navlink:hover { background: var(--c-bg-1); color: var(--c-ink-0); }
.navlink.active { background: var(--c-bg-2); color: var(--c-brand); font-weight: 600; }

.topbar-user { display: flex; align-items: center; gap: 10px; }
.who-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  color: var(--c-ink-0);
}
.who-btn:hover { background: var(--c-bg-1); }
.who-avatar {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--c-brand);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
}
.who { font-size: 13px; color: var(--c-ink-1); }

.main {
  position: relative;
  z-index: 1;
  max-width: 960px;
  margin: 0 auto;
  padding: 26px 20px 80px;
}
.main:focus { outline: none; }

.toasts {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.toast {
  background: rgba(35, 39, 47, 0.92);
  color: #fff;
  padding: 10px 18px;
  border-radius: var(--r-s);
  font-size: 14px;
  box-shadow: var(--sh-2);
  animation: toast-in 0.25s ease;
  max-width: 80vw;
}
.toast-ok { background: rgba(46, 107, 52, 0.94); }
.toast-err { background: rgba(179, 38, 30, 0.94); }
.toast-warn { background: rgba(154, 107, 8, 0.94); }
@keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(35, 39, 47, 0.5);
  z-index: 40;
}
.drawer-panel {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: min(420px, 92vw);
  background: var(--c-card);
  border-left: 1px solid var(--c-line);
  box-shadow: var(--sh-2);
  z-index: 41;
  transform: translateX(-104%);
  display: flex;
  flex-direction: column;
  touch-action: pan-y;
}
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-line);
}
.drawer-head h2 { margin: 0; font-size: 18px; }
.drawer-body { padding: 18px; overflow-y: auto; flex: 1; }

@media (max-width: 640px) {
  .topbar-inner { padding: 0 12px; gap: 8px; }
  .logo-latin { display: none; }
  .who { display: none; }
  .navlink { padding: 7px 10px; }
  .main { padding: 18px 12px 80px; }
}
</style>
