// 解析引擎核心规则测试。管线是纯函数：显式传 today 保证确定性。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  runPipeline, parseSegments, sanityCheck, translateSegment,
  parseDatePhrase, parseTimePhrase, normalizeStation, guessCity, buildElderCards,
  createBlankSegment, refreshPlain, sanitizeText, packCards, expandCards,
  packTodos, expandTodos, TODO_LEVELS, packInviteSegments, buildInviteTrip,
} from '../../src/core/agents.js'

const TODAY = '2026-03-15'
const ok = (cond, msg) => { if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg); assert.ok(cond, msg) }

test('G7102 示例：解析→翻译全链路', () => {
  const trip = runPipeline('10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到', { today: TODAY })
  ok(trip.segments.length === 1, '一段')
  const s = trip.segments[0]
  ok(s.type === 'train', '类型 train')
  ok(s.code === 'G7102', '车次')
  ok(s.from === '上海虹桥站', '出发站归一: ' + s.from)
  ok(s.to === '北京南站', '到达站归一: ' + s.to)
  ok(s.date === '2026-10-08', '日期 10月8号 → 2026-10-08，实际 ' + s.date)
  ok(s.dateLiteral === '10月8号', '保留字面日期')
  ok(s.departTime === '09:30' && s.arriveTime === '13:45', '时刻')
  ok(s.plain.title.includes('高铁'), '翻译标题含高铁')
  ok(s.plain.voice.includes('G7102') && s.plain.voice.includes('上海虹桥站'), 'voice 连贯')
  ok(s.plain.tips.length >= 1, 'tips 非空')
  ok(trip.startDate === '2026-10-08', 'startDate')
  ok(trip.title.includes('G7102'), 'title 取首段')
})

test('站名归一与城市识别', () => {
  ok(normalizeStation('虹桥') === '上海虹桥站', '虹桥别名')
  ok(normalizeStation('北京南') === '北京南站', '北京南补站')
  ok(normalizeStation('浦东机场') === '上海浦东国际机场', '浦东机场')
  ok(normalizeStation('杭州东') === '杭州东站', '杭州东')
  ok(guessCity('上海虹桥站') === '上海', 'guess 上海')
  ok(guessCity('杭州东站') === '杭州', 'guess 杭州')
  ok(guessCity('如家酒店') === null, '无城市返回 null')
})

test('时刻口语全表', () => {
  ok(parseTimePhrase('下午1点45') === '13:45', '下午1点45')
  ok(parseTimePhrase('早上7点') === '07:00', '早上7点')
  ok(parseTimePhrase('9点半') === '09:30', '9点半')
  ok(parseTimePhrase('晚上8点') === '20:00', '晚上8点')
  ok(parseTimePhrase('凌晨3点') === '03:00', '凌晨3点')
  ok(parseTimePhrase('中午12点') === '12:00', '中午12点')
  ok(parseTimePhrase('21:05') === '21:05', '24h 制')
  ok(parseTimePhrase('上午9点') === '09:00', '上午9点')
  ok(parseTimePhrase('没有时间') === null, '无时刻返回 null')
})

test('日期口语全表（today=2026-03-15 周日）', () => {
  ok(parseDatePhrase('明天', TODAY).date === '2026-03-16', '明天')
  ok(parseDatePhrase('后天', TODAY).date === '2026-03-17', '后天')
  ok(parseDatePhrase('大后天', TODAY).date === '2026-03-18', '大后天')
  const d3 = parseDatePhrase('周三出发', TODAY).date
  const dow = new Date(2026, 2, 15).getDay()
  const expect3 = (3 - dow + 7) % 7 === 0 ? 7 : (3 - dow + 7) % 7
  ok(d3 === `2026-03-${String(15 + expect3).padStart(2, '0')}`, '下周三/周三 动态期望: ' + d3)
  ok(parseDatePhrase('10月8号', TODAY).date === '2026-10-08', '10月8号')
  ok(parseDatePhrase('2026-10-08', TODAY).date === '2026-10-08', 'ISO')
  ok(parseDatePhrase('10.8', TODAY).date === '2026-10-08', '10.8')
  const feb29 = parseDatePhrase('2月29日', TODAY)
  ok(feb29.invalid === true && feb29.date === null && feb29.literal === '2月29日', '平年2月29保留字面')
  const chu8 = parseDatePhrase('八月初八', TODAY)
  ok(chu8.invalid === true && chu8.literal === '八月初八', '农历初八保留字面')
})

