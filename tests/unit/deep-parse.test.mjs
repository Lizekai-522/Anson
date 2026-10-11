// 深度口语解析组合用例。全中文真实输入形态，显式传 today 保证确定性。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runPipeline, parseSegments, normalizeStation, guessCity, parseDatePhrase, parseTimePhrase } from '../../src/core/agents.js'

const TODAY = '2026-03-15'
let n = 0
const ck = (cond, msg) => { if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg); assert.ok(cond, msg); n++ }

test('原方案示例全文（三段端到端）', () => {
  const raw = '10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到\n住一晚 如家酒店(北京南站店)\n第二天高铁 G104 上海虹桥 -> 杭州东'
  const trip = runPipeline(raw, { today: TODAY, fallbackDate: '2026-10-08' })
  ck(trip.segments.length === 3, '三段，实际 ' + trip.segments.length)
  const [a, b, c] = trip.segments
  ck(a.type === 'train' && a.code === 'G7102', '①车')
  ck(a.from === '上海虹桥站', '虹桥归一')
  ck(a.date === '2026-10-08', '①日期')
  ck(b.type === 'hotel' && b.hotelNights === 1, '②住一晚')
  ck(b.to === '如家酒店(北京南站店)', '②酒店名')
  ck(b.date === '2026-10-08', '②继承日期: ' + b.date)
  ck(c.type === 'train' && c.code === 'G104', '③车')
  ck(c.date === '2026-10-09', '③第二天+1: ' + c.date)
  ck(c.from === '上海虹桥站' && c.to === '杭州东站', '③站名归一')
  ck(typeof a.plain.voice === 'string' && a.plain.voice.includes('G7102'), '①voice 完整')
  ck(typeof b.plain.voice === 'string' && b.plain.voice.includes('入住'), '②voice')
  ck(trip.startDate === '2026-10-08', 'startDate')
})

test('口语时刻：点/半/分/24h 混排', () => {
  ck(parseTimePhrase('晚上11点25分') === '23:25', '晚上11点25分')
  ck(parseTimePhrase('下午4点') === '16:00', '下午4点')
  ck(parseTimePhrase('傍晚6点半') === '18:30', '傍晚6点半')
  ck(parseTimePhrase('清晨6点10分') === '06:10', '清晨6点10分')
  ck(parseTimePhrase('夜里11点') === '23:00', '夜里11点')
  ck(parseTimePhrase('中午1点') === '13:00', '中午1点')
  ck(parseTimePhrase('12:00') === '12:00', '12:00')
  ck(parseTimePhrase('8:05') === '08:05', '8:05 补零')
})

test('口语日期：月日/周/相对/只有几号', () => {
  ck(parseDatePhrase('12月1号', TODAY).date === '2026-12-01', '12月1号')
  ck(parseDatePhrase('2026年10月8日', TODAY).date === '2026-10-08', '年月日')
  ck(parseDatePhrase('3.20', TODAY).date === '2026-03-20', '3.20')
  ck(parseDatePhrase('星期五', TODAY) !== null, '星期五可解析')
  ck(parseDatePhrase('20号', TODAY).date === '2026-03-20', '20号→本月')
  ck(parseDatePhrase('3号', TODAY).date === '2026-04-03', '3号已过→下月')
  ck(parseDatePhrase('13月1号', TODAY).invalid === true, '13月非法')
  ck(parseDatePhrase('2月30日', TODAY).invalid === true, '2月30非法')
})

test('闰年 2 月 29 日：合法保留，平年保留字面', () => {
  const leap = parseDatePhrase('2月29日', '2028-03-15')
  ck(leap.date === '2028-02-29' && !leap.invalid, '闰年 2028 合法')
  const flat = parseDatePhrase('2月29日', TODAY)
  ck(flat.date === null && flat.invalid === true, '平年保留字面')
  const trip = runPipeline('2月29日 G7102 上海虹桥站 到 北京南站 09:30发车 13:45到', { today: TODAY })
  ck(trip.segments[0].dateLiteral === '2月29日', 'trip 保留字面')
  ck(trip.segments[0].date === null, 'date 为空不猜')
  ck(trip.segments[0].manualConfirm === true, '待人工确认')
})

