<script setup>
// 行程页：一页只讲一件事 —— 这趟怎么走。
// 整趟行程从头到尾都列出来，跨天的那几段在卡片上标日期，长辈只要往下看就不会漏。
// 页头是一句大字陈述（"一共 3 段行程"），不放产品名、不放 logo、不放装饰图标。
//
// 卡片不再是「一整块按钮」：按钮里不能再套按钮（HTML 无效，点击事件还会串）。
// 现在卡片是 section，里面放两个独立按钮 —— 左边「展开/收起」，右边「走完了」。
// 走完的那一段压成一行，但仍然保留卡片的底、描边与顶线（还是原来的卡片）。
import { ref, computed, watch } from 'vue'
import { cardKey, cardAria, cardNo, timeRange, dayText } from './elder-shared.js'

const props = defineProps({
  cards: { type: Array, default: () => [] },
  today: { type: String, default: '' },
  tripTitle: { type: String, default: '' },
  dateText: { type: String, default: '' },
  speaking: { type: Boolean, default: false },
  speechUnsupported: { type: Boolean, default: false },
  // 完成 / 折叠状态由外层持有（它要负责持久化与回传给子女端）
  doneMap: { type: Object, default: () => ({}) },
  collapsedMap: { type: Object, default: () => ({}) },
  // 「到了之后做什么」清单的打勾状态：键 `${卡片键}:todo:序号`（外层按 room 持久化）
  todosMap: { type: Object, default: () => ({}) },
  // 从提醒弹窗跳过来时要高亮的那一段
  highlightSegId: { type: String, default: '' },
  // 「接下来您要去这里」标在哪一段（勾完自动引导）
  nextSegId: { type: String, default: '' },
  // 「离 09:35 出发还有 …」——由外层定时器算好传进来
  nextText: { type: String, default: '' },
  // 播报语言与降级提示
  voice: { type: String, default: 'zh' },
  voiceNotice: { type: String, default: '' },
  // 平安到达本机提醒文案（空串＝不显示）
  arriveText: { type: String, default: '' },
})
const emit = defineEmits(['speak', 'toggle-done', 'toggle-collapse', 'toggle-todo', 'pick-voice', 'save-poster', 'arrive-ok'])

// 优先级三档的可见标签：色块只是装饰，真正表意的是这几个字（色 + 字双通道）
const LEVEL_TEXT = { high: '重要', normal: '普通', low: '随手' }

// 页头报总数；只有全部段都在今天时才说"今天"
const headline = computed(() => {
  if (!props.cards.length) return '暂时没有安排'
  const allToday = props.cards.every((c) => c && c.date === props.today)
  return allToday ? `今天 ${props.cards.length} 段行程` : `一共 ${props.cards.length} 段行程`
})
const canSpeak = computed(() => props.cards.some((c) => c && c.voice))

function key(c, i) { return cardKey(c, i) }
function isDone(c, i) { return !!props.doneMap[key(c, i)] }
function isCollapsed(c, i) { return !!props.collapsedMap[key(c, i)] }
function bodyId(c, i) { return 'cardbody-' + key(c, i) }
function isTodoDone(c, i, ti) { return !!props.todosMap[`${key(c, i)}:todo:${c.todos[ti]?.stableId ? c.todos[ti].id : ti}`] }
function todosOf(c) { return (c && Array.isArray(c.todos)) ? c.todos : [] }

// 跳转高亮：滚到那张卡（behavior 必须是 auto —— 长辈端不允许任何动效）
const cardRefs = ref({})
function setCardRef(k) {
  return (el) => {
    if (el) cardRefs.value[k] = el
    else delete cardRefs.value[k]
  }
}
watch(() => props.highlightSegId, (k) => {
  if (!k) return
  const el = cardRefs.value[k]
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'auto' })
})
</script>