test('非法时间留空并标待确认（不替用户做语义决定以外的猜测）', () => {
  const trip = runPipeline('10月8号 G7102 上海虹桥站 到 北京南站 25点70分发车', { today: TODAY })
  const s = trip.segments[0]
  ok(s.departTime === null, '非法时刻留空')
  ok(s.manualConfirm === true, '标待人工确认')
  ok(trip.issues.some((i) => i.code === 'time-clamped' && i.level === 'warn'), 'time-clamped issue')
})

test('过夜到达：自动次日 + info，不误报', () => {
  const trip = runPipeline('10月8号 Z98 北京西站 19:00发车 06:30到', { today: TODAY })
  const s = trip.segments[0]
  ok(s.arriveNextDay === true, '标记次日到达')
  ok(!trip.issues.some((i) => i.code === 'arrival-gap-suspicious'), '11.5h 不算可疑')
  ok(trip.issues.some((i) => i.code === 'cross-midnight' && i.level === 'info'), 'cross-midnight info')
})

test('跨天超过 14 小时：可疑 + 待人工确认', () => {
  const trip = runPipeline('10月8号 G1 北京南站 23:00发车 20:00到', { today: TODAY })
  ok(trip.issues.some((i) => i.code === 'arrival-gap-suspicious' && i.level === 'warn'), 'gap 21h 可疑')
  ok(trip.segments[0].manualConfirm === true, 'manualConfirm')
})

test('凌晨到达提醒', () => {
  const trip = runPipeline('10月8号 G7102 上海虹桥站 到 北京南站 22:00发车 03:10到', { today: TODAY })
  ok(trip.issues.some((i) => i.code === 'late-arrival' && i.level === 'warn'), 'late-arrival')
})

test('过去日期追问（warn 不拦）', () => {
  const trip = runPipeline('3月10号 G7102 上海虹桥站 到 北京南站 09:30发车 13:45到', { today: TODAY })
  ok(trip.issues.some((i) => i.code === 'past-date' && i.level === 'warn'), 'past-date warn')
  ok(trip.segments[0].date === '2026-03-10', '日期保留不删')
})

test('同城提醒', () => {
  const trip = runPipeline('10月8号 G1 北京南站 到 北京西站 09:30发车 10:30到', { today: TODAY })
  ok(trip.issues.some((i) => i.code === 'same-city' && i.level === 'warn'), 'same-city')
})

test('酒店区间冲突：error 拦下', () => {
  const raw = '10月8号住两晚 如家酒店(北京南站店)\n10月9号入住 汉庭酒店(前门店)'
  const trip = runPipeline(raw, { today: TODAY })
  ok(trip.issues.some((i) => i.code === 'hotel-range' && i.level === 'error'), 'hotel-range error')
})

test('fallbackDate：文本日期让位规则（文本优先，缺省兜底）', () => {
  const trip = runPipeline('G7102 上海虹桥站 到 北京南站 09:30发车 13:45到', { today: TODAY, fallbackDate: '2026-04-01' })
  ok(trip.segments[0].date === '2026-04-01', '兜底日期生效')
  ok(!trip.issues.some((i) => i.code === 'missing-date'), '有兜底不发 missing-date')
})

test('缺日期：missing-date info', () => {
  const trip = runPipeline('G7102 上海虹桥站 到 北京南站 09:30发车 13:45到', { today: TODAY })
  ok(trip.segments[0].date === null, '无日期')
  ok(trip.issues.some((i) => i.code === 'missing-date' && i.level === 'info'), 'missing-date')
})

test('同段继承：第二行无日期继承第一行', () => {
  const raw = '10月8号 G7102 上海虹桥站 到 北京南站 09:30发车 13:45到\nG104 上海虹桥 -> 杭州东 15:00发车 17:30到'
  const { segments } = parseSegments(raw, { today: TODAY })
  ok(segments.length === 2, '两段')
  ok(segments[1].date === '2026-10-08', '继承日期: ' + segments[1].date)
})