test('站名变体矩阵', () => {
  ck(normalizeStation('虹桥') === '上海虹桥站', '虹桥')
  ck(normalizeStation('虹桥站') === '上海虹桥站', '虹桥站')
  ck(normalizeStation('上海虹桥') === '上海虹桥站', '上海虹桥')
  ck(normalizeStation('北京西') === '北京西站', '北京西')
  ck(normalizeStation('深圳北') === '深圳北站', '深圳北')
  ck(normalizeStation('西安北') === '西安北站', '西安北')
  ck(normalizeStation('郑州东') === '郑州东站', '郑州东')
  ck(normalizeStation('长沙南') === '长沙南站', '长沙南')
  ck(normalizeStation('广州南站') === '广州南站', '已是全名不动')
  ck(guessCity('北京南站') === '北京', '北京')
  ck(guessCity('深圳北站') === '深圳', '深圳')
  ck(guessCity('武汉站') === '武汉', '武汉')
  ck(guessCity('萧山机场') === '杭州', '萧山机场→杭州')
})

test('多车次多天混排（模拟 12306 短信流）', () => {
  const raw = [
    '10月8号 G7102 上海虹桥 -> 北京南 09:30发车 13:45到 二等座',
    '10月9号 G104 北京南 -> 杭州东 15:00发车 17:30到',
    '10月10号 D2281 杭州东 -> 宁波 08:00发车 09:20到 一等座',
  ].join('\n')
  const trip = runPipeline(raw, { today: TODAY })
  ck(trip.segments.length === 3, '三段')
  ck(trip.segments[0].seatClass === '二等座', '二等座')
  ck(trip.segments[2].seatClass === '一等座', '一等座')
  ck(trip.segments[0].plain.tips.some((t) => t.includes('普通座位')), '二等座人话')
  ck(trip.segments[2].plain.tips.some((t) => t.includes('更宽')), '一等座人话')
  ck(trip.startDate === '2026-10-08', 'startDate 最小')
})

test('航班短文混排', () => {
  const raw = '10月8号早上9点半 MU5137 上海浦东国际机场 T1 起飞 14:00 降落 成都双流国际机场 经济舱\n打车去酒店'
  const trip = runPipeline(raw, { today: TODAY })
  const f = trip.segments[0]
  ck(f.type === 'flight' && f.code === 'MU5137', '航班号')
  ck(f.departTime === '09:30', '早上9点半→09:30，实际 ' + f.departTime)
  ck(f.arriveTime === '14:00', '到达')
  ck((f.note || '').includes('T1'), 'T1 note')
  ck(trip.segments[1].type === 'taxi', '打车段')
})

test('过夜卧铺（Z 字直达）', () => {
  const trip = runPipeline('10月8号 Z281 上海南站 到 北京西站 18:12发车 次日07:05到 软卧', { today: TODAY })
  const s = trip.segments[0]
  ck(s.type === 'train' && s.code === 'Z281', 'Z281')
  ck(s.departTime === '18:12', '发车')
  ck(s.arriveTime === '07:05', '到达')
  ck(s.arriveNextDay === true, '次日到达标记')
  ck(s.plain.arrive.startsWith('次日'), '人话带次日')
  ck(s.plain.tips.some((t) => t.includes('铺位')), '软卧人话')
})

test('红眼航班凌晨到达提醒', () => {
  const trip = runPipeline('10月8号 CZ3456 广州白云国际机场 起飞 22:30 降落 01:20', { today: TODAY })
  ck(trip.issues.some((i) => i.code === 'late-arrival'), '凌晨到达提醒')
  ck(trip.segments[0].arriveNextDay === true, '跨零点按次日')
})

test('经停航班提示', () => {
  const raw = '10月8号 G7102 上海虹桥站 到 北京南站 09:30发车 13:45到\n经停南京南 不用下车'
  const trip = runPipeline(raw, { today: TODAY })
  ck(trip.segments.length === 1, '经停不单独成段')
  ck(trip.segments[0].plain.tips.some((t) => t.includes('不用下车')), '经停人话')
})

test('入住与退房顺序正常：无 error', () => {
  const raw = '10月8号住两晚 如家酒店(北京南站店)\n10月10号 G104 北京南 -> 上海虹桥 15:00发车'
  const trip = runPipeline(raw, { today: TODAY })
  ck(!trip.issues.some((i) => i.code === 'hotel-range'), '无区间冲突')
  ck(trip.segments[1].date === '2026-10-10', '返程日期')
})

