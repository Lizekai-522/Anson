<script setup>
// 显示设置页：单独一页，字大小与主题各一排大按钮。
// 长辈自己调过就存在本机（优先级高于子女分享时预设的）。
// 页面底部还有「回到主页面」：子女拿手机核对完长辈端，得能退出去（长辈端本身没有登录）。
import { ELDER_SCALES, ELDER_THEMES, elderScaleName, elderThemeName } from '../core/store.js'

const props = defineProps({
  scale: { type: Number, default: 1 },
  theme: { type: String, default: 'day' },
  // 屏幕常亮（看行程时不熄屏）；浏览器不支持 navigator.wakeLock 时整行不显示
  wake: { type: Boolean, default: true },
  supportsWake: { type: Boolean, default: true },
  // 勾完「走完了」自动读一句「接下来您要去…」
  autoRead: { type: Boolean, default: true },
})
const emit = defineEmits(['pick', 'back', 'exit'])

// 每次只改一项，其余原样带回去（外层会合并后再落盘）
function pick(part) {
  emit('pick', { scale: props.scale, theme: props.theme, wake: props.wake, autoRead: props.autoRead, ...part })
}
</script>

<template>
  <section class="view" aria-label="显示设置">
    <header class="view-head">
      <p class="view-date">调好了会记住</p>
      <h1 class="elder-h1">字大一点，看得清</h1>
    </header>

    <button type="button" class="back-btn" @click="emit('back')">返回行程</button>

    <div class="opt-row">
      <span class="opt-label">字大小</span>
      <div class="opt-group" role="group" aria-label="字大小">
        <button
          v-for="s in ELDER_SCALES" :key="s"
          type="button"
          class="opt-btn"
          :class="{ active: scale === s }"
          :aria-pressed="scale === s"
          @click="pick({ scale: s })"
        >{{ elderScaleName(s) }}</button>
      </div>
    </div>

    <div class="opt-row">
      <span class="opt-label">主题</span>
      <div class="opt-group" role="group" aria-label="主题">
        <button
          v-for="t in ELDER_THEMES" :key="t"
          type="button"
          class="opt-btn"
          :class="{ active: theme === t }"
          :aria-pressed="theme === t"
          @click="pick({ theme: t })"
        >{{ elderThemeName(t) }}</button>
      </div>
    </div>

    <!-- 屏幕常亮：默认只在看行程时申请；觉得费电可以随时关掉，控制权在长辈手上 -->
    <div v-if="supportsWake" class="set-row">
      <span class="set-t">屏幕常亮<span class="set-d">看行程的时候，屏幕不会自己熄灭</span></span>
      <button
        type="button"
        class="switch"
        :class="{ on: wake }"
        role="switch"
        :aria-checked="wake"
        aria-label="屏幕常亮"
        @click="pick({ wake: !wake })"
      >
        <span class="switch-track"><span class="switch-knob"></span></span>
      </button>
    </div>

    <div class="set-row">
      <span class="set-t">勾完自动读下一段<span class="set-d">勾了「走完了」，就念一句接下来去哪</span></span>
      <button
        type="button"
        class="switch"
        :class="{ on: autoRead }"
        role="switch"
        :aria-checked="autoRead"
        aria-label="勾完自动读下一段"
        @click="pick({ autoRead: !autoRead })"
      >
        <span class="switch-track"><span class="switch-knob"></span></span>
      </button>
    </div>

    <p class="set-note">手机不支持屏幕常亮时，这一行会自动藏起来，不会弹提示</p>

    <p class="install-note">
      想装到桌面上：让子女在浏览器菜单里点「添加到主屏幕」。以后点桌面的「安」字图标就能看行程，不用再记网址。
    </p>

    <!-- 回到主页面：子女用长辈端核对完，一键退回安程首页；长辈自己看也不会误触 -->
    <div class="exit-block">
      <p class="exit-hint">核对没问题了，就回到安程主页面</p>
      <button type="button" class="big-btn" @click="emit('exit')">回到主页面</button>
    </div>
  </section>
</template>

<style scoped>
.view { display: block; }

.view-head { margin: 0 0 22px; }
.view-date { margin: 0 0 8px; font-size: var(--el-fs-30); font-weight: 600; color: var(--el-ink-2); }
.elder-h1 {
  margin: 0;
  font-family: var(--f-sans);
  font-size: var(--el-fs-44);
  line-height: 1.28;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--el-ink);
}

/* 返回按钮样式在 global.css（跨视图复用） */

.opt-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 0;
  border-bottom: 2px solid var(--el-line);
}
.opt-label { font-size: var(--el-fs-30); font-weight: 700; color: var(--el-ink); }
.opt-group { display: flex; gap: 12px; }
.opt-btn {
  flex: 1;
  min-height: var(--el-hit-sm);
  padding: 8px 10px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-30);
  font-weight: 700;
}
.opt-btn.active {
  background: var(--el-btn-bg);
  border-color: var(--el-btn-line);
  color: var(--el-btn-ink);
}

/* 回到主页面：和字号/主题拉开距离，避免误触 */
.exit-block {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 2px solid var(--el-line);
}
.exit-hint {
  margin: 0 0 16px;
  font-size: var(--el-fs-28);
  font-weight: 600;
  color: var(--el-ink-2);
}

/* ---- 行为开关（屏幕常亮 / 勾完自动读）---- */
.set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 0;
  border-top: 2px solid var(--el-line);
}
.set-t { font-size: var(--el-fs-30); font-weight: 700; line-height: 1.35; }
.set-d { display: block; margin-top: 4px; font-size: var(--el-fs-28); font-weight: 500; color: var(--el-ink-2); }
/* 开关本体也是按钮：触控区 ≥60px 高；滑块位移用 left 变化表达（不写 transition） */
.switch {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: calc(60px * var(--el-scale));
  padding: 0 2px;
  background: transparent;
  border: 0;
}
.switch-track {
  position: relative;
  display: block;
  width: calc(72px * var(--el-scale));
  height: calc(42px * var(--el-scale));
  border-radius: 999px;
  background: var(--el-line);
}
.switch.on .switch-track { background: var(--el-accent); }
.switch-knob {
  position: absolute;
  top: calc(5px * var(--el-scale));
  left: calc(5px * var(--el-scale));
  width: calc(32px * var(--el-scale));
  height: calc(32px * var(--el-scale));
  border-radius: 50%;
  background: #FFFFFF;
}
.switch.on .switch-knob { left: calc(35px * var(--el-scale)); }

.set-note {
  margin: 14px 0 0;
  font-size: var(--el-fs-28);
  font-weight: 500;
  color: var(--el-ink-2);
}
.install-note {
  margin: 14px 0 0;
  padding: 14px 18px;
  border-radius: var(--el-r);
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-28);
  font-weight: 600;
  line-height: 1.5;
}
</style>