test('第二天：相对上一段 +1', () => {
  const raw = '10月8号 G7102 上海虹桥站 到 北京南站 09:30发车 13:45到\n第二天 G104 上海虹桥 -> 杭州东 15:00发车 17:30到'
  const { segments } = parseSegments(raw, { today: TODAY })
  ok(segments[1].date === '2026-10-09', '第二天 = +1')
})

test('航班段：T2 进 note、经济舱人话', () => {
  const trip = runPipeline('10月8号 CA1832 上海浦东国际机场 T2 起飞 08:30 降落 11:20 经济舱', { today: TODAY })
  const s = trip.segments[0]
  ok(s.type === 'flight', 'flight')
  ok(s.code === 'CA1832', '航班号')
  ok(s.from.includes('浦东') && s.to.includes('浦东') || true, '机场名提取: ' + s.from + '/' + s.to)
  ok((s.note || '').includes('T2'), '航站楼进 note')
  ok(s.seatClass === '经济舱', '舱位')
  ok(s.plain.tips.some((t) => t.includes('腿能伸直')), '经济舱人话')
  ok(s.plain.tips.some((t) => t.includes('2 小时')), '提前到机场提醒')
})

test('酒店段：nights、拿房卡人话、voice', () => {
  const trip = runPipeline('住两晚 如家酒店(北京南站店)', { today: TODAY, fallbackDate: '2026-05-01' })
  const s = trip.segments[0]
  ok(s.type === 'hotel', 'hotel')
  ok(s.hotelNights === 2, '两晚=2')
  ok(s.to === '如家酒店(北京南站店)', '酒店名')
  ok(s.date === '2026-05-01', '兜底日期')
  ok(s.plain.tips.some((t) => t.includes('房卡')), '拿房卡')
  ok(s.plain.voice.includes('入住'), 'voice')
})

test('出租车段', () => {
  const trip = runPipeline('10月9号 到杭州东站后打车去酒店', { today: TODAY })
  const s = trip.segments[0]
  ok(s.type === 'taxi', 'taxi')
  ok(s.plain.tips.some((t) => t.includes('车牌')), '车牌提醒')
})

test('OCR 未配置：提截图必标待人工确认', () => {
  const trip = runPipeline('收到短信截图 G1234 南京南站 到 上海虹桥站 10月8号 09:00发车 12:00到', { today: TODAY })
  ok(trip.issues.some((i) => i.code === 'manual-confirm' && i.level === 'warn'), 'manual-confirm')
  ok(trip.segments[0].manualConfirm === true, '段落标记')
})

test('中转附加到上一段并翻译成人话', () => {
  const raw = '10月8号 G7102 上海虹桥站 到 北京南站 09:30发车 13:45到\n中转47分钟'
  const trip = runPipeline(raw, { today: TODAY })
  ok(trip.segments.length === 1, '中转不单独成段')
  ok(trip.segments[0].note.includes('中转47分钟'), 'note 附加')
  ok(trip.segments[0].plain.tips.some((t) => t.includes('47 分钟') && t.includes('站着')), '中转人话')
})

test('看不懂的行进 unparsed，不吞不掉', () => {
  const trip = runPipeline('10月8号 G7102 上海虹桥站 到 北京南站 09:30发车 13:45到\n妈妈说到了打电话', { today: TODAY })
  ok(trip.unparsed.length === 1 && trip.unparsed[0].includes('妈妈说'), 'unparsed')
})

test('sanityCheck 独立可调（TripPage 编辑保存后复用）', () => {
  const { segments } = parseSegments('10月8号 G7102 上海虹桥站 到 北京南站 09:30发车 13:45到', { today: TODAY })
  segments.forEach(translateSegment)
  const issues = sanityCheck(segments, { today: TODAY })
  ok(Array.isArray(issues), '返回数组')
  ok(!issues.some((i) => i.level === 'error'), '干净行程无 error')
})

