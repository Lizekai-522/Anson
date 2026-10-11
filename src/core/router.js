// 自研 hash 路由（11 条路由，不值得引 vue-router）
import { reactive } from 'vue'

function normalize(h) {
  if (!h || h === '#') return '/'
  let p = h.startsWith('#') ? h.slice(1) : h
  if (!p.startsWith('/')) p = '/' + p
  return p
}

const state = reactive({ path: normalize(location.hash) })
const listeners = new Set()

function fire() {
  state.path = normalize(location.hash)
  listeners.forEach((fn) => {
    try { fn(state.path) } catch (e) { console.error('[router] listener error', e) }
  })
}

export function installRouter() {
  window.addEventListener('hashchange', fire)
  fire()
}

export function useRoute() {
  return state
}

// 把 '/trip/abc' 解析成 { pattern:'/trip/:id', params:{id:'abc'} }
export function matchPath(pattern, path) {
  const pp = pattern.split('/').filter(Boolean)
  const cp = path.split('?')[0].split('/').filter(Boolean)
  if (pp.length !== cp.length) return null
  const params = {}
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(cp[i])
    else if (pp[i] !== cp[i]) return null
  }
  return params
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path
  if (location.hash === target) { fire(); return }
  if (replace) {
    history.replaceState(null, '', target)
    fire()
  } else {
    location.hash = target
  }
}

export function onRouteChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
