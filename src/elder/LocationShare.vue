<script setup>
// 位置共享：**只有长辈自己点一下才会传**，而且随时能停。
// 触发条件（两个都要满足）：子女在分享页打开了「允许长辈共享位置」+ 长辈在这里点了按钮。
//
// 为什么这么多判断：浏览器的定位必须 https（file:// 与 http 局域网都不给），
// 权限也可能被拒 —— 与其弹一个长辈看不懂的授权框，不如提前说清楚原因。
import { ref, onBeforeUnmount } from 'vue'
import { push, makeEvent } from '../core/sync.js'
import RealMap from '../components/RealMap.vue'

const props = defineProps({
  room: { type: String, default: '' },
  mode: { type: String, default: 'device' }, // 'server' | 'device'
  // 最近一个「该到了」的到达点（{ segId, at }）：随位置一起报给服务端，供平安到达比对
  eta: { type: Object, default: null },
})

const sharing = ref(false)
const note = ref('')
const updatedAt = ref(0)
// 自己的最新定位：既发给子女，也顺手画在自己的地图上（长辈自己能确认"就是这儿"）
const pos = ref(null)
let watchId = null
let lastSent = 0

function geolocationAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.geolocation
}

// 浏览器只在安全上下文里给定位：https、localhost、127.0.0.1
function secureContext() {
  if (typeof location === 'undefined') return false
  const h = String(location.hostname || '')
  return location.protocol === 'https:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
}

function stopWatch() {
  if (watchId != null && geolocationAvailable()) {
    try { navigator.geolocation.clearWatch(watchId) } catch {}
  }
  watchId = null
}

function onPosition(p) {
  const c = p && p.coords ? p.coords : null
  if (!c) return
  const now = Date.now()
  const presence = { lat: c.latitude, lng: c.longitude, acc: Math.round(c.accuracy || 0), at: now }
  // 到达点一起带上：服务端据此做「平安到达超时」比对（没有就不带）
  if (props.eta && props.eta.segId && Number.isFinite(Number(props.eta.at))) {
    presence.eta = { segId: String(props.eta.segId), at: Number(props.eta.at) }
  }
  // 地图随每一次定位刷新（画面是静态的，只是坐标变了）
  pos.value = { lat: c.latitude, lng: c.longitude, at: now }
  // 节流：60 秒最多送一次（first fix 立刻送）
  if (lastSent && now - lastSent < 60000) return
  lastSent = now
  updatedAt.value = now
  note.value = '正在让子女看到你的位置'
  push(props.room, [makeEvent('location', '')], presence)
}

function onError(e) {
  sharing.value = false
  stopWatch()
  note.value = e && e.code === 1
    ? '需要允许定位，子女才能看到你在哪'
    : '这次没拿到位置，等会儿再点一次'
}

function startShare() {
  if (!props.room) { note.value = '还没有可用的分享链接'; return }
  if (!geolocationAvailable()) { note.value = '这台设备不支持定位'; return }
  if (!secureContext()) { note.value = '这个链接不是 https，手机不让传位置'; return }
  note.value = '正在拿位置…'
  sharing.value = true
  try {
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: false,
      maximumAge: 30000,
      timeout: 20000,
    })
  } catch {
    sharing.value = false
    note.value = '这台设备不支持定位'
  }
}

function stopShare() {
  stopWatch()
  sharing.value = false
  lastSent = 0
  note.value = '已经停止共享位置，子女仍能看到最后一次位置'
  push(props.room, [makeEvent('loc-off', '')])
}

function toggle() {
  if (sharing.value) stopShare()
  else startShare()
}

onBeforeUnmount(() => {
  if (sharing.value) {
    stopWatch()
    push(props.room, [makeEvent('loc-off', '')])
  }
})
</script>

<template>
  <section class="loc" aria-label="位置共享">
    <p class="loc-title">让子女知道你在哪</p>
    <p class="loc-note">
      <template v-if="sharing">正在让子女看到你的位置<template v-if="updatedAt">（刚刚更新过）</template></template>
      <template v-else-if="note">{{ note }}</template>
      <template v-else>点一下，子女那边就能看到你在哪；不想让看了随时停。</template>
    </p>
    <p v-if="mode === 'device'" class="loc-warn">这台设备没接同步服务，只有同一台手机/电脑上的子女端能看到位置。</p>
    <RealMap
      v-if="pos"
      class="loc-map"
      :lat="Number(pos.lat)"
      :lng="Number(pos.lng)"
      label="你在这里"
      :height="220"
    />
    <button
      type="button"
      class="big-btn loc-btn"
      :class="{ 'loc-btn-on': sharing }"
      :aria-pressed="sharing"
      @click="toggle"
    >{{ sharing ? '停止共享位置' : '让子女看到我在哪' }}</button>
  </section>
</template>

<style scoped>
.loc {
  margin: 0 0 22px;
  padding: 20px 22px 22px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-top: 6px solid var(--el-stay);
  border-radius: var(--el-r);
  color: var(--el-ink);
}
.loc-title {
  margin: 0 0 8px;
  font-family: var(--f-sans);
  font-size: var(--el-fs-34);
  font-weight: 800;
  color: var(--el-ink);
}
.loc-note {
  margin: 0 0 16px;
  font-size: var(--el-fs-28);
  font-weight: 500;
  color: var(--el-ink-2);
  overflow-wrap: anywhere;
}
.loc-warn {
  margin: 0 0 16px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-28);
  font-weight: 600;
}
.loc-btn-on { border-color: var(--el-btn-line); }
.loc-map { display: block; margin: 0 0 16px; }
</style>