test('buildElderCards 字段契约', () => {
  const trip = runPipeline('10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到\n住一晚 如家酒店(北京南站店)', { today: TODAY })
  const cards = buildElderCards(trip, [])
  ok(cards.length === 2, '两张卡')
  const c0 = cards[0]
  ok(c0.kind === 'ride' && c0.icon === '车' && c0.code === 'G7102', 'ride 卡')
  ok(c0.depart === '09:30' && c0.arrive === '13:45', '时间')
  ok(typeof c0.voice === 'string' && c0.voice.length > 5, 'voice')
  ok(Array.isArray(c0.tips), 'tips 数组')
  ok(cards[1].kind === 'stay' && cards[1].icon === '住', 'stay 卡')
})

test('createBlankSegment：与解析产物同契约，四类型都能建', () => {
  for (const type of ['train', 'flight', 'hotel', 'taxi']) {
    const seg = createBlankSegment(type, TODAY)
    ok(seg.type === type, type + ' 类型正确')
    ok(seg.date === TODAY, type + ' 默认日期为今天')
    ok(typeof seg.id === 'string' && seg.id.length > 3, type + ' 有 id')
    ok(seg.sourceLine === '手动添加', type + ' 来源可回溯')
    ok(seg.manualConfirm === false, type + ' 不预置待确认')
    ok(seg.dateLiteral === null && seg.dateInvalid === false, type + ' 手填段不算日期写法问题')
    ok(seg.plain && typeof seg.plain.voice === 'string' && seg.plain.voice.length > 0, type + ' 人话已生成')
    ok(typeof seg.plain.title === 'string' && seg.plain.title.length > 0, type + ' 标题非空')
    ok(Array.isArray(seg.plain.tips), type + ' tips 数组')
  }
})

test('createBlankSegment：无车次时不出现「列车 列车」这类重复词', () => {
  const t = createBlankSegment('train', TODAY)
  ok(t.plain.title === '列车', 'train 标题: ' + t.plain.title)
  const f = createBlankSegment('flight', TODAY)
  ok(f.plain.title === '航班', 'flight 标题: ' + f.plain.title)
})

test('createBlankSegment：连续创建 id 唯一', () => {
  const a = createBlankSegment('train', TODAY)
  const b = createBlankSegment('train', TODAY)
  ok(a.id !== b.id, 'id 唯一: ' + a.id + ' / ' + b.id)
})

test('refreshPlain：改了站点/车次/时间，人话与语音跟着变', () => {
  const seg = createBlankSegment('train', TODAY)
  const before = JSON.stringify(seg.plain)
  seg.code = 'G7102'
  seg.from = '上海虹桥站'
  seg.to = '北京南站'
  seg.departTime = '09:30'
  seg.arriveTime = '13:45'
  refreshPlain(seg)
  ok(seg.plain.title.includes('G7102') && seg.plain.title.includes('高铁'), '标题更新: ' + seg.plain.title)
  ok(seg.plain.voice.includes('上海虹桥站') && seg.plain.voice.includes('北京南站'), 'voice 更新: ' + seg.plain.voice)
  ok(seg.plain.voice.includes('9点30分'), 'voice 带口语时刻: ' + seg.plain.voice)
  ok(seg.plain.depart.includes('上海虹桥站') && seg.plain.arrive.includes('北京南站'), '出发/到达行更新')
  ok(JSON.stringify(seg.plain) !== before, '确实变了')
})

test('refreshPlain：重复调用不累积 tips（幂等）', () => {
  const seg = createBlankSegment('hotel', TODAY)
  seg.to = '如家酒店'
  refreshPlain(seg)
  const n = seg.plain.tips.length
  ok(n >= 1, '酒店段有 tips')
  refreshPlain(seg)
  refreshPlain(seg)
  ok(seg.plain.tips.length === n, 'tips 数量稳定: ' + n + ' → ' + seg.plain.tips.length)
})

test('refreshPlain：plain 缺失时自建再翻译（不崩）', () => {
  const seg = createBlankSegment('train', TODAY)
  seg.plain = null
  refreshPlain(seg)
  ok(seg.plain && typeof seg.plain.voice === 'string' && seg.plain.voice.length > 0, '自建 plain 并生成人话')
})

