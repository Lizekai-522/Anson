// e2e 运行器：拿锁 → 确保 dev server 活着 → node --test 跑全部 e2e 套件。
// dev server 活着就复用（不杀），死了才拉起并在结束后回收。
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireLock, releaseLock, BASE } from './helpers.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const E2E_FILES = [
  'tests/e2e/walk-kid.test.mjs',
  'tests/e2e/deep-combo.test.mjs',
  'tests/e2e/deep-scale.test.mjs',
  'tests/e2e/a11y.test.mjs',
  'tests/e2e/data-manage.test.mjs',
  'tests/e2e/notify.test.mjs',
  'tests/e2e/model-ai.test.mjs',
  'tests/e2e/elder-tasks.test.mjs',
  'tests/e2e/elder-overflow.test.mjs',
  'tests/e2e/elder-notice.test.mjs',
  'tests/e2e/elder-a11y-plus.test.mjs',
  'tests/e2e/elder-sync.test.mjs',
  'tests/e2e/elder-todo.test.mjs',
  'tests/e2e/share-family.test.mjs',
  'tests/e2e/receive.test.mjs',
  'tests/e2e/map-live.test.mjs',
  'tests/e2e/elder-entry.test.mjs',
  'tests/e2e/elder-safety.test.mjs',
  'tests/e2e/elder-guide-voice.test.mjs',
  'tests/e2e/kid-weather.test.mjs',
]

async function alive() {
  try {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch { return false }
}

async function ensureServer() {
  if (await alive()) return null
  const child = spawn('npx', ['vite', '--port', '5190', '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', detached: true, shell: process.platform === 'win32',
  })
  for (let i = 0; i < 60; i++) {
    if (await alive()) return child
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('dev server 30s 内未就绪')
}

acquireLock()
let server = null
let code = 1
try {
  server = await ensureServer()
  const r = spawnSync('node', ['--test', ...E2E_FILES], {
    cwd: ROOT, stdio: 'inherit', timeout: 20 * 60 * 1000, shell: process.platform === 'win32',
  })
  code = r.status ?? 1
} catch (e) {
  console.error('[run-e2e]', e.message)
} finally {
  releaseLock()
  if (server) {
    try { if (server.pid) process.kill(-server.pid) } catch {}
  }
}
process.exit(code)
