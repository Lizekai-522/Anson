// 子女端动效层：GSAP 只做三件事 —— 页面切换、列表入场、6 位码逐位翻入。
// 三条纪律：
//   1. 只用 transform / opacity，动画期间不触发重排；
//   2. 统一读 prefers-reduced-motion：开了就直接落终态，一秒都不播；
//   3. 列表入场一个会话只播一次（来回切页不重复晃眼）。
// 长辈端不引这一层：那边是零动画硬约束（有机器断言守着）。
import { gsap } from 'gsap'

export function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function played(key) {
  if (!key) return false
  try { return sessionStorage.getItem('motion:' + key) === '1' } catch { return false }
}
function markPlayed(key) {
  if (!key) return
  try { sessionStorage.setItem('motion:' + key, '1') } catch {}
}

// 页面入场：整块内容轻微上移 + 淡入
export function enterPage(el, key) {
  if (!el || !el.children) return
  const targets = el.children.length ? el.children : [el]
  if (reducedMotion()) { gsap.set(targets, { clearProps: 'all' }); return }
  if (played(key)) return
  markPlayed(key)
  gsap.fromTo(
    targets,
    { y: 10, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.28, ease: 'power2.out', stagger: 0.03, clearProps: 'transform,opacity' },
  )
}

// 列表入场：逐条错开，节奏一致
export function enterList(els, key) {
  const items = els ? Array.from(els) : []
  if (!items.length) return
  if (reducedMotion()) { gsap.set(items, { clearProps: 'all' }); return }
  if (played(key)) return
  markPlayed(key)
  gsap.fromTo(
    items,
    { y: 12, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.32, ease: 'power2.out', stagger: 0.045, clearProps: 'transform,opacity' },
  )
}

// 6 位码：逐位翻入（分享页的仪式感）
export function revealCode(el) {
  if (!el || reducedMotion()) return
  const digits = el.querySelectorAll('.code-digit')
  if (!digits.length) return
  gsap.fromTo(
    digits,
    { yPercent: 45, opacity: 0 },
    { yPercent: 0, opacity: 1, duration: 0.34, ease: 'power3.out', stagger: 0.055, clearProps: 'transform,opacity' },
  )
}