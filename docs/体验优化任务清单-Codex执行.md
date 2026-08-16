# 跨境电商智能体 · 体验优化任务清单（Codex 执行版）

> 本清单由「产品经理视角的体验评审」整理（评审基于 2026-08-16 最新代码），供 Codex / Claude Code 在仓库内执行。
> **重要**：仓库已包含此前多项优化（kb.js TTL 修复、审批提醒、规则单一来源、登录失败锁持久化、前端自动化测试、approvals 置信度字段等），**不要重复做**。本清单只列仍然缺失的体验项。

---

## 0. 项目速览（必读）

- **项目根目录**：`E:\基于OpenClaw构建跨境电商智能体\基于OpenClaw构建跨境电商智能体\`
  （注意嵌套一层同名目录，工作目录必须是直接包含 `public\`、`server\`、`docs\` 的那一层）
- 技术栈：Node ≥22.5（`node:sqlite` 原生）、Express、原生 JS 前端、SQLite、PM2
- 服务：本地 `http://localhost:3001`；生产 `http://106.55.18.244:3001`
- 测试：`cd server && npm test`（后端 44 项）、`npm run test:frontend`（前端冒烟 5 项）
- 全局规则见 `AGENTS.md`；长期记忆与口语指令映射见 `MEMORY.md`（**开始前先读**）
- 服务端已按域拆分：`server/routes/{auth,business,kb,commands,approvals,...}.js`、`server/tools/`、`server/scheduler.js`、`server/rules.js`、`server/events.js`

---

## 1. 执行约定（必须遵守）

1. 改代码前先读相关文件全文（尤其 `public/app.js`、`public/login.html`、`server/routes/*.js`），禁止盲改
2. 红线（AGENTS.md/MEMORY.md）：对外动作只出方案需审批；**不做矩阵发帖**；不爬平台后台；不自动下单；不提交 `.env`/密钥/`data/app.db`
3. 每完成一项：先 `cd server && npm test && npm run test:frontend` 确认不回归，再 git 提交
4. 提交分组习惯：docs / server / frontend 分开提交；推送 `git push origin master:main`
5. 每完成一项追加记录到 `memory/YYYY-MM-DD.md`；涉及架构变更同步更新 `docs/`
6. 不升级依赖版本；不动 `node_modules`
7. **行为兼容**：对外 API 路径与响应结构尽量不变；如需加字段，向后兼容（旧前端不报错）

---

## 2. 任务总览

| 优先级 | 编号 | 任务 | 主要文件 |
|---|---|---|---|
| P0 | U1 | 登录页宣传文案与红线对齐（去掉"矩阵发帖""25+ 渠道"） | public/login.html |
| P0 | U2 | 订单状态枚举统一（completed → delivered） | public/index.html、public/app.js |
| P0 | U3 | 审批"今日已批"统计口径修正 | public/app.js |
| P0 | U4 | OAuth 死按钮处理（隐藏或标注"即将上线"） | public/login.html、public/login.js |
| P0 | U5 | "记住我"真实生效（延长会话） | server/routes/auth.js |
| P1 | U6 | 运营总览"今日待办"聚合视图 | server/db.js、server/routes/business.js、public/app.js、public/index.html |
| P1 | U7 | 审批详情展示完整执行轨迹 | public/app.js、server/routes/approvals.js |
| P1 | U8 | 指令执行中可取消（控制台） | public/app.js |
| P1 | U9 | 批量审批（多选 + 批量批准/驳回） | server/routes/approvals.js、server/db.js、public/app.js、public/index.html |
| P1 | U10 | 命令 #id 可点击跳转 | public/app.js |
| P1 | U11 | 审批"需复核"角标（衔接已落库的 needs_review） | server/db.js、public/app.js |
| P2 | U12 | 首次登录引导 + 空态引导 | public/app.js、public/index.html |
| P2 | U13 | 示例数据与真实数据分层（示例角标 + 清空入口） | server/db.js、public/app.js |
| P2 | U14 | 错误提示持久横幅（替代 2.8s toast） | public/app.js、public/login.js |
| P2 | U15 | 首屏骨架屏 | public/app.js、public/styles.css |
| P2 | U16 | 语义说明 tooltip（知识库"未索引"、订单"数据源"） | public/app.js |

---

## 3. P0 信任与一致性（优先）

### U1 登录页宣传文案与红线对齐

