<script setup>
// 在线真实地图（OpenStreetMap 栅格瓦片）：只读展示一个坐标，不带拖拽与动画。
// 复用在两处：子女端「长辈现在在哪」，长辈端自己的「我在哪」。
// 瓦片是跨域图片，挂了就留白，不阻塞页面 —— 地图挂了也不该影响行程卡片。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { viewportTiles, fitPointsViewport, projectPixel, isValidLatLng, OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from '../core/map.js'

const props = defineProps({
  lat: { type: Number, default: NaN },
  lng: { type: Number, default: NaN },
  // 多点模式：传 [{ lat, lng, label?, order? }] 就自动取景并给每个点画编号标记（行程目的地用）
  points: { type: Array, default: () => [] },
  zoom: { type: Number, default: 15 },
  height: { type: Number, default: 200 },
  label: { type: String, default: '' },
  controls: { type: Boolean, default: true },
  emptyText: { type: String, default: '还没有位置' },
})

const box = ref(null)
const width = ref(360)
const z = ref(props.zoom)
let ro = null

function measure() {
  if (!box.value) return
  const r = box.value.getBoundingClientRect()
  if (r.width) width.value = Math.round(r.width)
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && box.value) {
    ro = new ResizeObserver(measure)
    ro.observe(box.value)
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', measure)
  }
})
onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  else if (typeof window !== 'undefined') window.removeEventListener('resize', measure)
})

function zoomIn() { z.value = Math.min(19, z.value + 1) }
function zoomOut() { z.value = Math.max(3, z.value - 1) }

const pointsMode = computed(() => Array.isArray(props.points) && props.points.length > 0)
const validPoints = computed(() => (props.points || []).filter((p) => p && isValidLatLng(p.lat, p.lng)))
const valid = computed(() => (pointsMode.value ? validPoints.value.length > 0 : isValidLatLng(props.lat, props.lng)))

const view = computed(() => {
  if (!valid.value) return { tiles: [], markers: [], marker: { left: 0, top: 0 } }
  // 多点：自动取景到能同时容下所有点，再给每个点算像素位置
  if (pointsMode.value) {
    const fit = fitPointsViewport({ points: validPoints.value, width: width.value, height: props.height })
    if (!fit) return { tiles: [], markers: [], marker: { left: 0, top: 0 } }
    const base = viewportTiles({ lat: fit.center.lat, lng: fit.center.lng, zoom: fit.zoom, width: width.value, height: props.height })
    const markers = validPoints.value.map((p, i) => {
      const px = projectPixel({ lat: p.lat, lng: p.lng, zoom: base.zoom, left: base.left, top: base.top }) || { left: 0, top: 0 }
      return { key: 'm' + i, left: px.left, top: px.top, order: p.order != null ? p.order : i + 1, label: p.label || '' }
    })
    return { tiles: base.tiles, markers, marker: { left: 0, top: 0 } }
  }
  const base = viewportTiles({ lat: props.lat, lng: props.lng, zoom: z.value, width: width.value, height: props.height })
  return { tiles: base.tiles, marker: base.marker, markers: [] }
})
</script>

<template>
  <div class="amap" ref="box" :style="{ height: height + 'px' }">
    <template v-if="valid">
      <img
        v-for="t in view.tiles"
        :key="t.key"
        class="amap-tile"
        :src="t.url"
        :style="{ left: t.left + 'px', top: t.top + 'px' }"
        width="256"
        height="256"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
      />
      <span v-if="!pointsMode" class="amap-marker" :style="{ left: view.marker.left + 'px', top: view.marker.top + 'px' }" aria-hidden="true"></span>
      <span
        v-for="m in view.markers" :key="m.key"
        class="amap-pin"
        :style="{ left: m.left + 'px', top: m.top + 'px' }"
      >
        <span class="amap-dot" :title="m.label"><span class="amap-dot-num" aria-hidden="true">{{ m.order }}</span></span>
        <span v-if="m.label" class="amap-pin-tag">{{ m.label }}</span>
      </span>
      <span v-if="label" class="amap-label">{{ label }}</span>
      <div v-if="controls && !pointsMode" class="amap-zoom">
        <button type="button" class="amap-zbtn" aria-label="缩小地图" @click="zoomOut">−</button>
        <button type="button" class="amap-zbtn" aria-label="放大地图" @click="zoomIn">＋</button>
      </div>
      <a class="amap-attr" :href="OSM_COPYRIGHT_URL" target="_blank" rel="noopener">{{ OSM_ATTRIBUTION }}</a>
    </template>
    <p v-else class="amap-empty">{{ emptyText }}</p>
  </div>
</template>

<style scoped>
/* 地图自带底色与描边；不依赖 --el-* / --c-*，两端外壳里都长得一样 */
.amap {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: #E7EAE5;
  border: 1px solid #C6CAC2;
  border-radius: var(--el-r, 12px);
}
.amap-tile { position: absolute; display: block; width: 256px; height: 256px; }
.amap-marker {
  position: absolute;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: #B3261E;
  border: 3px solid #FFFFFF;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
}
/* 多点模式：带序号 + 地名标签的标记；translate(-13px,-50%) 让圆点正中落在坐标上 */
.amap-pin {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 5px;
  transform: translate(-13px, -50%);
}
.amap-dot {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #0B6B45;
  border: 3px solid #FFFFFF;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.amap-dot-num { color: #FFFFFF; font-size: 13px; font-weight: 700; line-height: 1; }
/* 地名：直接显示在图上，不用悬停也知道这是哪 */
.amap-pin-tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  color: #101210;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.amap-label {
  position: absolute;
  left: 8px;
  top: 8px;
  max-width: calc(100% - 16px);
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #101210;
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.amap-zoom { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; gap: 6px; }
.amap-zbtn {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #BFC4BB;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  color: #101210;
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
}
.amap-attr {
  position: absolute;
  right: 4px;
  bottom: 2px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.78);
  color: #3E423C;
  font-size: 11px;
}
.amap-empty {
  margin: 0;
  padding: 40px 12px;
  text-align: center;
  font-size: 14px;
  color: #5E635A;
}
</style>