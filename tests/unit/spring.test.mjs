// 弹簧物理：可打断 / 速度交接 / reduced-motion 降级
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSpring, simulateSpring } from '../../src/core/spring.js'

const ok = (c, m) => { if (typeof c !== 'boolean') throw new TypeError('ck: ' + m); assert.ok(c, m) }

test('欠阻尼：有过冲、最终收敛到目标', () => {
  const { value, track } = simulateSpring(0, 100, { stiffness: 170, damping: 12 })
  ok(Math.abs(value - 100) < 1, '收敛: ' + value)
  ok(track.some((v) => v > 100.5), '存在过冲')
})

test('过阻尼：无过冲收敛', () => {
  const { value, track } = simulateSpring(0, 100, { stiffness: 120, damping: 40 })
  ok(Math.abs(value - 100) < 1, '收敛: ' + value)
  ok(!track.some((v) => v > 100), '无过冲')
})

test('reduced-motion：setTarget 直接跳到目标，零动画', () => {
  const s = createSpring(0, { reducedMotion: true })
  s.setTarget(80)
  ok(s.value === 80 && s.velocity === 0, '瞬间到位')
  ok(!s._running, '无 rAF 循环')
})

test('jump 复位并清速度', () => {
  const s = createSpring(0, { reducedMotion: true })
  s.value = 50; s.velocity = 99
  s.jump(10)
  ok(s.value === 10 && s.velocity === 0 && s.target === 10, 'jump 后干净')
})

test('dragTo 跟手 + release 速度交接（reduced 下降级）', () => {
  const s = createSpring(0, { reducedMotion: true })
  s.dragTo(30)
  ok(s.value === 30, '拖拽直接写值')
  s.release(-104)
  ok(s.value === -104 && s.target === -104, 'release 到位')
})

test('onUpdate 订阅与退订', () => {
  const s = createSpring(0, { reducedMotion: true })
  let calls = 0
  const un = s.onUpdate(() => calls++)
  s.setTarget(5)
  ok(calls === 1, '收到一次更新: ' + calls)
  un()
  s.setTarget(9)
  ok(calls === 1, '退订后不再收到')
})
