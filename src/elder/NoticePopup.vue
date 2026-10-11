<script setup>
// 出发提醒弹窗（页内，不做系统通知）。
// 长辈端零动画硬约束：这里只写布局，绝不写 animation / transition。
// 一次只弹最近的一条；如果还有别的要提醒，底部如实说一句。
defineProps({
  countdown: { type: String, default: '' },
  title: { type: String, default: '' },
  detail: { type: String, default: '' },
  more: { type: Number, default: 0 },
})
const emit = defineEmits(['jump', 'dismiss'])
</script>

<template>
  <div class="notice-mask" role="alertdialog" aria-modal="true" aria-label="出发提醒">
    <div class="notice-box">
      <p class="notice-kicker">快出发了</p>
      <p class="notice-countdown">{{ countdown }}</p>
      <p class="notice-title">{{ title }}</p>
      <p v-if="detail" class="notice-detail">{{ detail }}</p>
      <div class="notice-actions">
        <button type="button" class="big-btn notice-go" @click="emit('jump')">去看看</button>
        <button type="button" class="big-btn notice-ok" @click="emit('dismiss')">知道了</button>
      </div>
      <p v-if="more > 0" class="notice-more">还有 {{ more }} 段也要提醒</p>
    </div>
  </div>
</template>

<style scoped>
/* 遮罩：静态覆盖，不做淡入 */
.notice-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.72);
}
.notice-box {
  width: 100%;
  max-width: 560px;
  padding: 28px 24px 24px;
  background: var(--el-card);
  border: 4px solid var(--el-accent);
  border-radius: var(--el-r);
  color: var(--el-ink);
}
.notice-kicker {
  margin: 0 0 10px;
  font-size: var(--el-fs-30);
  font-weight: 700;
  color: var(--el-ink-2);
  letter-spacing: 2px;
}
.notice-countdown {
  margin: 0 0 16px;
  font-family: var(--f-sans);
  font-size: var(--el-fs-44);
  font-weight: 800;
  line-height: 1.2;
  color: var(--el-ink);
  overflow-wrap: anywhere;
}
.notice-title {
  display: inline-block;
  max-width: 100%;
  margin: 0 0 12px;
  padding: 6px 18px;
  border-radius: 999px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-34);
  font-weight: 700;
  letter-spacing: 1px;
  overflow-wrap: anywhere;
}
.notice-detail {
  margin: 0 0 20px;
  font-size: var(--el-fs-30);
  font-weight: 500;
  color: var(--el-ink-2);
  overflow-wrap: anywhere;
}
.notice-actions { display: grid; gap: 14px; margin-top: 22px; }
.notice-more {
  margin: 16px 0 0;
  font-size: var(--el-fs-28);
  font-weight: 600;
  color: var(--el-ink-2);
}
</style>