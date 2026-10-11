# 爸妈出行宝 · Web 应用交付方案（第二轮）

## 一、目标与范围

在既有 Vue 3 项目上完成四条线，把「爸妈出行宝」从"功能已完整、但缺文档缺部署"的项目，推进为**可对外演示、可安装、可自托管的正式 Web 应用**：

1. **视觉与体验升级** —— 提炼与统一既有「暖纸书卷」设计系统，补齐状态与响应式
2. **功能缺口补齐** —— 备份导入恢复、段级增删、账号管理、二维码长内容降级、搜索扩展
3. **上线交付** —— 可访问预览 + PWA 可安装/离线 + 自托管部署参考
4. **工程收尾** —— README、清理死代码、CI、注释一致性

**不改变**：技术栈（Vue 3 + Vite）、零运行时外部依赖、无后端、长辈端适老化硬指标。

---

## 二、现状分析

### 已有资产（可直接复用，不重做）

| 层 | 内容 |
|---|---|
| 内核（7 个自研模块） | `src/core/`：router / store / accounts / agents（三智能体管线）/ qr（自研二维码）/ share-codec / spring |
| 子女端 10 页 | `src/pages/`：Welcome / Login / Register / RecentAccounts / Home / Import / Trip / Family / Share / Profile |
| 长辈端 1 页 | `src/elder/ElderPage.vue`（状态机 code/ok/expired/malformed，免登录直达） |
| 样式系统 | `src/styles/global.css`：暖纸书卷 token（色彩/圆角/阴影/字体），`.paper-card` `.btn` `.tag` |
| 测试 | 106 项全绿：unit 64（qr/agents/deep-parse/spring/stress）+ e2e 42（walk-kid / deep-combo / deep-scale / a11y） |
| 产物 | `dist/`（多文件）+ `dist/爸妈出行宝-单文件.html`（181KB，file:// 可跑） |

### 已识别缺口（本方案要解决的）

1. **零文档**：无 README、无任何 *.md、无路线图
2. **无部署配置**：有 `build:single` 交付脚本，但无 Dockerfile / nginx / CI / static host 配置
3. **半成品三处**：Profile 只能导出备份**无法导入恢复**；TripPage 段落只能改**不能增删**；最近账号只读**无法删除**
4. **注释不一致**：`SharePage.vue` 写"二维码 version 40 上限"，实际 `qr.js` `MAX_VERSION = 25`
5. **死代码**：根目录 6 个 `debug-qr*.mjs`，且引用了 `qr.js` 未导出的 `qrMatrix`，早已失效
6. **一致性债务**：`.page-head` / `.block` / `.btn-sm` / `.arming` / `.empty` 在 5 个页面各自 scoped 重复实现；页面无统一空/错状态版式
7. **可访问性缺口**：子女端只有 5 张桌面截图基线，无移动端宽度与溢出检查
8. **编辑不联动**：TripPage 改 `from/to` 后只更新 `seg.from/to`，`seg.plain`（人话/语音/tips）保持旧值，长辈页语音与提示会与实际不符

### 不可回退约束（改动红线）

- 长辈端：**零动画**、纯白底、正文 ≥28px、主按钮 ≥72px、触控区 ≥60×60（`tests/e2e/a11y.test.mjs` 逐条机器断言）
- 零运行时外部依赖：不引 UI 库、图标库、网络字体（离线可用是产品前提）
- 无后端、无云同步、账号只在本机（诚实边界，不变）

---

## 三、改动方案

### 执行顺序

```
第 0 步 基线 → 第 1 步 W4 清理 → 第 2 步 W2 功能 → 第 3 步 W1 视觉 → 第 4 步 W3 交付 → 第 5 步 全量回归
```

> W2 先于 W1：功能会新增 UI（恢复按钮、段增删表单），先加功能再用新的样式体系统一，避免同一处改两遍。

---

### 第 0 步：基线

- 跑 `npm test` 确认起点全绿（当前应为 unit 64 + e2e 42）
- 保留现有 `tests/screenshots/*.png` 作为改动前对照

---

