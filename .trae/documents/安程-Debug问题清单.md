# 安程 · Debug 问题清单

> 部署形态：开发态 dev server（`npm run dev` → http://localhost:5190，`GET /` = 200）
> 机器层回归：`npm test` **ALL GREEN**（unit 163/163、e2e 88/88），无产品缺陷被既有断言捕获。
> 本轮额外用一次性浏览器探针（`.debug-probe.mjs`，跑完即删）覆盖既有 e2e 未测的部分。
> **零代码改动**：本清单只记录问题，未修改 `src/`、`server/`、`tests/` 任何文件。

## 结论速览

| # | 严重级 | 标题 | 是否运行期复现 |
|---|---|---|---|
| 1 | P1 | 同步探测失败后仍无条件 `POST /api/sync/*/push`（守卫恒假） | 是（探针健康日志） |
| 2 | P1 | 已「走完了」的分段仍弹出发提醒、仍进倒计时 | 是（探针） |
| 3 | P2 | 损坏的分享链接也会建同步房间并广播 `trip-open` | 是（探针） |
| 4 | P2 | `loc-on` 事件从不发出，子女端看不到「开始共享位置」 | 是（探针） |
| 5 | P2 | `sanitizeText` 未清洗 bidi / 隔离控制符 | 是（探针） |
| 6 | P2 | 同步探针失败后 `poll()` 不自愈 | 否（仅代码级确认，需服务端） |

---

### [P1] 同步探测失败后仍无条件 `POST /api/sync/*/push`

