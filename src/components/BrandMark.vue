<script setup>
// 品牌标记「安程」。
// 几何语言：一条从出发到抵达的路线 —— 起点实心圆、一段平路、再爬升到终点圆环（"走得稳，到得了"）。
// 构造是参数化的（同一套坐标复用到 favicon / PWA 图标 / 字标），纯几何、单色 currentColor、
// 无渐变无阴影：16px 下仍能辨认，也不依赖任何图形库。
defineProps({
  size: { type: Number, default: 22 },
  tone: { type: String, default: 'brand' }, // brand | ink | inverse
  label: { type: String, default: '安程' },
})
</script>

<template>
  <svg
    class="brand-mark"
    :class="'tone-' + tone"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    role="img"
    :aria-label="label"
    focusable="false"
  >
    <path
      d="M4.6 19.2 H11.2 L17 9.4"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle cx="4.6" cy="19.2" r="2.5" fill="currentColor" />
    <circle cx="18.8" cy="6.4" r="2.4" fill="none" stroke="currentColor" stroke-width="2.2" />
  </svg>
</template>

<style scoped>
.brand-mark { display: block; flex: none; }
.tone-brand { color: var(--c-brand); }
.tone-ink { color: var(--c-ink-0); }
.tone-inverse { color: #F6F7F5; }
</style>