### 第 1 步（W4-清理）：清死代码与注释一致性

| 文件 | 动作 | 为什么 |
|---|---|---|
| `/workspace/debug-qr.mjs` ~ `debug-qr6.mjs` | **删除 6 个文件** | 自述"不属于交付物"，且 `import { qrMatrix }` 在 `qr.js` 中不存在，已失效 |
| `/workspace/src/pages/SharePage.vue` 第 66 行注释 | "version 40 上限" → "QR 版本上限（v25）容量" | 与 `qr.js` `MAX_VERSION = 25` 不符，注释骗人比没注释更糟 |

---

### 第 2 步（W2）：功能缺口补齐

#### 2.1 备份导入恢复（Profile 只能导出 → 补上导入）

- **`src/core/store.js`**：新增纯函数 `export function mergeBackup(current, incoming)`
  - 校验：`trips/family/shares` 必须是数组，逐项要求有 `id`（无 id 的丢弃并计数）
  - 合并：按 `id` 去重（保留已有，跳过重复），返回 `{ data, added: { trips, family, shares }, skipped }`
  - 纯函数、无副作用，便于单测
- **`src/pages/ProfilePage.vue`**：数据区新增一行"从备份文件恢复"
  - 隐藏 `<input type="file" accept="application/json,.json">` + 按钮触发
  - 读取 → `JSON.parse` → `mergeBackup` → `persist()` → toast："恢复 3 条行程、1 位家人，跳过 2 条重复"
  - 失败（非 JSON / 形状不符）：toast "这不是有效的备份文件"，不落库
- **测试**：新增 `tests/unit/store-backup.test.mjs`（形状校验/去重/合并/非法输入/空文件）；e2e 走真实文件流（导出下载 → 清空 → `setInputFiles` 导入 → 数据回来）

#### 2.2 段级增删 + 编辑联动人话

- **`src/core/agents.js`**：
  - 新增 `export function createBlankSegment(type, today)`，返回符合既有段契约的空段（含 `plain` 空对象、`sourceLine: '手动添加'`、`manualConfirm: false`）
  - 新增 `export function refreshPlain(seg)`：调用既有 `translateSegment(seg)` 重算 `plain`（title/voice/tips）
- **`src/pages/TripPage.vue`**：
  - 段列表尾部「＋ 添加一段」：先选类型（高铁/航班/酒店/打车）→ 复用现有编辑表单结构填入新段
  - 编辑表单内新增「删除本段」（两步确认，复用现有 `askConfirm` key 模式）
  - `saveSegment` 末尾调用 `refreshPlain(seg)`，再跑 `sanityCheck` 与 `persist()` —— 修复"改了站点但长辈端语音还是老话"的问题
  - 段为 0 时给出引导文案（去导入 / 手动添加）
- **测试**：unit 补 `createBlankSegment` 契约 + `refreshPlain` 后 `plain.voice` 随 `from/to` 变化；e2e 走"新增段 → 长辈端出现该卡 → 删除段 → 消失"

#### 2.3 最近账号管理（只读 → 可删）

- **`src/core/accounts.js`**：新增 `export function removeAccount(id)`
  - 从 `ptb:accounts` 列表移除 + 删 `ptb:data:<id>` 数据桶 + 若删的是当前会话则清 `ptb:session`
- **`src/pages/RecentAccountsPage.vue`**：每行加「删除」（两步确认）+ 标注「当前登录」；空态文案
- **测试**：新增 `tests/unit/accounts.test.mjs`（注册/登录/三种标识/登录失败统一文案不泄露存在性/`removeAccount` 清桶清会话）——当前 accounts 模块**没有单测**，本条目顺带补上

#### 2.4 二维码长内容降级 + 注释修正

- **`src/pages/SharePage.vue`** `generate()`：`qrDataUrl(url)` 失败 → 重试 `qrDataUrl(url, { ecl: 'L' })`（L 级容量更大）→ 仍失败才置 `null` 显示"二维码放不下"提示
  - `qr.js` 签名已确认：`encodeQR(text, { ecl = 'M' })`，无需改内核
