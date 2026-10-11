// 长辈端排版红线：超长站名 / 含脏字符的站名，在 3 主题 × 3 字号下都不许横向溢出、
// 不许把 U+FFFD / 零宽字符渲染到页面上。
// 这是用户反馈「字符乱码 + 超出卡片」的机器回归。
import test from 'node:test'
import { launchBrowser, freshPage, ck, BASE, waitText, buildElderToken, makeRideCard, makePlayCard } from '../helpers.mjs'

const LONG_FROM = '上海虹桥站'.repeat(9)   // 45 字，无空格长站名
const LONG_TO = '北京南站'.repeat(11)      // 44 字
const DIRTY = '上海\u200B虹桥\uFFFD站\u3000北' // 零宽 + 替换字符 + 全角空格

test('长辈端不横向溢出、不留乱码字符：3 主题 × 3 字号', async (t) => {
  const browser = await launchBrowser()
  t.after(() => browser.close())
  const { page } = await freshPage(browser)
  await page.setViewportSize({ width: 390, height: 844 })

  for (const theme of ['day', 'contrast', 'night']) {
    for (const scale of [1, 1.12, 1.25]) {
      const token = buildElderToken({
        title: '超长站名测试',
        prefs: { scale, theme, shareLocation: false },
        cards: [
          makeRideCard({ segId: 'seg0', code: 'G8001', from: LONG_FROM, to: LONG_TO, depart: '08:00', arrive: '11:00' }),
          makeRideCard({ segId: 'seg1', code: 'G8002', from: DIRTY, to: DIRTY, depart: '15:00', arrive: '18:00' }),
          // 游玩卡：超长地点 + 超长清单项 + 超长说明，同样不许撑破卡片
          makePlayCard({
            segId: 'seg2',
            to: LONG_TO,
            note: '这一带的小吃很有名'.repeat(6),
            guide: '出站照右转直走一百米'.repeat(8),
            weather: '24℃ 多云，带件外套，早晚有点凉'.repeat(2),
            todos: [
              { text: '买瓶水'.repeat(8), level: 'high' },
              { text: DIRTY, level: 'normal' },
              { text: '找地方歇脚', level: 'low' },
            ],
          }),
          // 六轮新增元素：天气胶囊 + 到达指引，也要参与溢出检查
          makeRideCard({
            segId: 'seg3',
            code: 'G8003',
            from: LONG_FROM,
            to: LONG_TO,
            guide: DIRTY.repeat(3),
            weather: '26℃ 多云，带把伞'.repeat(3),
          }),
        ],
      })
      await page.goto(BASE + '/#/e/' + token)
      await waitText(page, '今天')

      const m = await page.evaluate(() => {
        const bad = []
        for (const el of document.querySelectorAll('.card')) {
          if (el.scrollWidth > el.clientWidth + 1) bad.push(el.clientWidth + '<' + el.scrollWidth)
        }
        const de = document.documentElement
        const todoHeights = [...document.querySelectorAll('.todo-row')].map((el) => Math.round(el.getBoundingClientRect().height))
        return {
          docOverflow: de.scrollWidth - de.clientWidth,
          bad,
          todoHeights,
          hasReplacement: document.body.innerText.includes('\uFFFD'),
          hasZeroWidth: /[\u200B-\u200D\uFEFF]/.test(document.body.innerText),
        }
      })
      const tag = theme + '/' + scale
      ck(m.docOverflow <= 1, tag + ' 页面横向溢出 ' + m.docOverflow + 'px')
      ck(m.bad.length === 0, tag + ' 卡片内元素溢出: ' + m.bad.join(' | '))
      ck(!m.hasReplacement, tag + ' 页面上不应出现 U+FFFD')
      ck(!m.hasZeroWidth, tag + ' 页面上不应出现零宽字符')
      ck(m.todoHeights.length === 3, tag + ' 三条清单都渲染: ' + m.todoHeights.length)
      ck(m.todoHeights.every((h) => h >= 60), tag + ' 清单行触控 ≥60px: ' + m.todoHeights.join(','))
    }
  }
})