**问题**：`public/login.html:32`「获客与社媒：**矩阵发帖** · 互动种草 · 线索抓取」与 AGENTS.md/MEMORY.md 红线（不做矩阵发帖）直接冲突；`login.html:39`「**25+** 接入渠道」与事实不符（实际仅 Web 控制台 + 飞书，微信/WhatsApp/IG/X/ERP 均未接入）。

**做法**：
1. `login.html:32` 改为合规表述，例如「**内容排期 · 互动种草 · 线索抓取**」（不得再出现"矩阵"）
2. `login.html:39` 的 `25+ 接入渠道` 改为真实能力展示：`Web 控制台 / 飞书 已接入`，并追加一行小字「微信 / WhatsApp / Instagram / X / ERP 即将接入」
3. 检查 `login.css` 中 `bs-item` 布局，保证改后排版不破

**验收**：登录页不再出现"矩阵发帖""25+"；文案与红线一致；页面无样式错乱。

---

### U2 订单状态枚举统一

**问题**：后端订单状态枚举为 `['pending','paid','shipped','delivered','cancelled']`（`server/db.js:1096`、`server/routes/business.js:38,56`），但前端两处不一致：
- `public/index.html:230` 筛选下拉用的是 `completed`（已完成），**没有 delivered** → 选"已完成"永远查不到"已送达"订单，用户以为数据丢了
- `public/app.js:1265` 新增/编辑订单弹窗的状态下拉是 `["pending","shipped","completed","cancelled"]`，缺 `paid` 和 `delivered`

**做法**：
1. `index.html:230`：`completed` 改为 `delivered`（文案"已送达"）
2. `app.js:1265`：下拉改为 `["pending","paid","shipped","delivered","cancelled"]`，文案与 `ORDER_STATUS_LABEL`（app.js:1224，已含全部 6 个标签）一致
3. 全仓库搜索 `completed` 确认无其他残留（注意区分订单状态与审批/报告状态，别误改）

**验收**：筛选"已送达"能查到 delivered 订单；订单弹窗状态下拉与后端枚举一致；`npm test` 全绿（注意 e2e-live.test.js:377 有非法状态校验测试，别破坏）。

---

### U3 审批"今日已批"统计口径修正

**问题**：`public/app.js:823`「今日已批」用 `APPROVALS.filter(a => a.status === "approved").length`，**没有按日期过滤**，实际是"累计已批"，文案与数据不符；「今日已驳」同样问题。

**做法**：
1. `normalizeApproval`（app.js:1807 附近）在归一化对象中**保留完整 `createdAt` 时间戳**（目前只保留了 `created` 的 HH:MM 展示值）
2. 统计改为：`approved` 且 `createdAt` 属于今天；「今日已驳」同理
3. 若后端 `listApprovals` 未返回 `created_at`，需在 `server/db.js` 的 `approvalRow` 中补透出（`server/db.js:845` 附近）

**验收**：跨天场景下"今日已批/已驳"只统计今天；统计与处理历史列表一致。

---

### U4 OAuth 死按钮处理

**问题**：`public/login.html:93-102` 的 Google/GitHub 登录按钮点击只弹 toast「待接入后端 OAuth」（`login.js:215-219`），生产系统登录页出现无效按钮，损害信任。

**做法**（二选一，推荐前者）：
1. **隐藏**：`login.html` 删除 `oauth-row` 整块（或 CSS `display:none`），`login.js` 对应绑定一并移除
2. 或改为禁用态「即将上线」（`disabled` + 角标），保留视觉但不可点击

**验收**：登录页不再有可点击但无效的第三方登录入口；`login.js` 无残留绑定。

---

### U5 "记住我"真实生效

**问题**：`public/login.js:134` 提交了 `remember: !!form.remember?.checked`，但 `server/routes/auth.js` 登录接口**完全没处理**该字段（grep 无 remember/maxAge），会话固定 24h——勾选"记住我"无任何效果。

**做法**（server/routes/auth.js 登录成功后、写入会话处）：
1. 解析 `req.body.remember === true`：为真 → `req.session.cookie.maxAge = 30 * 24 * 3600 * 1000`（30 天）；否则保持默认 24h
2. 保持 `rolling: false`（避免每次请求续期）
3. 在 `server/test/api.test.js` 或 auth 相关测试中补一条：remember=true 登录后 `set-cookie` 的 Max-Age 更长

**验收**：勾选"记住我"登录后会话有效期延长；不勾选仍为 24h；`npm test` 覆盖。

---

## 4. P1 核心流程增益

### U6 运营总览"今日待办"聚合视图

**问题**：首页是信息陈列（KPI/Agent/活动流/报告/轨迹），没有"今天有什么需要我处理"的聚合入口；待审批只靠侧栏徽标，离开页面就不知道。

