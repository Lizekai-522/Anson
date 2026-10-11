// 长辈端本地任务状态：哪一段走完了 / 哪一段收起来了 / 哪条提醒已经点掉了。
// 设备级、按 room 隔离（room 由分享 token 派生），刷新后还在。
//
// 为什么单独一个模块：它是纯数据变换，不碰 DOM，方便单测；
// 同时 localStorage 里的脏数据不许把长辈端搞成看不清的样子 —— 所以一律白名单校验。
import { KEYS, safeGet, safeSet } from './store.js'

function emptyState() {
  return { done: {}, collapsed: {}, dismissed: {}, todos: {} }
}

// 只保留「键是字符串、值是数字」的项，其余一律丢掉
function cleanMap(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out = {}
  for (const k of Object.keys(v)) {
    if (typeof k !== 'string' || !k) continue
    const n = Number(v[k])
    if (!Number.isFinite(n)) continue
    out[k] = n
  }
  return out
}

export function loadElderState(room) {
  if (!room) return emptyState()
  const raw = safeGet(KEYS.elderState(room), null)
  if (!raw || typeof raw !== 'object') return emptyState()
  return {
    done: cleanMap(raw.done),
    collapsed: cleanMap(raw.collapsed),
    dismissed: cleanMap(raw.dismissed),
    todos: cleanMap(raw.todos),
  }
}

export function saveElderState(room, state) {
  if (!room) return emptyState()
  // 落库前再过一遍白名单：脏数据不许进 localStorage
  const next = {
    done: cleanMap(state && state.done),
    collapsed: cleanMap(state && state.collapsed),
    dismissed: cleanMap(state && state.dismissed),
    todos: cleanMap(state && state.todos),
  }
  safeSet(KEYS.elderState(room), next)
  return next
}

// 四个映射统一克隆：漏掉任何一个都会把长辈的操作悄悄抹掉
function cloneState(state) {
  return {
    done: { ...(state && state.done) },
    collapsed: { ...(state && state.collapsed) },
    dismissed: { ...(state && state.dismissed) },
    todos: { ...(state && state.todos) },
  }
}

// ---- 「到了之后做什么」清单：按 `卡片键:todo:序号` 记账 ----
export function todoKey(segKey, index) {
  return String(segKey) + ':todo:' + String(index)
}

export function toggleTodo(state, segKey, index, now = Date.now()) {
  const next = cloneState(state)
  if (!segKey || index == null) return next
  const k = todoKey(segKey, index)
  if (next.todos[k]) delete next.todos[k]
  else next.todos[k] = now
  return next
}

export function isTodoDone(state, segKey, index) {
  return !!(state && state.todos && state.todos[todoKey(segKey, index)])
}

// 走完 / 改回没走完。返回新对象（不改入参），值用时间戳（0 表示未完成）
export function toggleDone(state, segId, now = Date.now()) {
  const next = cloneState(state)
  if (!segId) return next
  if (next.done[segId]) delete next.done[segId]
  else next.done[segId] = now
  return next
}

// 卡片收起 / 展开
export function toggleCollapsed(state, segId) {
  const next = cloneState(state)
  if (!segId) return next
  if (next.collapsed[segId]) delete next.collapsed[segId]
  else next.collapsed[segId] = 1
  return next
}

// 提醒「知道了」：按 segId + stage 记账，同一个 stage 不再重复弹
export function markDismissed(state, segId, stage, now = Date.now()) {
  const next = cloneState(state)
  if (!segId) return next
  next.dismissed[segId + ':' + (stage || 'lead')] = now
  return next
}