// 行前提醒清单：从行程段类型派生「出发前要准备什么」。
// 纯函数、零依赖；勾选状态挂在 trip.checklist（{ [itemId]: true }），随行程一起持久化。

export const CHECKLIST_GROUP_ORDER = ['证件', '时间', '随身', '联络']

function toMin(t) {
  const [h, m] = String(t || '').split(':').map(Number)
  return Number.isFinite(h) ? h * 60 + (m || 0) : null
}

// 返回 [{ id, group, text, done }]，顺序稳定，便于勾选态迁移
export function buildChecklist(trip) {
  const segs = (trip && trip.segments) || []
  const saved = (trip && trip.checklist) || {}
  const items = []
  const add = (id, group, text) => items.push({ id, group, text, done: !!saved[id] })

  const hasFlight = segs.some((s) => s.type === 'flight')
  const hasTrain = segs.some((s) => s.type === 'train')
  const hasHotel = segs.some((s) => s.type === 'hotel')
  const hasTaxi = segs.some((s) => s.type === 'taxi')
  const lateArrival = segs.some((s) => {
    if (s.type !== 'train' && s.type !== 'flight') return false
    if (s.arriveNextDay) return true
    const m = toMin(s.arriveTime)
    return m != null && m < 6 * 60
  })

  // 证件
  add('id-card', '证件', '带好身份证（坐车、住店、值机都要）')
  if (hasHotel) add('hotel-booking', '证件', '记下酒店预订人的姓名和手机号')

  // 时间
  if (hasFlight) {
    add('early-airport', '时间', '提前 2 小时到机场，留足安检时间')
    add('boarding-gate', '时间', '到了先看大屏，核对登机口有没有变')
  }
  if (hasTrain) {
    add('early-station', '时间', '提前 40 分钟到火车站，留足安检和检票时间')
    add('ticket-gate', '时间', '进站后核对检票口和站台，别走错')
  }
  if (lateArrival) {
    add('alarm', '时间', '到达时间偏晚/偏早，先把闹钟定好')
    add('pickup-plan', '时间', '提前和接站的人约好时间地点')
  }

  // 随身
  add('phone-charged', '随身', '手机充满电，带上充电器和充电宝')
  add('medicine', '随身', '常吃的药、创可贴随身放一小包')
  if (segs.length) add('bag', '随身', '行李给个明显标记，别拿错')

  // 联络
  add('contact', '联络', '把接站/同行人的电话存进手机')
  if (hasTaxi) add('plate', '联络', '上车前核对车牌号，到了再付钱')

  return items
}

// 分组（保持固定顺序；空组不显示）
export function checklistGroups(items) {
  const list = items || []
  return CHECKLIST_GROUP_ORDER
    .map((key) => ({ key, title: key, items: list.filter((it) => it.group === key) }))
    .filter((g) => g.items.length)
}

// 勾选/取消：就地改 trip.checklist，返回该项最新状态
export function toggleChecklistItem(trip, id) {
  if (!trip || !id) return false
  if (!trip.checklist || typeof trip.checklist !== 'object') trip.checklist = {}
  trip.checklist[id] = !trip.checklist[id]
  return trip.checklist[id]
}

// 完成度：给区块标题用
export function checklistProgress(items) {
  const list = items || []
  const done = list.filter((it) => it.done).length
  return { done, total: list.length }
}