- **现象**：在**没有同步服务端**的环境（本轮 dev server 即如此）里，长辈端每次产生事件（打开行程、点完成、位置上报…）都会向 `/api/sync/<room>/push` 发一次注定失败的 POST，控制台刷 404。与设计注释「两条轨道都尽力而为：任何失败都静默」相矛盾。
- **复现步骤**：1) `npm run dev` 起 5190（无 `/api` 后端）；2) 打开任一长辈端链接；3) 看 DevTools Network，出现 `POST /api/sync/<room>/push → 404`；或看探针输出 `elder:reqfail:/api/sync/<room>/push`。
- **证据**：
  - 探针健康日志（device 模式、无服务端）：`elder:reqfail:http://localhost:5190/api/sync/0db3w9416imyfs/push:net::ERR_ABORTED` ×3，伴随 `Failed to load resource: 404`。
  - 直接验证 dev 行为：`GET /api/sync/ping`（无 accept）→ 200 HTML；而浏览器带 `accept: application/json` → 404；`POST /api/sync/room/push` → 404。即本环境 `/api` 一律不可用。
  - `syncMode()` 返回**字符串** `'server' | 'device'`（[sync.js](file:///workspace/src/core/sync.js#L40)），两者都是真值。
- **疑似根因**：
  - [sync.js](file:///workspace/src/core/sync.js#L100-L101) `push()` 里 `if (!syncMode()) return false` —— `syncMode()` 恒为真值字符串，`!syncMode()` **恒为 false**，守卫永远不生效，于是继续往下 fetch。
  - [sync.js](file:///workspace/src/core/sync.js#L117-L118) `pushPresence()` 同样的写法，同一 bug。
  - 对照：[sync.js](file:///workspace/src/core/sync.js#L164) 的 `poll()` 用的是正确写法 `syncMode() !== 'server'`，说明是 `push` 分支写错，不是设计如此。
- **建议修法**：把两处改为 `if (syncMode() !== 'server') return false`（与 `poll()` 对齐）。本轮不改。
- **验证方式**：改后重跑探针，健康日志里不再出现 `/api/sync/*/push` 的 reqfail/404；或加单测：`probeSync` 失败时 `push()` 返回 `false` 且不调用 `fetch`。

---

### [P1] 已「走完了」的分段仍弹出发提醒、仍进倒计时

- **现象**：长辈手动把某段标成「走完了」后，若该段出发时刻还没到（例如提前点完成），到点仍会弹「快出发了」弹窗；页面顶部倒计时条也把这段算作「下一段」。
- **复现步骤**：1) 构造出发时刻 = 现在 + 约 30 分钟的卡；2) 预置该段 `done=true`（或 UI 点「走完了」）；3) 打开长辈端 → 出现 `.notice-mask` 弹窗，且 `下一段：还有 29 分钟` 仍指向该已走完段。
- **证据**（探针 `done` 段）：
  - `card_is_done=1`（卡片渲染为完成态）
  - `notice_shown_for_done_card=1`（**仍然弹窗**）
  - `countdown_text_for_done_card=下一段：还有 29 分钟`
- **疑似根因**：
  - 提醒过滤只看 `dismissed`，不看 `done`：`refreshNotice()` 里 `upcomingList(...).filter(it => shouldRemind(tasks.value, it, now))`（[ElderPage.vue](file:///workspace/src/elder/ElderPage.vue#L136-L151)）。
  - 倒计时同样不看 `done`：`nextText` 用 `nextUpcoming(cards, ...)`（[ElderPage.vue](file:///workspace/src/elder/ElderPage.vue#L175-L179)）。
  - `upcoming.js` 的 `upcomingList / nextUpcoming / shouldRemind` 压根不接收 `done`（[upcoming.js](file:///workspace/src/core/upcoming.js#L57-L95)）。
  - 触发前提是**手动**标完成（`done` 只由 `onToggleDone` 写入，[ElderPage.vue](file:///workspace/src/elder/ElderPage.vue#L118-L125)；无自动完成逻辑）——所以是「长辈误点/提前点完成」这类场景会命中。
- **建议修法**：在 `refreshNotice` 与 `nextText` 的候选里过滤掉 `tasks.value.done[segId]`（或给 `upcoming.js` 加 `done` 入参统一过滤）。本轮不改。
- **验证方式**：e2e 预置 `done: { seg0: 1 }` 且出发在 30 分钟内 → 断言 `.notice-mask` 为 0、且倒计时文案不指向该段。

---

### [P2] 损坏的分享链接也会建同步房间并广播 `trip-open`

- **现象**：打开一个错的/复制漏字符的分享链接（页面显示「链接好像不对」）时，长辈端仍会用这个坏 token 派生出一个同步房间、写入本机镜像、并广播一条 `trip-open`。服务端模式下会向一个无人监听的随机房间 POST。
- **复现步骤**：1) 打开 `#/e/this-is-not-a-real-token-9f2a`；2) 页面显示「链接好像不对」；3) 看 localStorage，出现 `ptb:sync:<hash>` 键，内容含 `trip-open` 事件。
- **证据**（探针 `bad` 段）：
  - `sync_mirror_keys=1`
  - `sync_mirror_has_trip_open=true`
  - `sync_mirror_value_prefix={"events":[{"id":"...","type":"trip-open","segId":"","at":...,"data":null}],"presence":null}`
- **疑似根因**：
  - `resolveRoute` 在 `malformed`/`expired` 分支仍把 `token` 设成坏值（[ElderPage.vue](file:///workspace/src/elder/ElderPage.vue#L207-L223)），随后无条件 `syncRoom()`。
  - `syncRoom()` 只要 `token` 非空就派生 room 并 `push('trip-open')`，不检查解码状态（[ElderPage.vue](file:///workspace/src/elder/ElderPage.vue#L102-L115)）。
- **影响**：每打开一个坏链接就多一个 `ptb:sync:*` 残留键，并产生一条跨标签/服务端噪声事件。
- **建议修法**：`syncRoom()` 开头加 `if (state.value !== 'ok') { room.value = ''; syncedToken = ''; tasks.value = empty; return }`。本轮不改。
- **验证方式**：探针/e2e 断言：打开坏链接后 localStorage 无 `ptb:sync:*` 键、Network 无 `/api/sync/*/push`。

---

### [P2] `loc-on` 事件从不发出，子女端看不到「开始共享位置」

- **现象**：长辈点了「让子女看到我在哪」后，子女端「长辈动态」时间线里只出现「长辈更新了位置」，永远看不到「长辈开始共享位置」这一条（尽管文案映射已经存在）。停止时能正常看到「长辈停止了共享位置」。
- **复现步骤**：1) 子女端分享页打开「允许长辈共享位置」并生成链接；2) 长辈端打开链接，点「让子女看到我在哪」；3) 子女端刷新看「长辈动态」。
- **证据**（探针 `loc` 段）：
  - `kid_feed_has_loc_update=true`
  - `kid_feed_has_loc_on=false` ← 缺
  - `kid_feed_has_loc_off=true`
  - `kid_feed_sample=长辈更新了位置 刚刚 长辈打开了这次行程 刚刚`
- **疑似根因**：`startShare()` 只启动 `watchPosition`，首个定位回调里推的是 `location` 事件，**从不推 `loc-on`**（[LocationShare.vue](file:///workspace/src/elder/LocationShare.vue#L60-L76)）；而 `stopShare()` 会推 `loc-off`（[LocationShare.vue](file:///workspace/src/elder/LocationShare.vue#L83)）。子女端已为该类型备好文案（[TripPage.vue](file:///workspace/src/pages/TripPage.vue#L281)）。
- **建议修法**：在 `startShare()` 成功启动（或首个 fix 到达）时 `push(props.room, [makeEvent('loc-on', '')])`，与 `loc-off` 对称。本轮不改。
- **验证方式**：探针断言 `kid_feed_has_loc_on=true`；或 e2e 增加同款断言。

---

### [P2] `sanitizeText` 未清洗 bidi / 隔离控制符

- **现象**：从短信粘贴的站名若含**双向文本控制符**（U+202A–U+202E 覆盖/嵌入、U+2066–U+2069 隔离、U+200E/U+200F、U+061C），会被原样渲染进卡片，可能造成文字被视觉重排（邻近「乱码」红线）。现有净化只挡了零宽/替换字符/常规控制符。
- **复现步骤**：1) 构造含 `\u202E`、`\u2066`、`\u2069` 的 `from/to/note` 的卡；2) 三主题 × 大字号打开长辈端；3) 检查渲染文本是否仍含这些字符。
- **证据**（探针 `dirty` 段，三主题一致）：
  - `day/1.25 → {"docOverflow":0,"badCards":0,"fffd":false,"zw":false,"ctrl":false,"bidi":true}`
  - `night/1.25 → { ..., "bidi":true }`；`contrast/1.25 → { ..., "bidi":true }`
  - 说明无溢出、无 FFFD、无零宽（既有 e2e 已覆盖，均通过），但 **bidi:true** 未被清洗。