<template>
  <section class="view" aria-label="行程">
    <!-- 紧急求助等常驻块由外层注入（放在最上面，长辈一眼就能找到） -->
    <slot name="top" />

    <header class="view-head">
      <p class="view-date">{{ dateText }}</p>
      <h1 class="elder-h1">{{ headline }}</h1>
      <p v-if="tripTitle" class="view-sub">{{ tripTitle }}</p>
    </header>

    <p v-if="nextText" class="card-countdown">{{ nextText }}</p>

    <!-- 播报语言：普通话 / 闽南话（长辈自己的选择，存在本机） -->
    <div class="seg" role="group" aria-label="播报语言">
      <button
        type="button"
        class="seg-btn"
        :class="{ on: voice !== 'nan' }"
        :aria-pressed="voice !== 'nan'"
        @click="emit('pick-voice', 'zh')"
      >普通话</button>
      <button
        type="button"
        class="seg-btn"
        :class="{ on: voice === 'nan' }"
        :aria-pressed="voice === 'nan'"
        @click="emit('pick-voice', 'nan')"
      >闽南话</button>
    </div>

    <button
      v-if="canSpeak"
      type="button"
      class="big-btn listen-btn"
      :aria-label="speaking ? '停止语音播报' : (voice === 'nan' ? '用闽南话听一遍今天的行程' : '听一遍今天的行程')"
      @click="emit('speak')"
    >{{ speaking ? '停止播报' : '听一遍' }}</button>

    <button
      v-if="cards.length"
      type="button"
      class="back-btn poster-btn"
      @click="emit('save-poster')"
    >存成长图（可以打印或发给别人）</button>

    <p v-if="voiceNotice" class="voice-unsupported" role="status">{{ voiceNotice }}</p>

    <!-- 平安到达：过了预计到达时刻还没确认，长辈端本机就提醒一句 -->
    <div v-if="arriveText" class="arrive-banner" role="status">
      <span class="arrive-text">{{ arriveText }}</span>
      <button type="button" class="arrive-ok" @click="emit('arrive-ok')">好，我知道了</button>
    </div>

    <section
      v-for="(c, i) in cards"
      :key="key(c, i)"
      :ref="setCardRef(key(c, i))"
      class="card"
      :class="{
        'card-stay': c.kind === 'stay',
        'card-play': c.kind === 'play',
        'card-done': isDone(c, i),
        'card-collapsed': isCollapsed(c, i),
        'card-focus': highlightSegId === key(c, i) || nextSegId === key(c, i),
      }"
    >
      <!-- 「接下来您要去这里」：勾完上一段后自动标出来 -->
      <p v-if="nextSegId === key(c, i) && !isDone(c, i)" class="next-pill">接下来您要去这里</p>

      <div class="card-head">
        <!-- 走完了：压成一行，不再是可展开的卡片正文 -->
        <div v-if="isDone(c, i)" class="card-done-line">
          <span class="card-no" aria-hidden="true">{{ cardNo(i) }}</span>
          <span v-if="c.code" class="card-code">{{ c.code }}</span>
          <span class="card-title card-title-done">{{ c.title || '' }}</span>
          <span v-if="timeRange(c)" class="card-line3">{{ timeRange(c) }}</span>
          <span class="card-done-tag">已走完</span>
        </div>

        <button
          v-else
          type="button"
          class="card-toggle"
          :aria-expanded="!isCollapsed(c, i)"
          :aria-controls="bodyId(c, i)"
          :aria-label="cardAria(c, i, !isCollapsed(c, i), false)"
          @click="emit('toggle-collapse', { key: key(c, i), index: i })"
        >
          <span class="card-title-row">
            <span class="card-no" aria-hidden="true">{{ cardNo(i) }}</span>
            <span v-if="c.code" class="card-code">{{ c.code }}</span>
            <span class="card-title">{{ c.title || '' }}</span>
          </span>
          <span v-if="c.date && c.date !== today" class="card-day">{{ dayText(c.date) }}</span>
          <span v-if="timeRange(c)" class="card-line3">{{ timeRange(c) }}</span>
          <!-- 目的地天气（子女那边查好后随链接带过来；没有就不显示） -->
          <span v-if="c.weather" class="weather-pill">{{ c.weather }}</span>
        </button>

        <button
          type="button"
          class="card-done-btn"
          :aria-pressed="isDone(c, i)"
          :aria-label="isDone(c, i) ? '把这一段改回没走完' : '把这一段标成走完了'"
          @click="emit('toggle-done', { key: key(c, i), index: i })"
        >{{ isDone(c, i) ? '改回没走完' : '走完了' }}</button>
      </div>

      <div v-if="!isDone(c, i)" v-show="!isCollapsed(c, i)" :id="bodyId(c, i)" class="card-body">
        <!-- 出站后往哪走：子女填的到达指引，置顶显示（深底白字最醒目） -->
        <div v-if="c.guide" class="guide">
          <span class="g-t">出站后往哪走（子女填的）</span>
          <span class="g-b">{{ c.guide }}</span>
        </div>

        <!-- 游玩安排：讲的是"到这里做什么"，不画 from→to 的路线 -->
        <template v-if="c.kind === 'play'">
          <span v-if="c.timeOfDay || c.to" class="play-head">
            <span v-if="c.timeOfDay" class="play-time">{{ c.timeOfDay }}</span>
            <span v-if="c.to" class="play-place">{{ c.to }}</span>
          </span>
          <span v-if="c.note" class="play-note">{{ c.note }}</span>
        </template>
        <span v-else-if="c.kind !== 'stay'" class="card-line2">
          <span class="route-part">{{ c.from || '' }}</span>
          <span class="route-arrow" aria-hidden="true">→</span>
          <span class="route-part">{{ c.to || '' }}</span>
        </span>

        <!-- 到了之后做什么：整行都是按钮，勾一下子女端就能看到 -->
        <span v-if="todosOf(c).length" class="todo-block">
          <span class="todo-label">到了之后做什么</span>
          <button
            v-for="(t, ti) in todosOf(c)"
            :key="ti"
            type="button"
            class="todo-row"
            :class="['todo-lv-' + (t.level || 'normal'), { 'todo-row-done': isTodoDone(c, i, ti) }]"
            :aria-pressed="isTodoDone(c, i, ti)"
            :aria-label="`${isTodoDone(c, i, ti) ? '已做' : '没做'}：${t.text}，点一下改成${isTodoDone(c, i, ti) ? '没做' : '做了'}`"
            @click="emit('toggle-todo', { key: key(c, i), index: ti, taskId: t.stableId ? t.id : '', text: t.text })"
          >
            <span class="todo-mark" aria-hidden="true">{{ isTodoDone(c, i, ti) ? '✓' : '' }}</span>
            <span class="todo-text">{{ t.text }}</span>
            <span class="todo-level">{{ LEVEL_TEXT[t.level] || '普通' }}</span>
          </button>
        </span>

        <span v-if="c.tips && c.tips.length" class="card-hint">可以点上面的字，收起来只看一行</span>
        <span v-if="c.tips && c.tips.length" class="tips">
          <span v-for="(t, ti) in c.tips" :key="ti" class="tip">· {{ t }}</span>
        </span>
      </div>
    </section>

    <p v-if="!cards.length" class="rest">暂时没有安排，好好休息</p>
    <p v-if="speechUnsupported" class="voice-unsupported">这台设备不支持语音播报</p>
  </section>