**做法**：
1. 后端：`server/db.js` 新增 `getTodoSummary(userId, role)`，返回：
   - `pendingApprovals`（待审批数）
   - `newLeads`（status='new' 的线索数）
   - `abnormalOrders`（pending 超时未发货等异常订单数，可用 `orderStats` 扩展或按状态统计）
   - `runningRuns`（执行中的 agent_runs 数）
   挂到 `getDashboard`（db.js:1121 附近）返回的 `todo` 字段，或独立 `GET /api/dashboard` 字段（向后兼容：加字段不破坏现有结构）
2. 前端：`public/index.html` 运营总览顶部（KPI 行上方）新增"今日待办"栏；`app.js` 渲染 4 项待办，每项可点击跳转对应视图（`switchView`），空态显示「✅ 全部处理完毕」
3. 数据加载后联动刷新（复用 `loadDashboardData` / SSE）

**验收**：待审批/新线索/异常订单数量真实且与各页一致；点击可跳转；空态文案正确。

---

### U7 审批详情展示完整执行轨迹

**问题**：审批条目已关联 `run_id`（db.js:131、approvalRow:845 透出 runId），前端草稿弹窗只显示「来源 Agent 运行 · Run #N」一行文本（`app.js:954-955`），**看不到 AI 到底执行了哪些步骤**——批准前无法核对依据。

**做法**：
1. `openApprovalDraft`（app.js:938 附近）：当 `ap.runId` 存在时，调用 `GET /api/agent-runs/:id`（或 `/api/commands/:id/run`）拉取 run 的 steps
2. 弹窗内增加可展开的「执行轨迹」区：每条步骤显示 `label/tool`、`status`（done/error）、`output` 摘要（截断 200 字符，超出可展开）
3. 拉取失败时降级为现有「Run #N」文本，不阻塞审批操作

**验收**：查看草稿时能看到该审批对应的 AI 执行步骤；加载失败不影响审批。

---

### U8 指令执行中可取消（控制台）

**问题**：运行轨迹列表有"取消"（app.js:1143），但**指令控制台执行中**（runCommand，app.js:1889）没有取消入口——20-60s 的长任务只能干等。

**做法**：
1. `consoleState.abort` 字段已存在（app.js:131），接线：执行中（`consoleState.running`）渲染"取消"按钮
2. 点击后：中断等待（abort `callBackend` 的轮询/SSE 读取），并调用 `POST /api/agent-runs/:id/cancel`（若已拿到 commandId/runId）或至少前端停止等待并提示"已取消"
3. 取消后控制台回到空闲态，运行记录标记 cancelled，活动流推送取消事件

**验收**：长任务执行中可点取消；界面状态正确；运行记录出现 cancelled 状态。

---

### U9 批量审批

**问题**：审批中心逐条批准/驳回，每天几十条时操作成本高。

**做法**：
1. 后端：`server/routes/approvals.js` 新增 `POST /api/approvals/batch-decide`，body `{ ids: string[], decision: 'approve'|'reject' }`；校验 ids 均存在且为 pending，逐个落库（复用 `decideApproval`），写审计（每条）与一条聚合活动流；返回处理结果 `{ ok, processed, failed: [{id, error}] }`
2. 前端：待审批列表每条加 checkbox；列表头加「全选」+「批量批准」「批量驳回」按钮（带 `confirm` 二次确认）；处理中按钮禁用
3. 测试：`server/test/api.test.js` 补 batch-decide 的成功/部分失败用例

**验收**：多选后可批量处理；统计/徽标/历史正确刷新；部分失败有明确提示；`npm test` 全绿。

---

### U10 命令 #id 可点击跳转

**问题**：轮询兜底超时提示「后台仍在处理中，请稍后查看命令 #id」（app.js runCommand 内），但 #id 不是链接，用户还得去运行记录里翻。

**做法**：
1. 超时/中断提示中的命令 id 渲染为可点击元素（按钮或链接），点击 `switchView('overview')` 并定位到运行轨迹列表/搜索该 id
2. 运行轨迹列表项 id 已可点开详情（`openAgentRunDetail` 存在），确认即可

**验收**：提示中的 #id 可点击并跳转到对应记录。

---

### U11 审批"需复核"角标（衔接已落库的 needs_review）

**问题**：后端已支持 `needs_review` / `confidence`（db.js:809-820 `createApproval` 落库），但前端未展示——低置信匹配产生的审批与普通审批无差别，人工无法快速识别。

