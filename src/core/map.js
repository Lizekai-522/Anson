// 在线真实地图的瓦片数学（纯函数，零依赖，方便单测）。
//
// 为什么自己算：只为「把长辈的最新位置画在图上」引入一整个地图库（几十上百 KB）不值当。
// OpenStreetMap 的栅格瓦片就是一组固定尺寸的正方形图片，Slippy Map 的换算只有两个公式：
//   像素 x = (lon + 180) / 360 * 2^z * 256
//   像素 y = (1 - ln(tan(φ) + sec(φ)) / π) / 2 * 2^z * 256
// 拿到中心像素后，把覆盖视口的那几块瓦片按偏移摆上去即可。
//
// 只读展示，不做拖拽/惯性：长辈端不允许动画，子女端也没必要。

export const TILE_SIZE = 256
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

export function lngToTileX(lng, zoom) {
  return ((Number(lng) + 180) / 360) * Math.pow(2, zoom)
}

export function latToTileY(lat, zoom) {
  const r = (Number(lat) * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, zoom)
}

export function tileUrl(x, y, zoom) {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`
}

// 以 (lat,lng) 为中心、zoom 级、width×height 的视口需要哪些瓦片，以及中心的像素位置。
// 纬度方向越界返回空（极区没有瓦片）；经度方向按 2^z 环绕（地图是环面）。
export function viewportTiles({ lat, lng, zoom, width, height, tileSize = TILE_SIZE }) {
  const z = Math.max(0, Math.min(19, Math.round(Number(zoom) || 0)))
  const n = Math.pow(2, z)
  const cx = lngToTileX(lng, z)
  const cy = latToTileY(lat, z)
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { tiles: [], marker: { left: 0, top: 0 }, zoom: z, left: 0, top: 0 }

  const px = cx * tileSize
  const py = cy * tileSize
  const left = px - width / 2
  const top = py - height / 2
  const x0 = Math.floor(left / tileSize)
  const y0 = Math.floor(top / tileSize)
  const x1 = Math.floor((left + width - 1) / tileSize)
  const y1 = Math.floor((top + height - 1) / tileSize)

  const tiles = []
  for (let y = y0; y <= y1; y++) {
    if (y < 0 || y >= n) continue
    for (let x = x0; x <= x1; x++) {
      const wx = ((x % n) + n) % n
      tiles.push({
        key: x + '_' + y,
        left: Math.round(x * tileSize - left),
        top: Math.round(y * tileSize - top),
        url: tileUrl(wx, y, z),
      })
    }
  }
  return { tiles, marker: { left: Math.round(px - left), top: Math.round(py - top) }, zoom: z, left, top }
}

// 把一个坐标投影到某个视口的像素位置（left/top 为 viewportTiles 返回的视口原点）。
// 用于在一张地图上标多个点（如行程的多个目的地）。
export function projectPixel({ lat, lng, zoom, left = 0, top = 0, tileSize = TILE_SIZE }) {
  const z = Math.max(0, Math.min(19, Math.round(Number(zoom) || 0)))
  const px = lngToTileX(lng, z) * tileSize
  const py = latToTileY(lat, z) * tileSize
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null
  return { left: px - left, top: py - top }
}

// 归一化墨卡托坐标（z=0 的一整张瓦片为 [0,1]×[0,1]），与 lngToTileX/latToTileY(z=0) 一致
function normX(lng) { return (Number(lng) + 180) / 360 }
function normY(lat) {
  const r = (Number(lat) * Math.PI) / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
}
function invNormY(y) {
  const n = Math.PI * (1 - 2 * y)
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

// 把一组点放进 width×height 的视口里自动取景：返回 { center, zoom, points }，无有效点返回 null。
// 单个点给一个默认城市级 zoom；多个点取能同时容下所有点的最大 zoom（留 padding）。
export function fitPointsViewport({ points, width, height, padding = 28, tileSize = TILE_SIZE, minZoom = 3, maxZoom = 16 } = {}) {
  const pts = (points || []).filter((p) => p && isValidLatLng(p.lat, p.lng))
  if (!pts.length) return null
  const clean = pts.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
  if (clean.length === 1) {
    return { center: { lat: clean[0].lat, lng: clean[0].lng }, zoom: Math.min(maxZoom, 14), points: clean }
  }
  const xs = clean.map((p) => normX(p.lng))
  const ys = clean.map((p) => normY(p.lat))
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const availW = Math.max(1, Number(width) - padding * 2)
  const availH = Math.max(1, Number(height) - padding * 2)
  const spanX = Math.max(1e-9, maxX - minX)
  const spanY = Math.max(1e-9, maxY - minY)
  // 像素跨度 = span * 2^z * tileSize ≤ 可用宽高 → 取满足条件的最大 z
  const capX = Math.log2(availW / (spanX * tileSize))
  const capY = Math.log2(availH / (spanY * tileSize))
  let z = Math.floor(Math.min(capX, capY))
  if (!Number.isFinite(z)) z = minZoom
  z = Math.max(minZoom, Math.min(maxZoom, z))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  return {
    center: { lat: invNormY(centerY), lng: centerX * 360 - 180 },
    zoom: z,
    points: clean,
  }
}

// 经纬度是否是可画在地图上的有效值
export function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180
}

// 经纬度 → 可读文本（6 位小数，够日常定位用）
export function formatLatLng(lat, lng) {
  const f = (v) => (Number.isFinite(v) ? Number(v).toFixed(6) : '—')
  return f(lat) + ', ' + f(lng)
}