// 安程 · 通知服务启动入口（零依赖）。
//   node server/notify-server.mjs --serve-dist            # 同源把 dist 也发出去（推荐）
//   node server/notify-server.mjs --port 5180             # 只提供 /api/notify*
// 配了服务商密钥才会真的发送；没配就返回 501，前端自动回落到用户手机上的短信/邮件。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, activeProviders } from './app.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// 极简 .env 读取（没有依赖，就不为了 dotenv 引一个包）：只填还未设置的变量
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i <= 0) continue
    const k = s.slice(0, i).trim()
    const v = s.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
}

loadEnvFile(path.join(ROOT, '.env'))

const args = process.argv.slice(2)
const portArg = args.indexOf('--port')
const port = Number(portArg >= 0 ? args[portArg + 1] : (process.env.NOTIFY_PORT || 5180))
const serveDist = args.includes('--serve-dist')

const act = activeProviders(process.env)
const server = createServer(process.env, { serveDist })
server.listen(port, () => {
  console.log('[notify] 监听 http://localhost:' + port + (serveDist ? '  （同时发布 dist/）' : ''))
  console.log('[notify] 短信通道：' + (act.sms ? act.sms.id : '未配置 → 前端回落本机短信'))
  console.log('[notify] 邮件通道：' + (act.email ? act.email.id : '未配置 → 前端回落本机邮件'))
  console.log('[sync] 同步接口：已启用（/api/sync/*，内存态，长辈端动作与位置回传）')
})