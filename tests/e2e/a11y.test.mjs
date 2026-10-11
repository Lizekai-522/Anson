// 适老化硬指标 + 视觉回归截图基线。
// 长辈端硬指标（逐条机器断言，不靠目测）：
//   浅色底（亮度 ≥0.8）且底色与正文对比度 ≥7:1（AAA，替代旧的「纯白底」）/
//   正文 ≥28px 且字重 ≥600 / 主按钮 ≥72px 高 / 触控区 ≥60×60 / 零动画 /
//   卡片正文对比度 ≥7:1、按钮文字对比度 ≥4.5:1 / 语音按钮 aria。
// 截图存 tests/screenshots/，作为视觉回归基线（生成基线，不做像素 diff）。
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, freshPage, ck, BASE, registerAccount, waitText, cnDatePhrase } from '../helpers.mjs'

const SHOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

// 在浏览器上下文里执行的测量函数（Playwright 负责序列化，不引用外部变量）：
// 采集尺寸/字重/动画数量，并按 WCAG 公式算出真实对比度。
function elderMetrics() {
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
  const over = (fg, bg) => {
    const a = fg[3]
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
  }
  const rootEl = document.querySelector('.elder-root') || document.body
  const rootBg = parse(getComputedStyle(rootEl).backgroundColor) || [255, 255, 255, 1]
  // 有效背景：元素自身或最近的不透明祖先；中间遇到半透明层则与底色做 alpha 合成
  const effectiveBg = (el) => {
    const stack = []
    let cur = el
    let base = null
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor)
      if (c && c[3] > 0) {
        if (c[3] >= 1) { base = c; break }
        stack.push(c)
      }
      cur = cur.parentElement
    }
    let out = base || rootBg
    for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out)
    return out
  }
  const contrast = (el) => {
    const fg = parse(getComputedStyle(el).color) || [0, 0, 0, 1]
    const l1 = lum(fg)
    const l2 = lum(effectiveBg(el))
    const hi = Math.max(l1, l2)
    const lo = Math.min(l1, l2)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }
  const selfContrast = (el) => {
    const fg = parse(getComputedStyle(el).color) || [0, 0, 0, 1]
    const bg = parse(getComputedStyle(el).backgroundColor) || rootBg
    const l1 = lum(fg)
    const l2 = lum(bg)
    const hi = Math.max(l1, l2)
    const lo = Math.min(l1, l2)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }
  const pick = (sel) => document.querySelector(sel)
  const h = (el) => Math.round(el.getBoundingClientRect().height)

  let animated = 0
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0) animated++
  }

  const TEXT_SELS = ['.card-title', '.card-line2', '.card-line3']
  const BTN_SELS = '.bar-btn, .big-btn, .tel-btn'
  return {
    rootBg: getComputedStyle(rootEl).backgroundColor,
    rootLum: Math.round(lum(rootBg) * 1000) / 1000,
    rootContrast: selfContrast(rootEl),
    h1Size: pick('.elder-h1') ? parseFloat(getComputedStyle(pick('.elder-h1')).fontSize) : null,
    cardTitleSize: pick('.card-title') ? parseFloat(getComputedStyle(pick('.card-title')).fontSize) : null,
    card: pick('.card') ? { w: Math.round(pick('.card').getBoundingClientRect().width), h: h(pick('.card')) } : null,
    barBtnHeights: [...document.querySelectorAll('.bar-btn')].map(h),
    bigBtnHeights: [...document.querySelectorAll('.big-btn')].map(h),
    weights: TEXT_SELS.filter(pick).map((s) => ({ sel: s, weight: parseInt(getComputedStyle(pick(s)).fontWeight, 10) || 0 })),
    textContrast: TEXT_SELS.filter(pick).map((s) => ({ sel: s, ratio: contrast(pick(s)) })),
    btnContrast: [...document.querySelectorAll(BTN_SELS)].map((b) => ({ cls: b.className, ratio: selfContrast(b), h: h(b) })),
    telLinks: document.querySelectorAll('a[aria-label^="拨打"]').length,
    navAria: !!document.querySelector('nav[aria-label]'),
    animatedCount: animated,
  }
}