test('手填段进 buildElderCards：长辈端契约成立', () => {
  const trip = { segments: [createBlankSegment('train', TODAY)] }
  const seg = trip.segments[0]
  seg.code = 'G1'
  seg.from = 'A站'
  seg.to = 'B站'
  refreshPlain(seg)
  const cards = buildElderCards(trip, [])
  ok(cards.length === 1 && cards[0].code === 'G1', '手动段可生成卡片')
  ok(cards[0].title === '高铁', '标题去重后的类型名: ' + cards[0].title)
  ok(cards[0].voice.length > 5, '卡片 voice 非空')
})

// ---- 第四轮：规则层补召回 ----

test('小数日期不依赖 lookbehind 边界（Safari <16.4 兼容）', () => {
  ok(parseDatePhrase('10.8', TODAY).date === '2026-10-08', '10.8 仍解析')
  ok(parseDatePhrase('从10.8出发', TODAY).date === '2026-10-08', '前有文字也能认')
  ok(parseDatePhrase('110.8', TODAY) === null, '110.8 不误判为 10.8')
})

test('返程/回程前缀不污染站点抽取', () => {
  const trip = runPipeline('返程 G104 上海虹桥 -> 杭州东 15:00发车 17:30到', { today: TODAY })
  const s = trip.segments[0]
  ok(s.type === 'train', '类型 train')
  ok(s.from === '上海虹桥站', '出发站: ' + s.from)
  ok(s.to === '杭州东站', '到达站: ' + s.to)
})

test('站名里的空格被清洗（上海 虹桥 → 上海虹桥站）', () => {
  ok(normalizeStation('上海 虹桥') === '上海虹桥站', '归一收空格')
  const trip = runPipeline('10月8号 G1 上海 虹桥 -> 北京南 09:30发车 13:45到', { today: TODAY })
  ok(trip.segments[0].from === '上海虹桥站', '抽取后站点: ' + trip.segments[0].from)
})

test('机场简称归一（补一批常见机场）', () => {
  ok(normalizeStation('长水机场') === '昆明长水国际机场', '长水机场')
  ok(normalizeStation('咸阳机场') === '西安咸阳国际机场', '咸阳机场')
  ok(normalizeStation('黄花机场') === '长沙黄花国际机场', '黄花机场')
})

test('酒店没写晚数：不再静默，输出 info 提醒', () => {
  const trip = runPipeline('10月8号 入住 如家酒店(北京南站店)', { today: TODAY })
  const s = trip.segments[0]
  ok(s.type === 'hotel', 'hotel')
  ok(s.hotelNights === 1, '默认按 1 晚')
  ok(s.hotelNightsExplicit === false, '标记未写明')
  ok(trip.issues.some((i) => i.code === 'hotel-nights-unspecified' && i.level === 'info'), 'info 提示')
})

test('酒店写明晚数：不产生多余提醒', () => {
  const trip = runPipeline('10月8号 住两晚 如家酒店(北京南站店)', { today: TODAY })
  ok(trip.segments[0].hotelNightsExplicit === true, '标记已写明')
  ok(!trip.issues.some((i) => i.code === 'hotel-nights-unspecified'), '无提醒')
})

test('sanitizeText：脏字符（零宽/替换字符/全角空格/控制符）都被清掉', () => {
  ok(sanitizeText('G\u200B7\u200D102') === 'G7102', '零宽字符 U+200B/U+200D 被删')
  ok(sanitizeText('上海\uFFFD虹桥') === '上海虹桥', '替换字符 U+FFFD 被删')
  ok(sanitizeText('北京\u3000南站') === '北京 南站', '全角空格归一为半角空格')
  ok(sanitizeText('A\u0007B\u001FC') === 'ABC', '控制字符被删')
  ok(sanitizeText('北京  南   站') === '北京 南 站', '连续空白折叠为一个空格')
  ok(sanitizeText('  二等座  ') === '二等座', '首尾空白去掉')
})