</template>

<style scoped>
.view { display: block; }

.view-head { margin: 0 0 22px; }
.view-date {
  margin: 0 0 8px;
  font-size: var(--el-fs-30);
  font-weight: 600;
  color: var(--el-ink-2);
}
.elder-h1 {
  margin: 0;
  font-family: var(--f-sans);
  font-size: var(--el-fs-44);
  line-height: 1.28;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--el-ink);
}
.view-sub { margin: 10px 0 0; font-size: var(--el-fs-28); font-weight: 500; color: var(--el-ink-2); }

/* 下一段还有多久：纯静态文本，不可点（避免和卡片抢点击） */
.card-countdown {
  display: inline-block;
  max-width: 100%;
  margin: 0 0 20px;
  padding: 8px 20px;
  border-radius: 999px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-34);
  font-weight: 700;
  letter-spacing: 1px;
  overflow-wrap: anywhere;
}

/* 听一遍：本页唯一的主操作，和卡片拉开距离，避免误触 */
.listen-btn { margin: 0 0 24px; }

/* ---- 播报语言：普通话 / 闽南话 ---- */
.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0 0 18px; }
.seg-btn {
  min-height: calc(68px * var(--el-scale));
  padding: 8px 10px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-28);
  font-weight: 700;
}
.seg-btn.on {
  background: var(--el-btn-bg);
  border-color: var(--el-btn-line);
  color: var(--el-btn-ink);
}

/* 存成长图：次操作，白底描边，和主操作区分开 */
.poster-btn { margin: 0 0 22px; }

