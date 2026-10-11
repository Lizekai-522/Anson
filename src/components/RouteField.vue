<script setup>
// 生成式「轨迹场」：一组从左向右汇入同一座车站的路线。
// 做法遵循 algorithmic-art 的确定性原则 —— 所有坐标都由同一个 seed 推导（mulberry32），
// 任何设备、任何一次刷新画出来的都是同一张图；参数化的是线数/高度/终点车道。
// 刻意不引 p5.js：为这一处装饰加 ~1MB 依赖，对一个要离线可用的 PWA 不划算。
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  height: { type: Number, default: 128 },
  routes: { type: Number, default: 12 },
  seed: { type: Number, default: 20260520 },
})

const host = ref(null)
const canvas = ref(null)
let raf = 0

// 确定性伪随机（mulberry32）：同 seed → 同序列
function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function draw() {
  const el = canvas.value
  const box = host.value
  if (!el || !box || !box.clientWidth) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = box.clientWidth
  const h = props.height
  el.width = Math.round(w * dpr)
  el.height = Math.round(h * dpr)
  el.style.width = w + 'px'
  el.style.height = h + 'px'
  const ctx = el.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const rnd = mulberry32(props.seed)
  const lanes = Math.max(2, props.routes)
  const padY = 14
  // 终点汇成三条"站台"，让这批线看起来是开进同一座车站
  const terminals = [h * 0.34, h * 0.5, h * 0.66]

  for (let i = 0; i < lanes; i++) {
    const y0 = padY + (h - padY * 2) * (i / (lanes - 1))
    const y1 = terminals[i % terminals.length] + (rnd() - 0.5) * 7
    const xTurn = w * (0.2 + rnd() * 0.34)
    const xJoin = w * (0.58 + rnd() * 0.24)
    const accent = i % 5 === 2
    ctx.beginPath()
    ctx.moveTo(-4, y0)
    ctx.lineTo(xTurn, y0)
    ctx.lineTo(xJoin, y1)
    ctx.lineTo(w + 4, y1)
    ctx.strokeStyle = accent ? 'rgba(11, 107, 69, 0.42)' : 'rgba(94, 99, 90, 0.24)'
    ctx.lineWidth = accent ? 1.6 : 1
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}

function schedule() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(draw)
}

onMounted(() => {
  schedule()
  window.addEventListener('resize', schedule)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', schedule)
})
</script>

<template>
  <div ref="host" class="route-field" :style="{ height: height + 'px' }">
    <canvas ref="canvas" aria-hidden="true"></canvas>
  </div>
</template>

<style scoped>
.route-field { position: relative; width: 100%; overflow: hidden; }
.route-field canvas { display: block; }
</style>