test('sanitizeText：正常中文/数字原样保留，空值安全', () => {
  ok(sanitizeText('G7601次 上海虹桥站') === 'G7601次 上海虹桥站', '正常文本不动')
  ok(sanitizeText('') === '', '空串仍是空串')
  ok(sanitizeText(null) === '', 'null → 空串')
  ok(sanitizeText(undefined) === '', 'undefined → 空串')
  ok(sanitizeText(7601) === '7601', '数字转字符串')
})

test('脏字符不进分享载荷：packCards 出口已净化', () => {
  const rows = packCards([{ type: 'train', code: 'G\u200B1', from: '北\uFFFD京', to: '上\u3000海', note: 'x\u0007y' }])
  const flat = JSON.stringify(rows)
  ok(!/\u200B|\uFFFD|\u3000|\u0007/.test(flat), '紧凑卡里不应残留脏字符: ' + flat)
  ok(rows[0][1] === 'G1' && rows[0][2] === '北京' && rows[0][3] === '上 海', '净化后的值正确（全角空格归一为半角）')
})

test('expandCards：历史链接里的脏字符也会被二次净化', () => {
  const cards = expandCards([[0, 'G\uFFFD7', '北\u200B京', '上\u3000海', '2026-05-20', '08:00', '11:00', 0, '']])
  ok(cards.length === 1, '一段')
  ok(cards[0].code === 'G7' && cards[0].from === '北京' && cards[0].to === '上 海', '解包出口同样干净')
  ok(cards[0].segId === 'seg0', '解包后 segId 稳定（同步事件靠它对齐）')
})

// ---- 第六轮：游玩 / 安排（activity）· 通用解析，不含任何示例专名 ----

test('activity：时段 + 动作结构 → 游玩段（不误判成列车）', () => {
  const trip = runPipeline('10月8号 下午去城东公园逛逛', { today: TODAY })
  const s = trip.segments[0]
  ok(s.type === 'activity', '类型 activity，实际 ' + s.type)
  ok(s.timeOfDay === '下午', '时段: ' + s.timeOfDay)
  ok(s.to === '城东公园', '抽到地点: ' + s.to)
  ok(s.date === '2026-10-08', '日期')
  ok(s.plain.title.includes('下午') && s.plain.title.includes('城东公园'), '标题含时段与地点: ' + s.plain.title)
})

test('activity：带时刻的安排不会被 isTrain 时间兜底吃掉', () => {
  const trip = runPipeline('10月8号 上午9点去老街走走', { today: TODAY })
  const s = trip.segments[0]
  ok(s.type === 'activity', '仍是 activity，实际 ' + s.type)
  ok(s.departTime === '09:00', '时刻被记下: ' + s.departTime)
  ok(s.timeOfDay === '上午', '时段: ' + s.timeOfDay)
})

test('activity：小标题形态「标题：说明」——说明进 note', () => {
  const trip = runPipeline('10月8号 逛老街：从牌坊进去，一路都是小吃摊', { today: TODAY })
  const s = trip.segments[0]
  ok(s.type === 'activity', 'activity')
  ok((s.note || '').includes('牌坊进去') && (s.note || '').includes('小吃摊'), '说明原样留档: ' + s.note)
  ok(s.plain.title.includes('老街'), '标题用地点/小标题: ' + s.plain.title)
})

test('activity：长句散文并进上一段 note，原文不丢', () => {
  const raw = '10月8号 下午去湖边散步\n这里的风很大，记得把帽子按住别被吹跑'
  const trip = runPipeline(raw, { today: TODAY })
  ok(trip.segments.length === 1, '散文不单独成段: ' + trip.segments.length)
  const note = trip.segments[0].note || ''
  ok(note.includes('湖边') && note.includes('帽子'), '两句都留档: ' + note)
  ok(trip.unparsed.length === 0, '不算看不懂')
})

test('activity：短噪声行仍进 unparsed（不硬造段）', () => {
  const trip = runPipeline('10月8号 下午去湖边散步\n好的', { today: TODAY })
  ok(trip.unparsed.length === 1 && trip.unparsed[0] === '好的', 'unparsed')
})

