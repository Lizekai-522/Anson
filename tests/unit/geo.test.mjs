// 目的地坐标：normalizeGeo 是纯函数（可单测）；fetchCityCoords 用注入的 stub，
// 一律断言「失败就静默返回 null」——不能因为没连上服务端就把行程页卡住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGeo, fetchCityCoords } from '../../src/core/geo.js'
import { encodeCityParam } from '../../src/core/weather.js'

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}

test('normalizeGeo：形状校验，坏数据一律 null', () => {
  const g = normalizeGeo({ ok: true, city: '厦门', lat: 24.4798, lng: 118.0894 })
  ok(g && g.city === '厦门' && g.lat === 24.4798 && g.lng === 118.0894, '正常值规整: ' + JSON.stringify(g))
  ok(normalizeGeo({ ok: false, reason: 'city_not_found' }) === null, '服务端说没成 → null')
  ok(normalizeGeo(null) === null, 'null → null')
  ok(normalizeGeo({ ok: true, city: 'x' }) === null, '缺坐标 → null')
  ok(normalizeGeo({ ok: true, lat: NaN, lng: 0 }) === null, 'NaN 坐标 → null')
  ok(normalizeGeo({ ok: true, lat: 89, lng: 0 }) === null, '纬度越界 → null')
  ok(normalizeGeo({ ok: true, lat: 0, lng: 181 }) === null, '经度越界 → null')
})

test('fetchCityCoords：成功走规整；失败/超时/没服务端一律 null（静默降级）', async () => {
  const mk = (impl) => fetchCityCoords('厦门', { fetchImpl: impl })

  const good = await mk(async () => ({ ok: true, json: async () => ({ ok: true, city: '厦门', lat: 24.4798, lng: 118.0894 }) }))
  ok(good && good.lat === 24.4798, '成功返回规整结果')

  ok(await mk(async () => ({ ok: false, json: async () => ({}) })) === null, 'HTTP 失败 → null')
  ok(await mk(async () => { throw new Error('offline') }) === null, '抛异常 → null')
  ok(await mk(async () => ({ ok: true, json: async () => { throw new Error('bad json') } })) === null, '坏 JSON → null')
  ok(await fetchCityCoords('', { fetchImpl: async () => ({ ok: true }) }) === null, '空城市名不问')
})

test('fetchCityCoords：请求路径带上（ASCII 化的）城市名', async () => {
  let seen = ''
  await fetchCityCoords('乌鲁木齐', { fetchImpl: async (url) => { seen = url; return { ok: false, json: async () => ({}) } } })
  ok(seen === '/api/geocode?city=' + encodeCityParam('乌鲁木齐'), '请求路径: ' + seen)
  ok(/^[\x20-\x7E]*$/.test(seen), '整条请求路径是 ASCII: ' + seen)
})