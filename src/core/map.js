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
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { tiles: [], marker: { left: 0, top: 0 }, zoom: z }

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
  return { tiles, marker: { left: Math.round(px - left), top: Math.round(py - top) }, zoom: z }
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