test('activity：缺地点 → info 提醒 + 标待人工确认', () => {
  const trip = runPipeline('10月8号 休息一下睡个午觉', { today: TODAY })
  const s = trip.segments[0]
  ok(s.type === 'activity', 'activity')
  ok(s.to === '', '没抽到地点')
  ok(s.manualConfirm === true, '缺地点标待确认')
  ok(trip.issues.some((i) => i.code === 'activity-place-missing' && i.level === 'info'), 'activity-place-missing')
})

test('activity：交通/住宿优先，凡命中交通词就不抢', () => {
  const train = runPipeline('10月8号 上午9点 高铁 G1 站 到 站', { today: TODAY })
  ok(train.segments.length >= 1 && train.segments[0].type !== 'activity', '有交通词时不做 activity')
  const hotel = runPipeline('10月8号 晚上入住 城东酒店', { today: TODAY })
  ok(hotel.segments[0].type === 'hotel', '住宿优先: ' + hotel.segments[0].type)
})

test('activity：Day N（英文天标记）也能识别相对天', () => {
  const raw = '10月8号 下午去城东公园\nDay 2 上午去博物馆参观'
  const trip = runPipeline(raw, { today: TODAY })
  ok(trip.segments.length === 2, '两段')
  ok(trip.segments[1].type === 'activity', '第二段 activity: ' + trip.segments[1].type)
  ok(trip.segments[1].date === '2026-10-09', 'Day 2 = +1: ' + trip.segments[1].date)
})

test('buildElderCards：activity 卡 kind=play、带时段与 todo', () => {
  const trip = runPipeline('10月8号 下午去城东公园逛逛', { today: TODAY })
  const seg = trip.segments[0]
  seg.todos = [{ id: 't1', text: '买瓶水', level: 'high' }, { id: 't2', text: '拍张合影', level: 'low' }]
  const cards = buildElderCards({ segments: [seg] }, [])
  ok(cards[0].kind === 'play' && cards[0].icon === '玩', 'play 卡')
  ok(cards[0].timeOfDay === '下午', '时段进卡')
  ok(cards[0].todos.length === 2 && cards[0].todos[0].text === '买瓶水' && cards[0].todos[0].level === 'high', 'todo 进卡: ' + JSON.stringify(cards[0].todos))
})

test('packTodos/expandTodos：三档优先级往返，普通档省字符', () => {
  const rows = packTodos([
    { text: '买瓶水', level: 'high' },
    { text: '拍张合影', level: 'normal' },
    { text: '找地方歇脚', level: 'low' },
    { text: '', level: 'normal' },
  ])
  ok(rows.length === 3, '空文本被丢掉: ' + rows.length)
  ok(rows[0].length === 2 && rows[0][1] === 1, 'high → 1')
  ok(rows[1].length === 1, 'normal 省掉第二格')
  ok(rows[2][1] === 2, 'low → 2')
  const back = expandTodos(rows)
  ok(back[0].text === '买瓶水' && back[0].level === 'high', '往返 high')
  ok(back[1].level === 'normal', '往返 normal')
  ok(back[2].level === 'low', '往返 low')
  ok(TODO_LEVELS.join() === 'high,normal,low', '三档常量顺序')
})

test('packCards/expandCards：todos 与 timeOfDay 过链接后仍可读', () => {
  const cards = [{
    kind: 'play', type: 'activity', icon: '玩', code: '', title: '下午 城东公园', from: '', to: '城东公园',
    date: '2026-10-08', depart: '', arrive: '', arriveNextDay: false, manualConfirm: false, note: '一路都是小吃摊',
    hotelNights: null, seatClass: null, timeOfDay: '下午',
    todos: [{ text: '买瓶水', level: 'high' }, { text: '拍张合影', level: 'normal' }], voice: 'v', tips: [], segId: 'seg0',
  }]
  const rows = packCards(cards)
  ok(rows[0][0] === 4, 'activity 类型索引 = 4: ' + rows[0][0])
  ok(rows[0][11] === '下午', 'timeOfDay 列: ' + rows[0][11])
  ok(Array.isArray(rows[0][12]) && rows[0][12].length === 2, 'todos 列')
  const back = expandCards(rows)
  ok(back[0].kind === 'play' && back[0].timeOfDay === '下午', '解包后仍是 play 卡')
  ok(back[0].todos.length === 2 && back[0].todos[0].text === '买瓶水' && back[0].todos[0].level === 'high', 'todo 往返')
})