/* ---- 「接下来您要去这里」 ---- */
.next-pill {
  display: inline-block;
  max-width: 100%;
  margin: 0 0 14px;
  padding: 6px 18px;
  border-radius: 999px;
  background: var(--el-accent);
  color: #FFFFFF;
  font-size: var(--el-fs-28);
  font-weight: 800;
  letter-spacing: 1px;
}

/* ---- 目的地天气 ---- */
.weather-pill {
  display: inline-block;
  max-width: 100%;
  margin-top: 10px;
  padding: 4px 16px;
  border: 2px solid var(--el-line);
  border-radius: 999px;
  font-size: var(--el-fs-28);
  font-weight: 700;
  color: var(--el-ink);
  overflow-wrap: anywhere;
}

/* ---- 出站后往哪走：置顶深底白字 ---- */
.guide {
  margin: 0 0 16px;
  padding: 14px 18px;
  border-radius: var(--el-r);
  background: var(--el-tint);
  color: var(--el-tint-ink);
}
.g-t {
  display: block;
  margin-bottom: 6px;
  font-size: var(--el-fs-28);
  font-weight: 700;
  letter-spacing: 1px;
  opacity: 0.85;
}
.g-b {
  display: block;
  font-size: var(--el-fs-30);
  font-weight: 700;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

/* ---- 平安到达本机提醒 ---- */
.arrive-banner {
  margin: 0 0 20px;
  padding: 16px 18px;
  border: 2px solid var(--el-line);
  border-left-width: 8px;
  border-left-color: var(--el-danger);
  border-radius: var(--el-r);
  background: var(--el-card);
}
.arrive-text {
  display: block;
  font-size: var(--el-fs-30);
  font-weight: 700;
  line-height: 1.45;
  color: var(--el-ink);
  overflow-wrap: anywhere;
}
.arrive-ok {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: calc(72px * var(--el-scale));
  margin-top: 14px;
  padding: 8px 16px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-30);
  font-weight: 700;
}

/* 行程卡：白底是触控需要，但不再有圆图标和左强调条 ——
   改用粗顶线 + 编号 + 大号车次来立结构。 */
.card {
  display: block;
  width: 100%;
  min-height: 120px;
  margin: 0 0 20px;
  padding: 20px 22px 22px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-top: 6px solid var(--el-accent);
  border-radius: var(--el-r);
  color: var(--el-ink);
  text-align: left;
  font-size: var(--el-fs-30);
  line-height: 1.5;
}
.card-stay { border-top-color: var(--el-stay); }

/* 从提醒弹窗跳过来时的高亮：静态描边，不做任何动画 */
.card-focus { border-color: var(--el-accent); border-width: 4px; border-top-width: 6px; }

/* 卡片头：左边展开/收起，右边「走完了」。窄屏时右边的按钮落到下一行。 */
.card-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 12px; min-width: 0; }
.card-toggle {
  flex: 1 1 240px;
  min-width: 0;
  display: block;
  padding: 4px 0;
  background: transparent;
  border: 0;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
  text-align: left;
}
.card-done-btn {
  flex: none;
  min-height: 68px;
  min-width: 168px;
  padding: 10px 16px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-28);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.card-title-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; min-width: 0; }
.card-title-row > * { min-width: 0; }
.card-no {
  font-family: var(--f-mono);
  font-size: var(--el-fs-28);
  font-weight: 700;
  color: var(--el-ink-2);
  letter-spacing: 1px;
}
/* 车次/航班号是长辈最需要核对的信息：最大最粗 */
.card-code { font-size: var(--el-fs-36); font-weight: 700; letter-spacing: 1.5px; overflow-wrap: anywhere; word-break: break-word; }
.card-title { font-size: var(--el-fs-30); font-weight: 600; overflow-wrap: anywhere; word-break: break-word; }

/* 跨天段落的日期标（同一天的段不标，避免一整列重复） */
.card-day {
  display: inline-block;
  max-width: 100%;
  margin-top: 12px;
  padding: 4px 16px;
  border: 2px solid var(--el-line);
  border-radius: 999px;
  font-size: var(--el-fs-28);
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--el-ink);
  overflow-wrap: anywhere;
}