test('连续多晚 + 城际接力', () => {
  const raw = [
    '10月8号 G7102 上海虹桥 -> 北京南 09:30发车 13:45到',
    '住三晚 全季酒店(天安门店)',
    '第四天 G39 北京南 -> 杭州东 10:00发车 13:30到',
    '在杭州东站打车去西湖',
  ].join('\n')
  const trip = runPipeline(raw, { today: TODAY })
  ck(trip.segments.length === 4, '四段')
  ck(trip.segments[1].type === 'hotel' && trip.segments[1].hotelNights === 3, '三晚')
  ck(trip.segments[2].date === '2026-10-11', '第四天=8+3, 实际 ' + trip.segments[2].date)
  ck(trip.segments[3].type === 'taxi', '打车')
  ck(trip.segments[3].to.includes('西湖') || trip.segments[3].from.includes('杭州'), 'taxi 地点')
})

test('纯兜底：只有 fallbackDate 的多行', () => {
  const raw = 'G7102 上海虹桥 -> 北京南 09:30发车 13:45到\nG104 北京南 -> 杭州东 15:00发车 17:30到'
  const trip = runPipeline(raw, { today: TODAY, fallbackDate: '2026-04-10' })
  ck(trip.segments.every((s) => s.date === '2026-04-10'), '两段都兜底')
  ck(!trip.issues.some((i) => i.code === 'missing-date'), '无 missing-date')
})

test('混合噪声行：解析容错', () => {
  const raw = [
    '爸妈出行安排',
    '10月8号 G7102 上海虹桥 -> 北京南 09:30发车 13:45到',
    '记得带降压药',
    '住一晚 如家酒店(北京南站店)',
  ].join('\n')
  const trip = runPipeline(raw, { today: TODAY })
  ck(trip.segments.length === 2, '有效两段')
  ck(trip.unparsed.includes('爸妈出行安排'), '标题行 unparsed')
  ck(trip.unparsed.includes('记得带降压药'), '提醒行 unparsed')
})

test('中转小时+分钟混合写法', () => {
  const raw = '10月8号 G7102 上海虹桥 -> 北京南 09:30发车 13:45到\n中转1小时20分钟'
  const trip = runPipeline(raw, { today: TODAY })
  ck(trip.segments[0].plain.tips.some((t) => t.includes('80 分钟')), '1h20=80分钟')
})

test('空输入与垃圾输入不崩', () => {
  const t1 = runPipeline('', { today: TODAY })
  ck(t1.segments.length === 0 && t1.title === '家人出行', '空输入默认标题')
  const t2 = runPipeline('。。。', { today: TODAY })
  ck(t2.segments.length === 0, '无有效段')
  const t3 = runPipeline(null, { today: TODAY })
  ck(t3.segments.length === 0, 'null 不崩')
})

test('数字开头航司 3U8966', () => {
  const trip = runPipeline('10月8号 3U8966 成都双流国际机场 起飞 10:00 降落 12:30', { today: TODAY })
  ck(trip.segments[0].type === 'flight', 'flight')
  ck(trip.segments[0].code === '3U8966', '数字开头航司')
})

test('站票/无座人话', () => {
  const trip = runPipeline('10月8号 K466 上海南站 到 芜湖站 08:50发车 12:30到 站票', { today: TODAY })
  ck(trip.segments[0].plain.tips.some((t) => t.includes('站着')), '站票人话')
})

test('向后兼容：issues 里 message 全部非空、segId 可回溯', () => {
  const trip = runPipeline('2月29日 G7102 上海虹桥站 到 北京南站 09:30发车 25点70分发车', { today: TODAY })
  ck(trip.issues.length >= 2, '至少两条 issue')
  for (const i of trip.issues) {
    ck(typeof i.message === 'string' && i.message.length > 4, 'message 非空: ' + i.code)
    ck(['error', 'warn', 'info'].includes(i.level), 'level 合法')
    ck(i.segId === null || trip.segments.some((s) => s.id === i.segId), 'segId 可回溯')
  }
})
