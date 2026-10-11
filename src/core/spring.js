// 自研弹簧物理引擎。不引 GSAP/Motion —— 202 行，换来两件通用库做不好的事：
// 1. 可打断：动画中再次触摸，从当前速度继续，不是从头播
// 2. 速度交接：松手时把速度投射出去，动量连贯
// 长辈端完全不用这里 —— 它压根没有动画。

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export function prefersReducedTransparency() {
  try { return window.matchMedia('(prefers-reduced-transparency: reduce)').matches } catch { return false }
}

const DEFAULTS = { stiffness: 170, damping: 26, mass: 1, precision: 0.01 }

export function createSpring(initial = 0, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts)
  const listeners = new Set()

  const s = {
    value: initial,
    velocity: 0,
    target: initial,
    _raf: 0,
    _running: false,
    _lastT: 0,
    reduced: opts.reducedMotion !== undefined ? opts.reducedMotion : null,
  }

  function reduced() {
    if (s.reduced !== null) return s.reduced
    return prefersReducedMotion()
  }

  function tick(t) {
    if (!s._running) return
    const dt = Math.min((t - s._lastT) / 1000, 1 / 30)
    s._lastT = t
    step(dt)
    if (settled()) {
      s.value = s.target
      s.velocity = 0
      s._running = false
      s._raf = 0
      emit()
      return
    }
    s._raf = requestAnimationFrame(tick)
  }

  function step(dt) {
    // 半隐式欧拉：先算加速度，再更新速度，再更新位置
    const f = -cfg.stiffness * (s.value - s.target)
    const d = -cfg.damping * s.velocity
    const a = (f + d) / cfg.mass
    s.velocity += a * dt
    s.value += s.velocity * dt
  }

  function settled() {
    return Math.abs(s.value - s.target) < cfg.precision && Math.abs(s.velocity) < cfg.precision
  }

  function emit() {
    listeners.forEach((fn) => {
      try { fn(s.value, s.velocity) } catch (e) { console.error('[spring]', e) }
    })
  }

  s.setTarget = (v) => {
    if (v === s.target && s._running) return
    s.target = v
    if (reduced()) { s.jump(v); return }
    if (!s._running) {
      s._running = true
      s._lastT = performance.now()
      s._raf = requestAnimationFrame(tick)
    }
    // 可打断：正在动画中再次 setTarget，不改 velocity —— 从当前速度继续
  }

  // 拖拽跟手：直接写 value，速度由采样估算（1:1 跟手）
  s.dragTo = (v) => {
    const now = performance.now()
    if (s._lastDragT) {
      const dt = (now - s._lastDragT) / 1000
      if (dt > 0.004) {
        s.velocity = (v - s.value) / dt
        s._lastDragT = now
      }
    } else {
      s._lastDragT = now
      s.velocity = 0
    }
    s.value = v
    s._running = false
    if (s._raf) { cancelAnimationFrame(s._raf); s._raf = 0 }
    emit()
  }

  // 松手：把采样速度投射出去，动量连贯地飞向目标
  s.release = (target) => {
    s._lastDragT = 0
    s.target = target
    if (reduced()) { s.jump(target); return }
    if (!s._running) {
      s._running = true
      s._lastT = performance.now()
      s._raf = requestAnimationFrame(tick)
    }
  }

  s.jump = (v) => {
    s.value = v
    s.target = v
    s.velocity = 0
    s._running = false
    if (s._raf) { cancelAnimationFrame(s._raf); s._raf = 0 }
    s._lastDragT = 0
    emit()
  }

  s.onUpdate = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
  s.destroy = () => {
    listeners.clear()
    if (s._raf) cancelAnimationFrame(s._raf)
    s._running = false
  }

  return s
}

// 轨迹采样：供测试断言（可打断 / 速度交接 / reduced 降级）
export function simulateSpring(initial, target, opts, steps = 120, dt = 1 / 60) {
  const cfg = Object.assign({}, DEFAULTS, opts)
  let value = initial, velocity = 0
  const track = [value]
  for (let i = 0; i < steps; i++) {
    const a = (-cfg.stiffness * (value - target) - cfg.damping * velocity) / cfg.mass
    velocity += a * dt
    value += velocity * dt
    track.push(value)
  }
  return { value, velocity, track }
}
