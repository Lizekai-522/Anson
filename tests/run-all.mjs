// 全量回归：unit（显式文件列表，避免目录空套件误报）→ e2e（含 combo/scale/a11y）。
// 任一失败 exit 1。本地与 CI 均可直接 node tests/run-all.mjs。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const UNIT_FILES = [
  'tests/unit/qr.test.mjs',
  'tests/unit/agents.test.mjs',
  'tests/unit/deep-parse.test.mjs',
  'tests/unit/spring.test.mjs',
  'tests/unit/stress.test.mjs',
  'tests/unit/store-backup.test.mjs',
  'tests/unit/accounts.test.mjs',
  'tests/unit/elder-prefs.test.mjs',
  'tests/unit/codec-v2.test.mjs',
  'tests/unit/trip-invite.test.mjs',
  'tests/unit/map.test.mjs',
  'tests/unit/sos.test.mjs',
  'tests/unit/weather.test.mjs',
  'tests/unit/elder-voice.test.mjs',
  'tests/unit/export.test.mjs',
  'tests/unit/notify.test.mjs',
  'tests/unit/model.test.mjs',
  'tests/unit/upcoming.test.mjs',
  'tests/unit/elder-state.test.mjs',
  'tests/unit/sync.test.mjs',
  'tests/unit/sync-server.test.mjs',
  'tests/unit/store-purge.test.mjs',
]

const stages = [
  ['unit', ['node', '--test', ...UNIT_FILES]],
  ['e2e', ['node', 'tests/run-e2e.mjs']],
]

let failed = []
for (const [name, cmd] of stages) {
  console.log(`\n===== ${name} =====`)
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) failed.push(name)
}

console.log('\n===== 汇总 =====')
if (failed.length) {
  console.log('FAIL:', failed.join(', '))
  process.exit(1)
}
console.log('ALL GREEN')
