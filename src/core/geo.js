// 目的地坐标：把「厦门」这类城市名翻成经纬度，供行程页的「路线地图」画点。
//
// 设计取舍与 weather.js 完全一致：
// - 只走本应用的 /api/geocode（服务端复用 Open-Meteo geocoding），不引地图 SDK；
// - 只传城市名，不上报任何坐标（隐私）；
// - normalizeGeo 是纯函数、可单测；拿不到就静默返回 null，绝不阻塞行程页。

// 校验并规整服务端返回：形状不对就当作没有坐标
import { encodeCityParam } from './weather.js'

export function normalizeGeo(data) {
  if (!data || typeof data !== 'object' || data.ok !== true) return null
  const lat = Number(data.lat)
  const lng = Number(data.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180) return null
  return { city: String(data.city || ''), lat, lng }
}

// 查一个城市的坐标：失败/超时/服务端没配 → 返回 null（调用方静默）
export async function fetchCityCoords(city, { fetchImpl, timeoutMs = 5000, base = '' } = {}) {
  const name = String(city || '').trim()
  if (!name) return null
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  if (!doFetch) return null
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  try {
    const r = await doFetch(base + '/api/geocode?city=' + encodeCityParam(name), ctl ? { signal: ctl.signal } : undefined)
    if (!r || !r.ok) return null
    const data = await r.json().catch(() => null)
    return normalizeGeo(data)
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}