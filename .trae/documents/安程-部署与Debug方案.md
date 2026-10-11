# 安程 · 部署起来 + Debug（只出问题清单）

> 用户已确认两项决策：
> 1. **部署形态 = 开发态 dev server**（`npm run dev` → http://localhost:5190）
> 2. **产出方式 = 只出问题清单，先不改代码**（发现问题只记录：现象 / 复现步骤 / 疑似根因 / 建议修法）

---

## 1. 目标与边界

**做什么**
- 把当前最新代码在开发态跑起来，给用户一个可打开的预览地址
- 跑一遍机器层回归（单测 + e2e），再用真实浏览器对**本轮新增的长辈端功能**做走查
- 产出一份可直接执行的问题清单，**不改动任何业务代码**

**不做什么**
- 不改 `src/`、`server/`、`tests/` 里的任何文件
- 不做生产部署（Docker / nginx / `--serve-dist`）、不打包 zip（用户本轮没要求）

**必须如实声明的边界（写进最终清单）**
- dev server **没有后端接口**，`/api/sync/ping` 不会 200 → 同步只能验**同设备轨**（BroadcastChannel + localStorage 镜像）
- 因此 **服务端轨（`/api/sync/*`）与「跨设备」同步本轮不下结论**，标注为「未验证（需 `node server/notify-server.mjs --serve-dist` 才能测）」
- 定位在 `localhost` 属安全上下文，可测；但只覆盖「同设备」路径（因为同步也是同设备轨）
- 单文件 `file://`、PWA 离线不在本轮范围

---

## 2. 现状（探索结论，已读文件）