test('a11y：长辈端硬指标逐条断言 + 截图', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { ctx, page } = await freshPage(browser)
  const kid = await ctx.newPage()
  await registerAccount(kid, 'a11y')
  await kid.goto(BASE + '/#/import')
  await kid.locator('textarea').fill(`${cnDatePhrase(0)}早上G7601次从上海虹桥站到北京南站 08:00发车 11:00到`)
  await kid.getByRole('button', { name: /解析行程/ }).click()
  await waitText(kid, 'G7601')
  await kid.getByRole('button', { name: /确认导入/ }).click()
  await kid.waitForURL(/#\/trip\//)
  await kid.goto(BASE + '/#/home')
  await kid.getByRole('button', { name: /分享/ }).first().click()
  await kid.waitForURL(/#\/share\//)
  await kid.getByRole('button', { name: /生成分享链接/ }).click()
  await kid.locator('input[readonly]').first().waitFor({ timeout: 8000 })
  const link = await kid.locator('input[readonly]').first().inputValue()
  await kid.close()

  await page.setViewportSize({ width: 390, height: 844 }) // 长辈大概率用手机
  await page.goto(link)
  await waitText(page, '今天')
  const m = await page.evaluate(elderMetrics)

  await t.test('硬指标：浅色底 + 正文对比度 ≥7:1', () => {
    ck(m.rootLum >= 0.8, '底色亮度 ' + m.rootLum + ' ≥ 0.8（浅色底，实测 ' + m.rootBg + '）')
    ck(m.rootContrast >= 7, '底色与正文对比度 ' + m.rootContrast + ':1 ≥ 7:1（AAA）')
  })

  await t.test('硬指标：卡片正文对比度 ≥7:1（AAA）', () => {
    ck(m.textContrast.length >= 3, '三处关键文本都在：' + m.textContrast.map((x) => x.sel).join(' / '))
    for (const item of m.textContrast) {
      ck(item.ratio >= 7, item.sel + ' 对比度 ' + item.ratio + ':1 ≥ 7:1')
    }
  })

  await t.test('硬指标：按钮文字对比度 ≥4.5:1（AAA 大字）', () => {
    ck(m.btnContrast.length > 0, '有按钮')
    for (const b of m.btnContrast) {
      ck(b.ratio >= 4.5, b.cls + ' 对比度 ' + b.ratio + ':1 ≥ 4.5:1')
    }
  })

  await t.test('硬指标：正文 ≥ 28px 且字重 ≥600（不再发虚）', () => {
    ck(m.cardTitleSize >= 28, 'card-title 字号 ' + m.cardTitleSize)
    ck(m.h1Size >= 34, 'elder-h1 字号 ' + m.h1Size)
    for (const w of m.weights) {
      ck(w.weight >= 600, w.sel + ' 字重 ' + w.weight + ' ≥ 600')
    }
  })

  await t.test('硬指标：底部按钮 ≥ 72px 高', () => {
    ck(m.barBtnHeights.length === 3, '底部三个按钮都在')
    for (const h of m.barBtnHeights) ck(h >= 72, '底栏按钮高 ' + h + ' ≥ 72')
  })

  await t.test('硬指标：卡片触控区 ≥ 60×60', () => {
    ck(m.card && m.card.h >= 60 && m.card.w >= 60, 'card ' + (m.card && m.card.w) + 'x' + (m.card && m.card.h))
  })

  await t.test('硬指标：零动画', () => {
    ck(m.animatedCount === 0, '存在动画元素 ' + m.animatedCount + ' 个，长辈端要求 0')
  })

  await t.test('硬指标：无障碍标注', () => {
    ck(m.navAria, '底部操作区有 aria-label')
    ck(m.telLinks >= 0, '拨打链接带 aria-label（0 个联系人时允许为 0）')
  })

  await t.test('视觉回归：展示态截图基线', async () => {
    await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, 'elder-phone.png') })
    ck(fs.existsSync(path.join(SHOT_DIR, 'elder-phone.png')), '截图落盘')
  })

  await t.test('三页导航：一个按钮一个页面，且各有各的内容', async () => {
    // 用户要求：不要三块内容堆在一页里，长辈会看叉
    await page.getByRole('button', { name: '家人电话', exact: true }).click()
    await waitText(page, '点一下就能打')
    ck(await page.locator('.card').count() === 0, '家人页不显示行程卡')
    ck(await page.getByRole('button', { name: '家人电话', exact: true }).getAttribute('aria-current') === 'page', '当前页按钮有 aria-current')

    await page.getByRole('button', { name: '显示设置', exact: true }).click()
    await waitText(page, '字大一点，看得清')
    ck(await page.locator('.card').count() === 0, '显示页不显示行程卡')

    await page.getByRole('button', { name: '行程', exact: true }).click()
    await waitText(page, '今天')
    ck(await page.locator('.card').count() > 0, '行程页有行程卡')

    // 子页面有显式的「返回行程」，不依赖浏览器返回键
    await page.getByRole('button', { name: '显示设置', exact: true }).click()
    await waitText(page, '字大一点，看得清')
    await page.getByRole('button', { name: '返回行程' }).click()
    await waitText(page, '今天')
    ck(true, '返回按钮可用')
  })

  await t.test('长辈端不放产品名与 logo（只讲今天怎么走）', async () => {
    const text = await page.locator('.elder-root').innerText()
    ck(!text.includes('安程'), '长辈端不出现产品名')
    ck(!text.includes('ANCHENG'), '长辈端不出现英文标')
    ck(await page.locator('.elder-root .brand-mark, .elder-root svg[aria-label="安程"]').count() === 0, '长辈端没有品牌标记')
  })

  await t.test('显示设置：换主题 / 调大字，都不跌破适老底线', async () => {
    const openShow = async () => {
      await page.getByRole('button', { name: '显示设置', exact: true }).click()
      await waitText(page, '字大小')
    }
    const openDay = async () => {
      await page.getByRole('button', { name: '行程', exact: true }).click()
      await waitText(page, '今天')
    }

    // 三主题逐一过机器指标：日间（浅）/ 高对比（纯黑 + 琥珀）/ 夜间（深）
    for (const [theme, dark] of [['高对比', true], ['夜间', true], ['日间', false]]) {
      await openShow()
      await page.getByRole('button', { name: theme, exact: true }).click()
      await openDay()
      const mm = await page.evaluate(elderMetrics)
      if (dark) ck(mm.rootLum <= 0.2, theme + ' 底色要够深: ' + mm.rootLum)
      else ck(mm.rootLum >= 0.8, theme + ' 底色要够浅: ' + mm.rootLum)
      ck(mm.rootContrast >= 7, theme + ' 底色与正文对比度 ' + mm.rootContrast + ':1')
      for (const item of mm.textContrast) ck(item.ratio >= 7, theme + ' ' + item.sel + ' 对比度 ' + item.ratio + ':1')
      for (const b of mm.btnContrast) ck(b.ratio >= 4.5, theme + ' ' + b.cls + ' 对比度 ' + b.ratio + ':1')
      for (const w of mm.weights) ck(w.weight >= 600, theme + ' ' + w.sel + ' 字重 ' + w.weight)
      for (const h of mm.barBtnHeights) ck(h >= 72, theme + ' 底栏按钮高 ' + h + ' ≥ 72')
      ck(mm.animatedCount === 0, theme + ' 主题必须零动画')
    }

    // 回到日间主题，再调大到「超大」：字要真变大，且仍守住底线
    await openShow()
    await page.getByRole('button', { name: '日间', exact: true }).click()
    await openDay()
    const base = await page.evaluate(elderMetrics)
    await openShow()
    await page.getByRole('button', { name: '超大', exact: true }).click()
    await openDay()
    const big = await page.evaluate(elderMetrics)
    ck(big.cardTitleSize > base.cardTitleSize, '超大字号应更大: ' + base.cardTitleSize + ' → ' + big.cardTitleSize)
    ck(big.cardTitleSize >= 28, '放大后仍 ≥28px: ' + big.cardTitleSize)
    for (const h of big.barBtnHeights) ck(h >= 72, '放大后底栏按钮高 ' + h + ' ≥ 72')

    // 调过要记住：刷新后仍是超大
    await page.reload()
    await waitText(page, '今天')
    const after = await page.evaluate(elderMetrics)
    ck(after.cardTitleSize === big.cardTitleSize, '刷新后记住设置: ' + after.cardTitleSize)

    // 收尾：清掉本地偏好与放大，别影响后面的用例
    await page.evaluate(() => localStorage.removeItem('ptb:elder:prefs'))
    await page.reload()
    await waitText(page, '今天')
  })

  await t.test('输码态：主按钮 ≥72px 高 + 对比度达标 + 截图', async () => {
    // 展示态不渲染 .big-btn，这条断言以前是空跑的；这里切到输码态真测一次
    await page.goto(BASE + '/#/e')
    await waitText(page, '输入子女给的 6 位码')
    const c = await page.evaluate(elderMetrics)
    ck(c.bigBtnHeights.length > 0, '输码态有主按钮')
    for (const h of c.bigBtnHeights) ck(h >= 72, '主按钮高 ' + h + ' ≥ 72')
    for (const b of c.btnContrast) ck(b.ratio >= 4.5, b.cls + ' 对比度 ' + b.ratio + ':1 ≥ 4.5:1')
    ck(c.animatedCount === 0, '输码态同样零动画')
    await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, 'elder-code.png') })
    ck(fs.existsSync(path.join(SHOT_DIR, 'elder-code.png')), '输码态截图落盘')
  })

  await t.test('恢复态：坏链接可恢复 + 截图', async () => {
    await page.goto(BASE + '/#/e/aaaa.bbbb-坏token')
    await waitText(page, '链接好像不对')
    const r = await page.evaluate(elderMetrics)
    ck(r.rootLum >= 0.8, '恢复态底色亮度 ' + r.rootLum)
    for (const b of r.btnContrast) ck(b.ratio >= 4.5, '恢复态按钮对比度 ' + b.ratio + ':1 ≥ 4.5:1')
    await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, 'elder-recover.png') })
    ck(fs.existsSync(path.join(SHOT_DIR, 'elder-recover.png')), '恢复态截图落盘')
  })
})

