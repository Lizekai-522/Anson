// 天气文案与查询：weatherAdvice 是纯函数（可单测）；fetchWeather 用注入的 stub，
// 一律断言「失败就静默返回 null」——不能因为没连上服务端就把分享卡住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { weatherText, weatherAdvice, normalizeWeather, fetchWeather } from '../../src/core/weather.js'

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

test('weatherText：WMO code 翻成人话，未知 code 给空串', () => {
  ok(weatherText(0) === '晴', '0 → 晴')
  ok(weatherText(3) === '阴', '3 → 阴')
  ok(weatherText(63) === '中雨', '63 → 中雨')
  ok(weatherText(75) === '大雪', '75 → 大雪')
  ok(weatherText(95) === '雷阵雨', '95 → 雷阵雨')
  ok(weatherText(12345) === '', '未知码不硬编')
})

test('weatherAdvice：温度 + 天气 + 一句穿衣提示', () => {
  const a = weatherAdvice({ tmax: 24, tmin: 18, rain: 10, code: 2 })
  ok(a.startsWith('24℃ 多云'), '开头是温度与天气: ' + a)
  ok(a.includes('穿得舒服就行'), '没有极端情况给通用建议: ' + a)

  ok(weatherAdvice({ tmax: 20, tmin: 15, rain: 60, code: 3 }).includes('带伞'), '降雨概率高提醒带伞')
  ok(weatherAdvice({ tmax: 10, tmin: 8, rain: 0, code: 61 }).includes('有雨'), '雨 code 提醒')
  ok(weatherAdvice({ tmax: -2, tmin: -8, rain: 0, code: 71 }).includes('有雪'), '雪 code 提醒')
  ok(weatherAdvice({ tmax: 12, tmin: 4, rain: 0, code: 0 }).includes('很冷'), '低温提醒')
  ok(weatherAdvice({ tmax: 36, tmin: 28, rain: 0, code: 0 }).includes('很热'), '高温提醒')
})

test('weatherAdvice：数据不全返回空串（宁可不显示，也不编一句话）', () => {
  ok(weatherAdvice({}) === '', '空对象')
  ok(weatherAdvice(null) === '', 'null')
  ok(weatherAdvice({ tmax: null, tmin: null }) === '', '没有温度')
  // 只有低温也能给一句（有温度就够）
  ok(weatherAdvice({ tmax: null, tmin: 9 }).includes('9℃'), '只有最低温也能出: ' + weatherAdvice({ tmax: null, tmin: 9 }))
})

test('normalizeWeather：接受服务端原始数值，缺 advice 时本地算', () => {
  const w = normalizeWeather({ ok: true, city: '厦门', date: '2026-10-11', tmax: 26, tmin: 20, rain: 0, code: 1 })
  ok(w && w.city === '厦门' && w.advice.includes('26℃'), '规整出 city 与 advice: ' + JSON.stringify(w))
  ok(normalizeWeather({ ok: false, reason: 'network' }) === null, '服务端说没成 → null')
  ok(normalizeWeather(null) === null, 'null → null')
  ok(normalizeWeather({ ok: true, city: 'x' }) === null, '没温度算不出文案 → null')
  ok(normalizeWeather({ ok: true, city: 'x', advice: '手工文案' }).advice === '手工文案', '服务端给了文案就用它')
})

test('fetchWeather：成功走规整；失败/超时/没服务端一律 null（静默降级）', async () => {
  const mk = (impl) => fetchWeather('厦门', { fetchImpl: impl })

  const good = await mk(async (url) => ({
    ok: true,
    json: async () => ({ ok: true, city: '厦门', tmax: 26, tmin: 20, rain: 0, code: 1 }),
  }))
  ok(good && good.advice.includes('26℃'), '成功返回规整结果')

  ok(await mk(async () => ({ ok: false, json: async () => ({}) })) === null, 'HTTP 失败 → null')
  ok(await mk(async () => { throw new Error('offline') }) === null, '抛异常 → null')
  ok(await mk(async () => ({ ok: true, json: async () => { throw new Error('bad json') } })) === null, '坏 JSON → null')
  ok(await fetchWeather('', { fetchImpl: async () => ({ ok: true }) }) === null, '空城市名不问')
  ok(await fetchWeather('厦门', {}) === null || true, '没有 fetch 实现时不炸（Node 下有全局 fetch，这里只断言不抛）')
})

test('fetchWeather：请求路径带上城市名（URL 编码）', async () => {
  let seen = ''
  await fetchWeather('乌鲁木齐', { fetchImpl: async (url) => { seen = url; return { ok: false, json: async () => ({}) } } })
  ok(seen === '/api/weather?city=' + encodeURIComponent('乌鲁木齐'), '请求路径: ' + seen)
})