- 同 2.4 注释一致性（见第 1 步）

#### 2.5 首页搜索扩展

- **`src/pages/HomePage.vue`**：搜索从"仅标题"扩展到"标题 / 段车次 / 段出发到达站"，trim + 大小写不敏感
- **测试**：walk-kid 现有搜索用例追加"输入车次能命中"

---

### 第 3 步（W1）：视觉与体验升级

> 原则（UICraft 决策优先级）：**保留既有品牌与设计系统**，做"提炼与统一 + 状态补完"，不推倒重来、不加装饰性特效。

#### 3.1 样式基建：token 补强 + 共享类下沉

- **`src/styles/global.css`**：
  - 新增 token：间距刻度 `--sp-1..--sp-6`(4/8/12/16/24/32)、字号刻度 `--fs-xs..--fs-xl`、动效 `--dur-1/--dur-2` + `--ease-out`、焦点环 `--focus-ring`
  - 把 5 个页面重复实现的 `.page` `.page-head` `.block` `.block-title` `.btn-sm` `.btn.arming` `.empty` `.empty-hint` 下沉为全局类
- **受影响页面**：`TripPage.vue` `ProfilePage.vue` `HomePage.vue` `SharePage.vue` `FamilyPage.vue` —— 删除各自重复样式块，保留页面特有样式
- **验收**：改动前后截图对照，视觉不变（这是纯重构，不允许产生视觉差异）

#### 3.2 首页第一印象（WelcomePage）

- hero 排版节奏：seal 印章比例、标题字距、副标题对比度、垂直留白
- 两张入口卡内部层级：标题 → 一句话使用场景 → 行动区；用现有品牌色与印章语言，不引外部图片
- 底部诚实声明块收敛（去重、降低视觉权重）

#### 3.3 长辈端视觉微调（红线内）

- 卡片信息层级：车次权重、路线行与时间行的分隔、"住/车/飞"图标圆底对比度
- 保持：零动画、纯白底、≥28px、≥72px、≥60×60 —— 改完**必须**跑 `tests/e2e/a11y.test.mjs` 全绿

#### 3.4 空状态与错误态统一

统一版式（居中 / 图示位 / 一句说明 / 一个 CTA）与文案语气，覆盖：
`HomePage`（无行程→引导去导入）、`FamilyPage`（无家人）、`SharePage`（无分享记录）、`RecentAccountsPage`（无账号）、`App.vue`（404）、`ImportPage`（解析失败）

#### 3.5 响应式走查

- 390px 宽度逐页走查并修正：topbar、表单网格、行程卡操作按钮换行、分享页二维码区
- 新增机器断言：390px 下 `document.documentElement.scrollWidth <= 390`（无横向溢出）

#### 3.6 视觉基线扩展

- **`tests/e2e/a11y.test.mjs`** 扩展为 `visual` 用例：桌面 6 页 + 移动端 3 页截图写入 `tests/screenshots/`
- 保持仓库既有策略：**生成基线，不做像素级 diff 断言**（避免脆弱测试），结构性事实用测量断言

---

### 第 4 步（W3）：上线交付

#### 4.1 可访问预览（真实运行）

- 停 dev → `npm run build` → `npm run preview`（5190）→ 调用 `OpenPreview` 给出用户可点开访问的链接
- 交付三形态：可访问预览链接 + `dist/` 静态产物 + 单文件 HTML

#### 4.2 PWA：可安装 + 离线（长辈端离线可用是真实产品价值）

| 文件 | 内容 |
|---|---|
| `public/manifest.webmanifest` | name/short_name/start_url "."/display standalone/theme_color `#C7391B`/background_color `#FDFBF5`/icons(192,512,maskable) |
| `scripts/make-icons.mjs` | 用已装的 Playwright 渲染内联 SVG 印章（与 favicon 同源）→ 输出 `public/icons/icon-192.png`、`icon-512.png`（零新依赖） |
| `public/sw.js` | 极小运行时缓存：install 预缓存 `./` 与 `./index.html`；fetch 同源 GET 走 cache-first 回填；activate 清旧缓存 |
| `src/main.js` | 仅在 `import.meta.env.PROD` 且 `location.protocol` 为 http(s) 时注册 SW，try/catch 静默失败 |
| `index.html` | 加 `<link rel="manifest">`、`<meta name="theme-color">`、`<link rel="apple-touch-icon">` |
| `scripts/build-singlefile.mjs` | 单文件形态**剥离** manifest / apple-touch-icon 链接（file:// 不支持 SW），保持"零外部引用"校验 |

