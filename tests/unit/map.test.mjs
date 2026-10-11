// 在线地图瓦片数学：像素/瓦片换算、视口覆盖、经度环绕、无效值兜底。
// 纯函数，不触网 —— 地图挂不挂得了不该影响行程卡片。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  lngToTileX, latToTileY, tileUrl, viewportTiles, isValidLatLng, formatLatLng, TILE_SIZE,
} from '../../src/core/map.js'

const ok = (cond, msg) => {
  if (typeof cond !== 'boolean') throw new TypeError('ck() 要求布尔断言: ' + msg)
  assert.ok(cond, msg)
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

test('lngToTileX：本初子午线居中、±180 落在两端', () => {
  for (const z of [0, 1, 5, 10]) {
    ok(near(lngToTileX(0, z), Math.pow(2, z) / 2), 'z=' + z + ' 时 lng=0 居中')
  }
  ok(near(lngToTileX(-180, 0), 0), '-180 → 0')
  ok(near(lngToTileX(180, 0), 1), '180 → 1')
  ok(near(lngToTileX(0, 1), 1), 'z=1 时 0 → 1')
})

test('latToTileY：赤道居中、北极趋 0、南极趋满', () => {
  ok(near(latToTileY(0, 0), 0.5), '赤道在 z=0 居中')
  ok(latToTileY(85, 0) < 0.1, '北极附近趋 0')
  ok(near(latToTileY(0, 2), 2), 'z=2 时赤道 → 2')
})

test('tileUrl：按 OSM 约定拼接', () => {
  ok(tileUrl(1, 2, 3) === 'https://tile.openstreetmap.org/3/1/2.png', tileUrl(1, 2, 3))
})

test('viewportTiles：覆盖视口所需的瓦片数量与偏移都合理', () => {
  const w = 360, h = 240
  const v = viewportTiles({ lat: 0, lng: 0, zoom: 3, width: w, height: h })
  ok(v.tiles.length > 0, '有瓦片')
  // 覆盖 360×240 的视口，最多 (ceil(360/256)+1) * (ceil(240/256)+1) 块
  ok(v.tiles.length <= 3 * 3, '瓦片数克制: ' + v.tiles.length)
  for (const t of v.tiles) {
    ok(t.left > -TILE_SIZE && t.left < w, '左偏移在视口附近: ' + t.left)
    ok(t.top > -TILE_SIZE && t.top < h, '上偏移在视口附近: ' + t.top)
    ok(/^https:\/\/tile\.openstreetmap\.org\/3\/\d+\/\d+\.png$/.test(t.url), 'url 合法: ' + t.url)
  }
  // 中心点应落在视口正中
  ok(near(v.marker.left, w / 2, 1) && near(v.marker.top, h / 2, 1), '中心标记居中: ' + JSON.stringify(v.marker))
})

test('viewportTiles：经度环绕不产生负瓦片号', () => {
  const v = viewportTiles({ lat: 0, lng: 179.9, zoom: 2, width: 360, height: 240 })
  for (const t of v.tiles) {
    const m = t.url.match(/\/2\/(\d+)\/(\d+)\.png$/)
    ok(Number(m[1]) >= 0 && Number(m[1]) < 4, 'x 在 [0,2^z): ' + m[1])
  }
})

test('viewportTiles：纬度越界（极区外）不返回瓦片，也不崩', () => {
  const v = viewportTiles({ lat: 88, lng: 0, zoom: 3, width: 360, height: 240 })
  ok(Array.isArray(v.tiles), '仍返回数组')
  ok(v.tiles.every((t) => { const y = Number(t.url.match(/\/(\d+)\.png$/)[1]); return y >= 0 }), 'y 不为负')
})

test('viewportTiles：zoom 被钳到 [0,19] 的整数', () => {
  ok(viewportTiles({ lat: 0, lng: 0, zoom: 99, width: 100, height: 100 }).zoom === 19, '上限 19')
  ok(viewportTiles({ lat: 0, lng: 0, zoom: -5, width: 100, height: 100 }).zoom === 0, '下限 0')
  ok(viewportTiles({ lat: 0, lng: 0, zoom: 3.6, width: 100, height: 100 }).zoom === 4, '四舍五入')
})

test('isValidLatLng：范围外的值不画', () => {
  ok(isValidLatLng(31.23, 121.47), '上海有效')
  ok(!isValidLatLng(NaN, 0) && !isValidLatLng(0, NaN), 'NaN 无效')
  ok(!isValidLatLng(89, 0), '极区外无效')
  ok(!isValidLatLng(0, 181), '经度越界无效')
})

test('formatLatLng：6 位小数，非法值给占位符', () => {
  ok(formatLatLng(31.2304, 121.4737) === '31.230400, 121.473700', formatLatLng(31.2304, 121.4737))
  ok(formatLatLng(NaN, 1) === '—, 1.000000', formatLatLng(NaN, 1))
})