| 关注点 | 事实 |
|---|---|
| 起服务 | `npm run dev` = `vite --port 5190 --strictPort --host`（[package.json](file:///workspace/package.json#L8)） |
| 测试基址 | `tests/helpers.mjs` 的 `BASE` 默认 `http://localhost:5190`（[helpers.mjs](file:///workspace/tests/helpers.mjs#L20)） |
| e2e 运行器 | `run-e2e.mjs` 会**探测 5190 是否活着，活着就复用、不杀**（[run-e2e.mjs](file:///workspace/tests/run-e2e.mjs#L31-L41)）；全量入口 `npm test` = `run-all.mjs` |
| e2e 清单 | 12 个套件，含本轮新增 `elder-tasks / elder-overflow / elder-notice / elder-a11y-plus / elder-sync`（[run-e2e.mjs](file:///workspace/tests/run-e2e.mjs#L9-L22)） |
| 长辈端任务态 | `done/collapsed/dismissed` 三张表，按 room 隔离、白名单校验（[elderState.js](file:///workspace/src/core/elderState.js)） |
| 提醒管线 | 纯函数：`lead=60min`、`second=20min`、`grace=5min`，键 `segId:stage`（[upcoming.js](file:///workspace/src/core/upcoming.js#L10-L12)） |
| 同步通道 | 双轨：有服务端走 `/api/sync/<room>/push|pull`（4s 轮询），否则 BroadcastChannel + 镜像；事件按 id 去重（[sync.js](file:///workspace/src/core/sync.js)） |
| 位置共享 | 双开关：子女在分享页开 `shareLocation` + 长辈自己点按钮；60s 节流（[LocationShare.vue](file:///workspace/src/elder/LocationShare.vue)） |
| 卡片结构 | 完成态压成一行但保留卡片底/描边/顶线；折叠用 `v-show` + `aria-expanded`（[DayView.vue](file:///workspace/src/elder/DayView.vue#L87-L134)） |
| 关键契约 | `upcoming.js` 的 `keyOf` 与 `elder-shared.cardKey` 规则一致（有 segId 用 segId，否则 `i+下标`）——已比对，一致 |

---

## 3. 执行步骤

### 步骤 A：把最新代码跑起来
1. 先探测 5190 是否已有实例（`curl -s -o /dev/null -w '%{http_code}' http://localhost:5190/`）：
   - 返回 200 → 直接复用，不重复起
   - 否则 → 后台起 `npm run dev`（非阻塞），轮询直到 5190 返回 200
2. `curl` 校验 `GET /` 返回 200 且 body 含应用挂载点
3. 用 `OpenPreview` 把 `http://localhost:5190` 的预览地址给用户

**判据**：5190 返回 200，浏览器能打开首页（出现身份选择页）。

### 步骤 B：机器层回归（零代码改动）
1. 跑 `npm test`（= unit + e2e；会复用步骤 A 的 5190）
2. 记录：通过数 / 失败数 / 失败断言的原文
3. 对每条失败归类：**真 bug** / **测试期望过时** / **环境噪声（时序、字体、端口）**

**判据**：拿到完整通过/失败汇总，失败项都有归类结论。

### 步骤 C：真实浏览器走查（chrome-devtools MCP 优先）
逐条构造最小复现路径。造数据优先用 `tests/helpers.mjs` 的 `buildElderToken` + `makeRideCard` 思路（自包含链接，能精确控制边界字段），必要时再走 UI 注册→导入→分享。

| 编号 | 走查点 | 具体判据 |
|---|---|---|
| C1 | 完成打勾压缩 | 点「走完了」→ 卡片变一行、**仍是卡片**（有底/描边/顶线）、标题带删除线、出现「已走完」、按钮变「改回没走完」；再点可还原 |
| C2 | 卡片折叠 | 点卡片标题区 → 正文收起、`aria-expanded=false`；再点展开；刷新后状态保持 |
| C3 | 出发提醒 | 造「出发时刻 = now + 30min」的卡 → 出现弹窗；点「去看看」→ 滚到该卡且高亮，6s 后高亮消失；点「知道了」→ 同 stage 不再弹；把时间推进到 +15min 附近重载 → second stage 仍会弹 |
| C4 | 长辈动态（同设备轨） | 同一浏览器两个标签：长辈端 + 子女端同一 token → 长辈端点击后，子女端时间线出现对应文案、按 id 去重、无重复条目；模式标注为「仅同设备可见」 |
| C5 | 位置共享 | 用 CDP 授权 geolocation（固定坐标 + accuracy）→ 点「让子女看到我在哪」→ 子女端「长辈现在在哪」出现坐标/精度/更新时间/地图链接；点「停止共享位置」→ 出现停止事件 |
| C6 | 乱码 / 溢出 | 三主题（day/night/contrast）× 三字号（1/1.12/1.25）下，注入含**生僻字、emoji、零宽字符、超长站名**的卡片 → 390px 宽无横向溢出（`scrollWidth <= clientWidth`）、无 `□`/`` 方框乱码 |
| C7 | 运行期健康 | 收集 console error、未捕获异常、失败请求（4xx/5xx、被 abort 的 fetch） |

**判据**：每条走查点给出「符合预期 / 不符合预期（附证据）」。

### 步骤 D：产出问题清单
写到 `/workspace/.trae/documents/安程-Debug问题清单.md`，每条固定结构：

```
### [严重级] 一句话标题
- 现象：
- 复现步骤：1)… 2)… 3)…
- 证据：截图路径 / 断言原文 / console 文本
- 疑似根因：文件:行 + 一句话
- 建议修法：怎么改（本轮不改）
- 验证方式：改完后怎么确认好了
```

严重级用 `P0 阻塞 / P1 明显可用性问题 / P2 一致性或体验瑕疵 / P3 建议`。
最后用 `computer://` 链接把清单交付给用户。

**判据**：清单里每条都带可复现步骤 + 证据 + `file:line`，且明确标注哪些结论因 dev 环境限制而未验证。

---

## 4. 已定位的候选项（待步骤 C 证实 / 证伪）

以下是**读码阶段**发现的疑点，不是结论；步骤 C 逐条验证后再决定是否写进清单。

1. **已完成的分段仍会弹「快出发了」**：`upcomingList` 只按日期/时刻/kind 过滤，不看 `done`（[upcoming.js](file:///workspace/src/core/upcoming.js#L73-L88)）；`refreshNotice` 只过滤 `dismissed`（[ElderPage.vue](file:///workspace/src/elder/ElderPage.vue#L136-L151)）。→ 长辈已标「走完了」，到点还会被催。
2. **倒计时条同样不过滤已完成**：`nextText` 用 `nextUpcoming`，也没看 `done`（[ElderPage.vue](file:///workspace/src/elder/ElderPage.vue#L175-L179)）。
3. **`loc-on` 事件永远不会发生**：子女端有时间线文案映射 `'loc-on' → 长辈开始共享位置`（[TripPage.vue](file:///workspace/src/pages/TripPage.vue#L281-L285)），但 `LocationShare` 只推 `location` 与 `loc-off`，从不推 `loc-on`（[LocationShare.vue](file:///workspace/src/elder/LocationShare.vue#L60-L84)）。→ 时间线看不到「开始共享位置」。
4. **同步探测失败后无自愈**：`subscribe` 内的 `poll()` 在 `syncMode() !== 'server'` 时直接 return，而 `syncMode()` 只读 30s 缓存的 `pingCache.ok`，**不会重新探测**（[sync.js](file:///workspace/src/core/sync.js#L162-L175)、[sync.js](file:///workspace/src/core/sync.js#L38-L40)）。→ 首探失败后即便服务端起来也不会自动接上。
5. **坏链接也建房间并上报**：`resolveRoute` 在 `malformed` 分支仍保留 `token`，随后 `syncRoom()` 会派生出 room 并 `push('trip-open')`（[ElderPage.vue](file:///workspace/src/elder/ElderPage.vue#L197-L226)、[ElderPage.vue](file:///workspace/src/elder/ElderPage.vue#L102-L115)）。→ 无效 token 也占一个房间、产生一条噪声事件。

---

## 5. 假设与决策

| 项 | 决定 |
|---|---|
| 端口 | 固定 5190；已存在则复用（与 `run-e2e.mjs` 同规则） |
| 是否起后端 | 否（用户选了 dev server）。涉服务端轨的结论一律标注「未验证」 |
| 浏览器工具 | 优先 chrome-devtools MCP；定位用 CDP 授权 + 固定坐标 |
| 代码改动 | **零改动**；只写问题清单文档（`.trae/documents/` 下） |
| 终态 | 交付问题清单 + dev server 预览地址；不打包、不提交、不改源码 |

---

## 6. 验证步骤（对应第 3 节判据）

1. **A**：`curl -s -o /dev/null -w '%{http_code}' http://localhost:5190/` 输出 `200`；`OpenPreview` 返回可用地址。
2. **B**：`npm test` 退出码与汇总被完整记录；每条失败都有归类。
3. **C**：C1–C7 每条给出「符合/不符合 + 证据」；C6 以 `scrollWidth <= clientWidth` 为硬断言。
4. **D**：问题清单文件存在，条目 ≥ 1，每条含复现步骤 / 证据 / `file:line` / 建议修法；放宽项（服务端轨）已标注未验证。

---

## 7. 交付物

- 开发态预览地址（`http://localhost:5190`，经 `OpenPreview` 给出）
- [安程-Debug问题清单.md](file:///workspace/.trae/documents/安程-Debug问题清单.md)（新增文档，非代码）