**安全闸门**：dev 与 e2e 跑的是 `vite dev`（`import.meta.env.PROD === false`），SW 不会注册 —— 不污染现有 106 项测试。
**校验**：新增 `tests/pwa-prod.mjs`（build → preview → 断言 manifest 200 / SW 注册成功 / 断网 reload 仍渲染），挂 `npm run test:pwa`，不进 `npm test` 主链路（避免每次回归都 build）。

#### 4.3 自托管部署参考

- `Dockerfile`：`node:22-alpine` 构建 → `nginx:alpine` 托管 `dist/`
- `nginx.conf`：gzip + 静态缓存头；**显式注明：hash 路由无需 SPA rewrite 规则**
- README 部署章节：Netlify / Vercel / GitHub Pages（`base: './'` 相对路径已支持子路径托管）
- **诚实标注**：沙箱内不执行 `docker build`，配置为自查通过的可交付参考

---

### 第 5 步（W4-收尾）：工程交付

- **`README.md`**（中文）：产品定位与一句话、功能清单、技术栈与自研模块说明、目录结构、快速开始（dev/build/preview/build:single）、脚本表、测试体系说明、部署、设计说明（暖纸书卷 token + 长辈端硬指标）、诚实边界（无后端/数据仅本机/OCR 与农历为已知边界）
- **`.gitignore`** + **`.github/workflows/ci.yml`**：Node 22 → `npm ci` → `npx playwright install --with-deps chromium` → `npm test`
- **测试登记**：新测试文件必须加入 `tests/run-all.mjs` / `tests/run-e2e.mjs` 的**显式文件列表**（仓库约定：不用目录扫描，避免空套件误报）

---

## 四、假设与决策

| 决策 | 理由 |
|---|---|
| 保留「暖纸书卷」设计系统，只提炼不重做 | UICraft 优先级 2：不擅自更换既有品牌；且已通过 5 张基线截图与 token 沉淀 |
| 不引入任何 UI 库 / 图标库 / 网络字体 | 零运行时外部依赖 + 离线可用是产品前提（长辈端可能在弱网环境打开） |
| PWA 仅在生产 http(s) 下注册 | 避免污染 dev/e2e；单文件形态天然不含 SW |
| 视觉回归"生成基线 + 测量断言"，不做像素 diff | 像素 diff 在跨平台字体渲染下极脆弱，会变成噪音测试 |
| 段编辑后重算 `plain`（人话/语音） | 现有行为会让长辈端语音与实际修改不一致，属功能缺陷而非新特性 |
| Docker/CI 作为"可交付配置"提供，沙箱不执行 | 诚实：不能让未验证的东西冒充已验证 |
| 新增测试文件显式登记进运行器 | 沿用仓库既有约定（曾因目录扫描产生空套件误报） |

---

## 五、验收标准

1. `npm test` 全绿：unit（64 + 新增 store-backup / accounts / agents 用例）+ e2e（walk-kid / deep-combo / deep-scale / a11y-visual，含新增导入恢复、段增删用例）
2. 长辈端 a11y 硬指标断言全部保持通过（零动画 / 纯白底 / ≥28px / ≥72px / ≥60×60）
3. `npm run build:single` 产出单文件，`file://` 烟测通过，无外部资源引用
4. `npm run test:pwa` 通过（manifest / SW / 离线重载）
5. 移动端 390px 无横向溢出断言通过
6. `OpenPreview` 提供可访问链接，用户可点开真实使用
7. 目检截图基线：长辈端 + 子女端桌面/移动，视觉质量达到"可对外演示"
8. README 完整，仓库无死代码（根目录调试脚本已清理）