**做法**：
1. 确认 `server/db.js` `approvalRow`（约 845 行）已透出 `needsReview` / `confidence`；没有则补
2. `public/app.js` 审批列表：`needsReview` 为真时，条目显示「需复核」角标（样式用 warning 色）+ title tooltip「关键词命中置信度低，请重点核对」
3. `normalizeApproval` 透传该字段

**验收**：低置信指令生成的审批条目带「需复核」标识；普通审批无此标识。

---

## 5. P2 体验打磨（持续做）

### U12 首次登录引导 + 空态引导
- 首次登录（localStorage flag 或后端 settings）在运营总览顶部显示可关闭的 3 步引导卡：① 怎么下指令（快捷指令示例）② 对外动作走审批（在哪里批）③ 结果在哪看（指令抽屉/报告）
- 各空列表在现有 empty 文案基础上补充"下一步操作"提示（如线索空态：「暂无线索，接入渠道或导入 CSV 后自动汇聚」）
- **验收**：首次登录可见引导，关闭后不再出现；空态有操作指引

### U13 示例数据与真实数据分层
- `server/db.js` `seedDefaults()`（363-390 行）种子的 leads/activity_feed/kpis 加 `is_demo` 标记（用 `addColumnIfMissing` 加列，seed 时置 1，真实数据默认 0）
- 前端：示例数据条目显示「示例」角标（线索表、活动流、KPI）
- 设置页新增「清空示例数据」入口（后端 API 删除 `is_demo=1` 行，需二次确认弹窗；**不得**删除真实数据）
- **验收**：用户能一眼区分示例与真实数据；清空示例不影响真实数据；`npm test` 全绿

### U14 错误提示持久横幅
- `showToast`（app.js:709、login.js:228）成功提示 2.8s 可保留；**错误级**消息改为顶部/底部可关闭横幅（不自动消失或 8s+），避免用户错过失败原因
- **验收**：接口失败时错误信息持久可见且可手动关闭

### U15 首屏骨架屏
- `bootstrap`（app.js:2033）串行 await 期间页面空白 → KPI 行、Agent 网格、列表区先渲染骨架（styles.css 加 shimmer 动效），数据到达后替换
- **验收**：刷新页面无明显白屏/跳动

### U16 语义说明 tooltip
- 知识库列表「未索引」状态（app.js `KB_STATUS`）加 tooltip：「PDF/DOCX/XLSX 仅存档，客服检索不到；请使用 MD/TXT」
- 订单页标题区加数据源说明：「数据源：手动录入 · ERP 接入后自动同步」（renderOrders，app.js:1245 附近）
- **验收**：两处说明文案到位，悬停可见

---

## 6. 明确不修改（防跑偏）

- 审批「批准只归档、不真执行」——保持，执行器 adapter 接入前不变
- 不做矩阵发帖、不爬平台后台、不自动下单（红线）
- 前端不迁移 React/Vue；不升级依赖版本
- 知识库 PDF/docx 只上传不索引——保持，只加说明（U16）
- **不要重复做**已完成的项：kb.js TTL 修复、审批提醒（scheduler）、规则单一来源、登录失败锁持久化、前端测试框架、approvals 置信度落库

---

## 7. 回归与收尾清单（全部完成后）

1. `cd server && npm test` → 全绿（44 + 新增）
2. `npm run test:frontend` → 全绿（5 + 新增）
3. `node --check`：`server/index.js server/db.js server/routes/*.js public/app.js public/login.js`
4. 本地启动 `npm start`，浏览器 http://localhost:3001 手测：
   - 登录页文案（U1）、无死按钮（U4）、勾选记住我（U5）
   - 订单筛选"已送达"能查到（U2）
   - 首页"今日待办"数量与各页一致、可跳转（U6）
   - 下达一条长指令 → 可取消（U8）；一条对外动作指令 → 审批条目 → 查看草稿含执行轨迹（U7）、需复核角标（U11）
   - 审批中心多选批量处理（U9）
5. 后端在线时跑 `node .smoke.js "你好"` 确认端到端
6. 按 docs / server / frontend 分组提交；推送 `git push origin master:main`
7. **生产部署提醒**：MEMORY.md 记录远程服务器（106.55.18.244）还待应用代码更新包——本次前端改动完成后按 `docs/deploy-cloud.md` 生成**不含 data 的更新包**并给出覆盖/重启命令（不要覆盖远程 .env）
8. 在 `memory/YYYY-MM-DD.md` 记录本次改动、验证结果与踩坑；最终答复列明每项完成状态与「⚠️ 需人工」事项