/* ---- 完成态：压成一行，但保留卡片的底 / 描边 / 顶线 ---- */
.card-done { min-height: 0; padding: 14px 18px; border-top-color: var(--el-ink-2); }
.card-done-line {
  flex: 1 1 240px;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 12px;
}
.card-title-done { text-decoration: line-through; }
.card-done-tag {
  flex: none;
  padding: 2px 14px;
  border: 2px solid var(--el-line);
  border-radius: 999px;
  font-size: var(--el-fs-28);
  font-weight: 700;
  color: var(--el-ink-2);
  overflow-wrap: anywhere;
}

.card-body { margin-top: 12px; }

/* ---- 游玩安排：时段胶囊 + 地点 + 攻略说明 ---- */
.play-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.play-time {
  display: inline-block;
  padding: 4px 16px;
  border-radius: 999px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-28);
  font-weight: 700;
}
.play-place { font-size: var(--el-fs-32); font-weight: 700; overflow-wrap: anywhere; word-break: break-word; }
.play-note {
  display: block;
  margin-top: 12px;
  font-size: var(--el-fs-28);
  font-weight: 500;
  line-height: 1.6;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* ---- 到了之后做什么：整行按钮，勾一下子女端就能看到 ---- */
.todo-block {
  display: block;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 2px dashed var(--el-line);
}
.todo-label {
  display: block;
  margin-bottom: 10px;
  font-size: var(--el-fs-28);
  font-weight: 700;
  color: var(--el-ink-2);
}
.todo-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: calc(68px * var(--el-scale));
  margin: 0 0 10px;
  padding: 8px 14px;
  background: var(--el-card);
  border: 2px solid var(--el-line);
  border-left-width: 8px;
  border-radius: var(--el-r);
  color: var(--el-ink);
  font-size: var(--el-fs-30);
  font-weight: 600;
  text-align: left;
}
.todo-row:last-child { margin-bottom: 0; }
/* 优先级只体现在左边色条（装饰）；文字标签「重要/普通/随手」才是真正的双通道 */
.todo-lv-high { border-left-color: var(--el-todo-high); }
.todo-lv-normal { border-left-color: var(--el-todo-normal); }
.todo-lv-low { border-left-color: var(--el-todo-low); }
.todo-mark {
  flex: none;
  width: calc(42px * var(--el-scale));
  height: calc(42px * var(--el-scale));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--el-line);
  border-radius: 8px;
  font-size: var(--el-fs-28);
  font-weight: 700;
}
.todo-text { flex: 1; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.todo-level { flex: none; font-size: var(--el-fs-28); font-weight: 700; color: var(--el-ink-2); }
.todo-row-done .todo-text { text-decoration: line-through; color: var(--el-ink-2); }
.todo-row-done .todo-mark { border-color: var(--el-ink-2); color: var(--el-ink-2); }

.card-line2 { display: flex; flex-wrap: wrap; align-items: baseline; font-size: var(--el-fs-32); font-weight: 600; min-width: 0; }
/* 站名不再禁止断行：长站名允许折行，但不允许把卡片撑破 */
.route-part { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.route-arrow { margin: 0 10px; }
/* 时间胶囊 */
.card-line3 {
  display: inline-block;
  max-width: 100%;
  margin-top: 10px;
  padding: 6px 18px;
  border-radius: 999px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-34);
  font-weight: 700;
  letter-spacing: 1px;
  overflow-wrap: anywhere;
}
.card-hint {
  display: block;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 2px dashed var(--el-line);
  font-size: var(--el-fs-28);
  font-weight: 600;
  color: var(--el-ink-2);
}
.tips { display: block; margin-top: 10px; }
.tip { display: block; font-size: var(--el-fs-28); font-weight: 500; line-height: 1.6; overflow-wrap: anywhere; word-break: break-word; }

.rest {
  margin: 0 0 20px;
  padding: 40px 0;
  border-top: 2px solid var(--el-line);
  border-bottom: 2px solid var(--el-line);
  font-family: var(--f-sans);
  font-size: var(--el-fs-36);
  font-weight: 800;
  color: var(--el-ink);
  text-align: center;
}
.voice-unsupported {
  margin: 0 0 18px;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--el-tint);
  color: var(--el-tint-ink);
  font-size: var(--el-fs-28);
  font-weight: 600;
}
</style>