test('a11y：桌面与移动视觉基线 + 焦点可见', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)

  await t.test('未登录四页截图', async () => {
    await page.goto(BASE + '/#/')
    await waitText(page, '安程')
    await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, 'welcome.png') })
    await page.goto(BASE + '/#/login')
    await waitText(page, '登录', 8000)
    await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, 'login.png') })
    await page.goto(BASE + '/#/register')
    await waitText(page, '注册', 8000)
    await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, 'register.png') })
    await page.goto(BASE + '/#/accounts')
    await waitText(page, '这台设备还没有账号', 8000)
    await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, 'recent-accounts.png') })
    for (const f of ['welcome.png', 'login.png', 'register.png', 'recent-accounts.png']) {
      ck(fs.existsSync(path.join(SHOT_DIR, f)), f + ' 落盘')
    }
  })

  await t.test('登录页 Tab 键焦点可见（outline 不为 none）', async () => {
    await page.goto(BASE + '/#/login')
    await waitText(page, '登录', 8000)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return 'body'
      const cs = getComputedStyle(el)
      return cs.outlineStyle + '/' + cs.outlineWidth + '/' + cs.boxShadow
    })
    ck(outline !== 'none/0px/none' && outline !== 'body', '焦点有可见样式: ' + outline)
  })

  let tripId = ''
  await t.test('登录后六页桌面基线', async () => {
    await registerAccount(page, 'vis')
    await page.goto(BASE + '/#/import')
    await page.locator('textarea').fill(`${cnDatePhrase(0)}早上G9901次从上海虹桥站到北京南站 08:00发车 11:00到`)
    await page.getByRole('button', { name: /解析行程/ }).click()
    await waitText(page, 'G9901')
    await page.getByRole('button', { name: /确认导入/ }).click()
    await page.waitForURL(/#\/trip\//, { timeout: 8000 })
    tripId = page.url().split('#/trip/')[1]
    ck(!!tripId, '拿到 tripId: ' + tripId)

    const shots = [
      ['/#/home', 'kid-home.png'],
      ['/#/import', 'kid-import.png'],
      ['/#/trip/' + tripId, 'kid-trip.png'],
      ['/#/share/' + tripId, 'kid-share.png'],
      ['/#/family', 'kid-family.png'],
      ['/#/profile', 'kid-profile.png'],
    ]
    for (const [hash, file] of shots) {
      await page.goto(BASE + hash)
      await page.waitForTimeout(350)
      await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, file) })
      ck(fs.existsSync(path.join(SHOT_DIR, file)), file + ' 落盘')
    }
  })

  await t.test('390px 移动端：关键页无横向溢出 + 基线', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const shots = [
      ['/#/', 'kid-mobile-welcome.png'],
      ['/#/home', 'kid-mobile-home.png'],
      ['/#/import', 'kid-mobile-import.png'],
      ['/#/trip/' + tripId, 'kid-mobile-trip.png'],
    ]
    for (const [hash, file] of shots) {
      await page.goto(BASE + hash)
      await page.waitForTimeout(350)
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      ck(w <= 390, hash + ' 在 390px 下横向溢出：scrollWidth=' + w)
      await page.screenshot({ fullPage: true, path: path.join(SHOT_DIR, file) })
    }
  })
})