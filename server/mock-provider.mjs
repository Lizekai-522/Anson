// 假服务商：本地联调 / e2e 用。把 provider 的 BASE_URL 指过来，就能把"真实发送"这条链路整条跑通。
//   ALIYUN_SMS_BASE_URL=http://localhost:5181/aliyun
//   TWILIO_BASE_URL=http://localhost:5181/twilio
//   RESEND_BASE_URL=http://localhost:5181/resend
// 收到的请求都记下来，GET /__requests 可查（e2e 正是靠它断言"确实发出去了"）。
import http from 'node:http'

const requests = []

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function body(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => resolve(raw))
  })
}

// 导出 server 句柄：测试里 import 之后要能关掉它，否则监听会一直占着事件循环
export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'))

  if (url.pathname === '/__requests') {
    if (req.method === 'DELETE') { requests.length = 0; return json(res, 200, { ok: true }) }
    return json(res, 200, { requests })
  }

  const raw = await body(req)
  const item = {
    // 容忍尾斜杠：provider 拼出来的可能是 /aliyun/?...
    kind: url.pathname.replace(/^\/+|\/+$/g, ''),
    query: Object.fromEntries(url.searchParams),
    body: raw,
    at: Date.now(),
  }
  requests.push(item)

  if (item.kind === 'aliyun') return json(res, 200, { Code: 'OK', Message: 'OK', RequestId: 'mock-' + requests.length })
  if (item.kind === 'twilio') return json(res, 201, { sid: 'SM' + requests.length, status: 'queued' })
  if (item.kind === 'resend') return json(res, 200, { id: 'mock-mail-' + requests.length })
  return json(res, 404, { error: 'unknown provider path' })
})

const portArg = process.argv.indexOf('--port')
const port = Number(portArg >= 0 ? process.argv[portArg + 1] : (process.env.MOCK_PORT || 5181))
server.listen(port, () => console.log('[mock-provider] http://localhost:' + port))