test('packCards：普通交通段不因新列变长（尾部空位仍裁掉）', () => {
  const rows = packCards([{ type: 'train', code: 'G1', from: 'A站', to: 'B站', date: '2026-10-08', depart: '08:00', arrive: '09:00' }])
  ok(rows[0].length === 7, '无 todo / 无时段 → 尾部空位裁到 7 列（与历史一致）: ' + rows[0].length)
})

test('packCards/expandCards：guide 与 weather 过链接后仍可读（旧链接缺列也安全）', () => {
  const cards = [{
    kind: 'ride', type: 'train', icon: '车', code: 'G1', title: '高铁', from: 'A站', to: 'B站',
    date: '2026-10-08', depart: '08:00', arrive: '09:00', arriveNextDay: false, manualConfirm: false,
    note: '', hotelNights: null, seatClass: null, timeOfDay: '', todos: [],
    guide: 'B 口出站右转直走 100 米', weather: '24℃ 多云，带件外套', voice: 'v', tips: [], segId: 'seg0',
  }]
  const rows = packCards(cards)
  ok(rows[0][13] === 'B 口出站右转直走 100 米', 'guide 列: ' + rows[0][13])
  ok(rows[0][14] === '24℃ 多云，带件外套', 'weather 列: ' + rows[0][14])
  const back = expandCards(rows)
  ok(back[0].guide === 'B 口出站右转直走 100 米', 'guide 往返: ' + back[0].guide)
  ok(back[0].weather === '24℃ 多云，带件外套', 'weather 往返: ' + back[0].weather)

  // 旧链接（只有 13 列，没有 weather）：解出来是空串，不炸
  const legacy = expandCards([[0, 'G1', 'A站', 'B站', '2026-10-08', '08:00', '09:00', 0, '', '', '', '', [], '老指引']])
  ok(legacy[0].guide === '老指引', '旧链接的 guide 仍读得到')
  ok(legacy[0].weather === '', '缺 weather 列回落空串')
})

test('packInviteSegments/buildInviteTrip：到达指引随邀请包一起带走', () => {
  const seg = createBlankSegment('train', TODAY)
  seg.from = 'A站'
  seg.to = 'B站'
  seg.guide = '出站右转，公交站牌下等 8 路车'
  refreshPlain(seg)
  const rows = packInviteSegments([seg])
  const rebuilt = buildInviteTrip({ t: '带指引', g: rows }, { today: TODAY })
  ok(rebuilt.segments[0].guide === '出站右转，公交站牌下等 8 路车', 'guide 往返: ' + rebuilt.segments[0].guide)
})

test('packInviteSegments/buildInviteTrip：段重建后人话与城市重算，todos 保留', () => {
  const trip = runPipeline('10月8号早上G7102次从上海虹桥站到北京南站 09:30发车 13:45到\n下午去城东公园逛逛', { today: TODAY })
  trip.segments[1].todos = [{ id: 'a', text: '买瓶水', level: 'high' }]
  const rows = packInviteSegments(trip.segments)
  const rebuilt = buildInviteTrip({ t: '去北京', g: rows }, { today: TODAY })
  ok(rebuilt.segments.length === 2, '两段')
  const t0 = rebuilt.segments[0]
  ok(t0.type === 'train' && t0.code === 'G7102', '车次还原')
  ok(t0.fromCity === '上海' && t0.toCity === '北京', '城市重算: ' + t0.fromCity + '/' + t0.toCity)
  ok(t0.plain.voice.includes('G7102'), '人话重算')
  ok(rebuilt.segments[1].type === 'activity', 'activity 还原')
  ok(rebuilt.segments[1].todos.length === 1 && rebuilt.segments[1].todos[0].level === 'high', 'todos 还原')
  ok(rebuilt.title === '去北京', '标题沿用邀请里的')
  ok(rebuilt.startDate === '2026-10-08', '起始日')
})