- **疑似根因**：`sanitizeText` 的字符类只覆盖 `\u0000-\u001F`（除 \t\n\r）、`\u200B-\u200D\u2060\uFEFF`、`\uFFFD`、`\u3000`（[agents.js](file:///workspace/src/core/agents.js#L575-L583)），漏掉 `\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069`。
- **建议修法**：在上述正则里补 `[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]` 一并置空。本轮不改。
- **验证方式**：扩 `tests/e2e/elder-overflow.test.mjs`，在脏字符里加入 bidi 字符并断言 `document.body.innerText` 不含 `[\u202A-\u202E\u2066-\u2069]`。

---

### [P2]（运行期未验证）同步探针失败后 `poll()` 不自愈

- **现象（预期）**：若首次探测时服务端还不可用，之后服务端起来了，长辈端/子女端**不会自动接上**服务端轨，只能靠手动刷新。
- **疑似根因**：`subscribe()` 的 `poll()` 在 `syncMode() !== 'server'` 时直接 return（[sync.js](file:///workspace/src/core/sync.js#L162-L175)），而 `syncMode()` 只读 `pingCache.ok`（[sync.js](file:///workspace/src/core/sync.js#L40)），`poll` 内部**不重新探测**；`probeSync` 仅在 `push`（`pingCache.at===0`）与 `syncRoom` 里被调用。首探失败后 30s 缓存虽过期，但没有任何地方会因过期而重探。
- **为何未验证**：本轮 dev server 无 `/api` 后端，「服务端后起→自动接上」的时间线无法在 dev 复现。**需 `node server/notify-server.mjs --serve-dist` 之类真服务端**才能运行期证实。
- **建议修法**：`poll()` 每次进入前，若缓存过期则 `await probeSync()` 重探一次（或按 N 次轮询周期做一次带节流的重探）。本轮不改。
- **验证方式**：起真实服务端→先断→打开长辈端→再起服务端→观察是否在若干秒内自动切到「已接入同步服务」。

---

## 已走查通过、未发现问题的点（供对照）

| 走查点 | 结果 |
|---|---|
| C1 完成打勾压缩（变一行/仍卡片/删除线/可还原） | 通过（e2e 覆盖，ALL GREEN） |
| C2 卡片折叠（`aria-expanded`、刷新保持） | 通过（e2e 覆盖） |
| C3 出发提醒主路径（弹窗/跳转高亮/dismiss/second stage） | 主路径通过；仅「已完成段仍提醒」见 #2 |
| C4 长辈动态（同设备轨、按 id 去重、文案） | 通过；仅缺 `loc-on` 见 #4 |
| C5 位置共享（同设备轨端到端） | 通过：`kid_coord=31.230400, 121.473700`、`精度约 ±35 米`、停止事件可见；**跨设备未验证（见下）** |
| C6 乱码/溢出（超长站名、零宽、FFFD ×3 主题 ×3 字号） | 通过：无横向溢出；仅 bidi 未清洗见 #5 |
| C7 运行期健康 | 无未捕获异常（`pageerror` = 0）；仅 `/api/*` 404（dev 无后端，环境所致） |

---

## 因 dev 环境限制而未验证的结论

1. **跨设备 / 服务端同步轨（`/api/sync/*` 真实收发）**：dev server 是纯 Vite，无 `/api` 代理，也无 Node 后端随 dev 启动 → 所有 `/api` 请求 404，前端一律回落到「同设备轨」。本轮位置共享、长辈动态的端到端**只在同一浏览器上下文（同设备）**验证通过，**服务端轨与跨设备同步未验证**。
2. **短信/邮件「服务端送达」通道**：`/api/notify/config` 在 dev 同样 404 → 只验证了回落「调起本机短信/邮件 App」的分支，服务端（阿里云/Twilio/Resend 等）实际送达未验证。
3. **定位的真实安全上下文要求**：dev 用 `localhost`（浏览器视为安全上下文），定位可用；真机通过 `http` 局域网访问时「手机不让传位置」的降级提示未做真机验证。
4. **位置节流与轨迹**：60s 节流只在单点/短时验证，长途连续上报的节流效果与服务端「只留最新 presence」未验证。
5. **#6 探针自愈**：见该条说明，运行期未验证。

---

## 交付

- 开发态预览地址：http://localhost:5190
- 本清单：`.trae/documents/安程-Debug问题清单.md`
- 一次性探针 `.debug-probe.mjs` 已按约定删除，未改动任何 `src/`、`server/`、`tests/`。

> 说明：用户提到的 `deep-research-assistant` 插件面向「外部资料检索 / 引用核验」，与「本地代码库调试」不匹配，本轮未启用该插件，改用仓库内真实浏览器探针取证。