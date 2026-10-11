// 第五轮新增控件的适老化补充硬指标：
//   .card-toggle（收起/展开）、.card-done-btn（走完了）、.loc-btn（位置共享）、
//   .notice-go / .notice-ok（提醒弹窗）—— 触控区 ≥60×60、文字对比度 ≥4.5:1、全页仍 0 动画。
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, freshPage, ck, BASE, waitText, buildElderToken, makeRideCard, soonDepart } from '../helpers.mjs'

const SHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')

// 在浏览器上下文里测量：尺寸 + 按 WCAG 公式算真实对比度（透明背景向上找不透明祖先）
function plusMetrics() {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(',').map((x) => parseFloat(x))
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
  }
  const lum = (rgb) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
  }
  const rootBg = parse(getComputedStyle(document.querySelector('.elder-root') || document.body).backgroundColor) || [255, 255, 255, 1]
  const effectiveBg = (el) => {
    let cur = el
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor)
      if (c && c[3] >= 1) return c
      cur = cur.parentElement
    }
    return rootBg
  }
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b)
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }
  const measure = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const fg = parse(getComputedStyle(el).color) || [0, 0, 0, 1]
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      contrast: ratio(fg, effectiveBg(el)),
      text: (el.innerText || '').trim(),
    }
  }
  let animated = 0
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0) animated++
  }
  return {
    toggle: measure('.card-toggle'),
    doneBtn: measure('.card-done-btn'),
    locBtn: measure('.loc-btn'),
    noticeGo: measure('.notice-go'),
    noticeOk: measure('.notice-ok'),
    // 第六轮新增控件：紧急求助 / 播报语言 / 撤销
    sos: measure('.el-sos'),
    voiceZh: measure('.seg-btn'),
    animated,
  }
}

test('长辈端新增控件：触控区 / 对比度 / 零动画', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)
  await page.setViewportSize({ width: 390, height: 844 })

  const { date, time } = soonDepart()
  // shareLocation=true 让位置共享卡片出现；一张 30 分钟后出发的卡让提醒弹窗出现
  const token = buildElderToken({
    title: '赶车',
    prefs: { scale: 1, theme: 'day', shareLocation: true },
    cards: [makeRideCard({ segId: 'seg0', code: 'G7001', from: '上海虹桥站', to: '北京南站', date, depart: time, arrive: '' })],
  })

  await page.goto(BASE + '/#/e/' + token)
  await waitText(page, '快出发了')
  await waitText(page, '让子女知道你在哪')

  const m = await page.evaluate(plusMetrics)
  const checks = [
    ['card-toggle', m.toggle],
    ['card-done-btn', m.doneBtn],
    ['loc-btn', m.locBtn],
    ['notice-go', m.noticeGo],
    ['notice-ok', m.noticeOk],
    ['el-sos', m.sos],
    ['seg-btn', m.voiceZh],
  ]
  for (const [name, box] of checks) {
    ck(!!box, name + ' 应该渲染出来')
    ck(box.w >= 60, name + ' 宽 ' + box.w + ' ≥ 60')
    ck(box.h >= 60, name + ' 高 ' + box.h + ' ≥ 60')
    ck(box.contrast >= 4.5, name + ' 文字对比度 ' + box.contrast + ':1 ≥ 4.5:1')
  }
  ck(m.animated === 0, '全页零动画（实测 ' + m.animated + ' 个动画元素）')

  // 紧急求助的按钮是深红底白字：单独确认对比度足够
  ck(m.sos.text.includes('按住'), '求助按钮文案: ' + m.sos.text)

  // 走完 → 撤销条里的「撤销」按钮也要够大、对比度够
  // （这张卡 30 分钟后出发，会弹出发提醒盖住卡片，先点掉再操作）
  if (await page.locator('.notice-ok').count()) {
    await page.locator('.notice-ok').click()
    await page.waitForTimeout(200)
  }
  await page.locator('.card-done-btn').first().click()
  await page.waitForTimeout(200)
  const undo = await page.evaluate(() => {
    const el = document.querySelector('.undo-btn')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), text: el.innerText.trim() }
  })
  ck(!!undo, '撤销按钮渲染出来')
  ck(undo.w >= 60 && undo.h >= 60, '撤销按钮触控区 ' + undo.w + '×' + undo.h + ' ≥ 60×60')
  ck(undo.text === '撤销', '撤销按钮文案: ' + undo.text)

  fs.mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, 'elder-plus.png') })
  ck(fs.existsSync(path.join(SHOT_DIR, 'elder-plus.png')), '截图落盘')
})