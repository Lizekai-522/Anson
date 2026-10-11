<script setup>
// 在线真实地图（OpenStreetMap 栅格瓦片）：只读展示一个坐标，不带拖拽与动画。
// 复用在两处：子女端「长辈现在在哪」，长辈端自己的「我在哪」。
// 瓦片是跨域图片，挂了就留白，不阻塞页面 —— 地图挂了也不该影响行程卡片。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { viewportTiles, isValidLatLng, OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from '../core/map.js'

const props = defineProps({
  lat: { type: Number, default: NaN },
  lng: { type: Number, default: NaN },
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

const valid = computed(() => isValidLatLng(props.lat, props.lng))
const view = computed(() => {
  if (!valid.value) return { tiles: [], marker: { left: 0, top: 0 } }
  return viewportTiles({ lat: props.lat, lng: props.lng, zoom: z.value, width: width.value, height: props.height })
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
      <span class="amap-marker" :style="{ left: view.marker.left + 'px', top: view.marker.top + 'px' }" aria-hidden="true"></span>
      <span v-if="label" class="amap-label">{{ label }}</span>
      <div v-if="controls" class="amap-zoom">
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