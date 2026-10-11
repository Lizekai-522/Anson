<script setup>
// 子女端首页：行程列表。搜索、草稿提示、行程卡（查看/分享/删除）。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { navigate } from '../core/router.js'
import { store, toast, removeTrip, clearDraft } from '../core/store.js'
import { enterList } from '../core/motion.js'

defineProps({ params: { type: Object, default: () => ({}) } })

const listRef = ref(null)
// 列表逐条入场（一个会话只播一次，来回切页不重复晃眼）
onMounted(() => enterList(listRef.value ? listRef.value.children : null, 'list:home'))

const query = ref('')
// 搜索命中范围：行程名 / 车次 / 出发到达站（都是用户记得住的东西）
const filteredTrips = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.data.trips
  return store.data.trips.filter((t) => {
    const hay = [t.title, ...(t.segments || []).flatMap((s) => [s.code, s.from, s.to])]
      .filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
})

// 列表编号（01/02/…）：编辑式的顺序感，替代卡片边框
const no2 = (i) => String(i + 1).padStart(2, '0')

// 段类型计数（高铁/航班/酒店/打车/游玩）
function typeCounts(trip) {
  const c = { train: 0, flight: 0, hotel: 0, taxi: 0, activity: 0 }
  for (const s of trip.segments || []) if (c[s.type] !== undefined) c[s.type]++
  return c
}
function tripSummary(trip) {
  const n = (trip.segments || []).length
  const c = typeCounts(trip)
  const parts = []
  if (c.train) parts.push(`高铁 ${c.train}`)
  if (c.flight) parts.push(`航班 ${c.flight}`)
  if (c.hotel) parts.push(`酒店 ${c.hotel}`)
  if (c.taxi) parts.push(`打车 ${c.taxi}`)
  if (c.activity) parts.push(`游玩 ${c.activity}`)
  return `共 ${n} 段` + (parts.length ? '：' + parts.join(' · ') : '')
}
function issueCount(trip, level) {
  return (trip.issues || []).filter((i) => i.level === level).length
}

// 危险操作两步确认：第一次点变「确认删除？」，3 秒内再点才执行
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
function removeTripClick(trip) {
  if (!askConfirm('trip:' + trip.id)) return
  removeTrip(trip.id)
  toast('行程已删除', 'info')
}
function discardDraft() {
  clearDraft()
  toast('草稿已丢弃', 'info')
}
onBeforeUnmount(() => clearTimeout(confirmTimer))
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <span class="page-kicker">行程 · {{ store.data.trips.length }} 条</span>
        <h1 class="page-title">今天要走的，都在这里</h1>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="navigate('/receive')">接收行程</button>
        <button class="btn btn-primary" @click="navigate('/import')">+ 导入行程</button>
      </div>
    </header>

    <div v-if="store.data.draft" class="draft-bar paper-card">
      <span class="draft-text">有一份没发完的行程草稿</span>
      <span class="draft-actions">
        <button class="btn btn-primary btn-sm" @click="navigate('/import')">继续编辑</button>
        <button class="btn btn-ghost btn-sm" @click="discardDraft">丢弃</button>
      </span>
    </div>

    <div class="search-row">
      <label class="search-label" for="trip-search">搜索</label>
      <input
        id="trip-search"
        v-model="query"
        type="search"
        placeholder="搜行程名 / 车次 / 站点"
        autocomplete="off"
      />
    </div>

    <ul v-if="filteredTrips.length" class="trip-list" ref="listRef">
      <li v-for="(t, i) in filteredTrips" :key="t.id" class="trip-row">
        <span class="trip-no" aria-hidden="true">{{ no2(i) }}</span>
        <div class="trip-main">
          <div class="trip-title-row">
            <h2 class="trip-title">{{ t.title || '未命名行程' }}</h2>
            <span class="trip-date">{{ t.startDate || '日期待定' }}</span>
          </div>
          <p class="trip-summary">{{ tripSummary(t) }}</p>
          <div v-if="issueCount(t, 'error') || issueCount(t, 'warn')" class="trip-issues">
            <span v-if="issueCount(t, 'error')" class="tag tag-err">{{ issueCount(t, 'error') }} 处待确认</span>
            <span v-if="issueCount(t, 'warn')" class="tag tag-warn">{{ issueCount(t, 'warn') }} 处提醒</span>
          </div>
          <div class="trip-actions">
            <button class="btn btn-primary btn-sm" @click="navigate('/trip/' + t.id)">查看</button>
            <button class="btn btn-ghost btn-sm" @click="navigate('/share/' + t.id)">分享</button>
            <button
              class="btn btn-danger btn-sm"
              :class="{ arming: confirmKey === 'trip:' + t.id }"
              @click="removeTripClick(t)"
            >{{ confirmKey === 'trip:' + t.id ? '确认删除？' : '删除' }}</button>
          </div>
        </div>
      </li>
    </ul>

    <section v-else-if="store.data.trips.length" class="no-match paper-card">
      <p>没有找到和「{{ query.trim() }}」有关的行程，换个关键词试试。</p>
    </section>

    <section v-else class="empty">
      <p class="kicker">空</p>
      <h2 class="empty-title">还没有行程</h2>
      <p class="empty-hint">把爸妈发来的短信、截图文字粘进来，一分钟生成一份能直接转发的行程。</p>
      <button class="btn btn-primary" @click="navigate('/import')">去导入第一份行程</button>
    </section>
  </div>
</template>

<style scoped>
.draft-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin-bottom: 14px;
  border-left: 3px solid var(--c-warn);
}
.draft-text { font-size: 14px; color: var(--c-ink-1); }
.draft-actions { display: flex; gap: 8px; }

.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.search-label { font-size: 14px; color: var(--c-ink-2); flex: none; }

.trip-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--c-line);
}
/* 编辑式列表行：编号 + 细线分隔，不再是一张一张的卡 */
.trip-row {
  display: flex;
  gap: 16px;
  padding: 20px 4px;
  border-bottom: 1px solid var(--c-line);
}
.trip-no {
  flex: none;
  padding-top: 3px;
  font-family: var(--f-mono);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--c-ink-2);
}
.trip-main { flex: 1; min-width: 0; }
.trip-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.trip-title {
  margin: 0;
  font-size: 19px;
  letter-spacing: 1px;
}
.trip-date { font-size: 13px; color: var(--c-ink-2); font-family: var(--f-mono); }
.trip-summary { margin: 6px 0 0; font-size: 14px; color: var(--c-ink-1); }
.trip-issues { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
.trip-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
