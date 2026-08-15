# 跨境电商智能体 · 优化任务清单（Codex 执行版）

> 本文档由系统代码评审生成（2026-08-15 之后），供 Codex / Claude Code 等编码助手在本仓库内按清单执行。
> 请先读「0. 项目速览」和「1. 执行约定」，再逐项完成；每项都必须有对应验证。

---

## 0. 项目速览（必读）

- **项目根目录**：`E:\基于OpenClaw构建跨境电商智能体\基于OpenClaw构建跨境电商智能体\`
  （注意：外层还有一个同名目录，工作目录必须是直接包含 `public\`、`server\`、`docs\`、`data\`、`知识库\` 的那一层，不要弄错）
- **技术栈**：Node ≥22.5（使用 `node:sqlite` 原生库，无需安装 sqlite 依赖）、Express 4、纯原生 JS 前端（无框架）、SQLite（WAL）、PM2
- **启动**：`cd server && npm start` → http://localhost:3001 ；生产 `npm run start:prod`（PM2）
- **测试**：`cd server && npm test`（node:test，评审时 31 项全绿）；根目录 `.smoke.js` 是需后端在线的端到端冒烟脚本（被 gitignore）
- **关键文件**：
  - `server/index.js`（1487 行）— Express 主服务：路由/中间件/编排器/命令队列/调度器
  - `server/bridge.js`（398 行）— 模型桥接（直连 DeepSeek → Gateway 兜底）+ `detectAction` 审批判定
  - `server/kb.js`（173 行）— 知识库 RAG
  - `server/db.js`（1185 行）— SQLite 数据层
  - `server/feishu.js` / `price-lookup.js` / `backup.js` — 飞书 / 查价 / 备份
  - `public/app.js`（1989 行）/ `index.html` / `styles.css` — 前端控制台

---

## 1. 执行约定（必须遵守）

1. **改代码前先读相关文件全文**，尤其 `public/app.js`、`server/index.js`，禁止盲改（AGENTS.md 规则）
2. 业务红线（AGENTS.md）：对外动作（发帖/回复/上架/下单/退款）只出方案需人工审批；不爬平台后台；不做矩阵发帖；业务数据写 `data\`、经验写 `memory\`
3. 每完成一项：先 `cd server && npm test` 确认不回归，再 git 提交
4. **提交分组习惯**：docs / server / frontend 分开提交（参考 `memory/2026-08-15.md`）；本地 master 推远端用 `git push origin master:main`
5. 每完成一项功能/修复，追加记录到 `memory/YYYY-MM-DD.md`；架构级变更同步更新 `docs/架构设计.md`
6. 不升级/改动依赖版本（除非任务明确要求）；不动 `node_modules`
7. 标注「⚠️ 需人工」的任务：Codex 只做配合项（清理、校验、提示），不代替用户生成/更换密钥
8. **行为兼容**：所有改动保持对外 API 路径与响应结构不变（除非任务注明），前端展示逻辑不退化

---

## 2. 任务总览

| 优先级 | 编号 | 任务 | 主要文件 | 验收要点 |
|---|---|---|---|---|
| P0 | S1 | 密钥与仓库泄露检查 | .gitignore、git 历史、README | git 历史无 .env/密钥 |
| P0 | S2 | 生产环境安全护栏 | server/index.js、.env.example | 生产 + 公开注册启动即警告 |
| P0 | S3 | 登录失败锁持久化 | server/index.js、server/db.js | 重启后锁仍生效，测试覆盖 |
| P1 | C1 | 修复 kb.js 死代码（TTL 失效） | server/kb.js | 5 分钟缓存生效 |
| P1 | C2 | 路由/审批规则单一事实来源 | 新增 server/rules.js；index.js、bridge.js、app.js | 前后端规则一致 |
| P1 | C3 | 审批关键词识别升级（正则+置信度） | server/rules.js、bridge.js、db.js | 换说法能命中审批，测试覆盖 |
| P1 | C4 | 前端自动化测试（jsdom 冒烟） | 新增 server/test/frontend.smoke.test.js、package.json | 前端核心流可自动回归 |
| P2 | R1 | server/index.js 按域拆分 | server/routes/* | 行为不变、测试全绿 |
| P2 | R2 | 工具注册表独立 | server/tools/* | 行为不变 |
| P2 | R3 | 调度器换 cron | server/scheduler.js | 不再 setInterval 漂移 |
| P2 | R4 | 活动流/审批实时推送并入 SSE | server/index.js、public/app.js | 轮询可移除 |
| P2 | R5 | 审批执行器插件化（adapter） | server/executors/* | 预留平台接入位 |
| P2 | R6 | 请求日志/慢路径观测 | server/index.js | 慢路径打点 |

**建议顺序**：S1 → S2 → S3 → C1 → C2 → C3 → C4 →（P2 逐项评估）→ 回归收尾（第 7 节）。

---

## 3. P0 安全（优先做）

### S1 密钥与仓库泄露检查

**问题**：`.env` 含真实 DeepSeek API Key、飞书 App Secret、admin 密码（明文）。`.gitignore` 第 6-8 行已忽略 `.env`，但需确认 git 历史无泄露。

**做法**：
1. `git log --all --oneline -- .env` 确认无历史提交
2. 全仓库扫描疑似密钥：`git grep -nE "sk-[A-Za-z0-9]{20,}|FEISHU_APP_SECRET=|ADMIN_PASSWORD=" $(git rev-list --all)`（排除 `.env` 本身）
3. 若历史有泄露：用 git filter-repo / BFG 清除，并在最终答复中**明确提示用户必须轮换 DeepSeek / 飞书密钥**
4. 在 `README.md`「常见问题」补一条密钥轮换指引（如何生成新 key、更新 .env、重启服务）

**验收**：git 历史无密钥痕迹；README 有轮换指引。

⚠️ **需人工**：生成新密钥并更新 `.env`（Codex 只负责清理、校验与提示）。

---

### S2 生产环境安全护栏

**问题**：`.env` 当前是 `NODE_ENV=development` + `ALLOW_REGISTER=true`；若生产/公网（如 Cloudflare Tunnel）暴露，任何人可注册 viewer 账号看到运营数据。

**做法**（server/index.js）：
1. 在 `NODE_ENV=production` 且 `ALLOW_REGISTER=true` 时：启动打印醒目警告并写一条 `logAudit({ action: 'insecure_production', ... })`（不要直接 throw，避免误伤合法演示场景）
2. `.env.example` 补充注释：公网暴露前必须 `ALLOW_REGISTER=false`、强 `SESSION_SECRET`、配置 `ADMIN_*`
3. 新增测试：production 环境 + `ALLOW_REGISTER=true` 时启动出现警告的断言（抽成可单测的函数或子进程断言）

**验收**：生产模式误配公开注册时启动可见警告；测试覆盖。

---

### S3 登录失败锁持久化

**问题**：`server/index.js` 224-247 行，`loginFailures` 是进程内存 Map，PM2 重启即失效（暴力破解窗口被重置）。

**做法**：
1. `server/db.js` 新增 `login_attempts` 表（`key TEXT PRIMARY KEY, count INTEGER, until INTEGER, updated_at TEXT`），封装并导出 `recordLoginFailure / isLoginLocked / clearLoginFailures`
2. `server/index.js` 的 `loginLimiter` 相关逻辑（`isLoginLocked`、`recordLoginFailure`、`loginFailures.delete`）改用 DB 实现（可保留内存快路径，但必须落库）
3. 测试：连续 5 次失败 → 429；**重建连接/重启后**仍 429（直接测 DB 函数或重载模块）；原有 429 测试保持通过

**验收**：`npm test` 覆盖锁的持久化；原有登录限流测试不回归。

---

## 4. P1 正确性与防漂移

### C1 修复 kb.js 死代码（TTL 缓存失效）

**问题**：`server/kb.js` 27-39 行 `loadKnowledgeBase()` 里 `return CHUNKS;` 在 `lastKbLoad = Date.now();` 之前，后者**永不执行** → `ensureLoaded()`（19-25 行）的 5 分钟 TTL 恒为真，每次检索都全量读盘重新分块，性能浪费。

**做法**：把 `lastKbLoad = Date.now();` 移到 `return CHUNKS;` 之前（函数末尾）。

**验收**：修复后可加临时计数验证 5 分钟内不重复加载（验证完移除）；`npm test` 全绿。

---

### C2 路由/审批规则单一事实来源

**问题**：`ROUTE_RULES` 在 `server/index.js` 294-300 行与 `public/app.js` 54-60 行各一份；`ACTION_RULES` 在 `server/bridge.js` 126-131 行与前端各一份（bridge.js 注释明说"与前端 app.js 的 ACTION_RULES 保持一致"）。已出现关键词不一致（后端有 `voc`，前端无），继续双份维护必然漂移。

**做法**：
1. 新增 `server/rules.js`：导出 `ROUTE_RULES`、`ACTION_RULES`、`detectAction`（从 bridge.js 迁移，保持签名兼容）
2. `server/index.js`、`server/bridge.js` 改为 `require('./rules')`（行为不变）
3. 新增 `GET /api/rules`（登录即可访问，无需角色）：返回 `{ ok: true, data: { routeRules, actionRules } }`
4. `public/app.js` 启动时拉取 `/api/rules` 缓存为变量，路由/审批判定用后端规则；**拉取失败时用内置兜底副本**（原硬编码数组改名保留为 FALLBACK）并 console.warn，保证指令功能不因规则接口失败而不可用
5. 保持「路由规则与审批规则解耦」：一条指令可以既路由到 Agent 又触发审批（现有 `buildAgentPlan` 逻辑勿改）

**验收**：前端不再有与后端重复维护的关键词数组（兜底副本除外）；`/api/rules` 返回与后端一致；`npm test` 全绿；浏览器手动验证指令路由与审批触发正常。

---

### C3 审批关键词识别升级（正则 + 置信度）

**问题**：`detectAction` 用关键词 `includes` 匹配，换说法（如"帮我po个动态"、"发个ins"、"更新一下listing"、"补点货"）会**漏判 → 静默绕过审批闸门**。这是对外动作合规链路的真实漏洞。

**做法**（在 server/rules.js 中实现）：
1. `ACTION_RULES` 升级为 `{ action, label, patterns: RegExp[], kw: string[] }`；`detectAction` 先跑正则、再跑关键词兜底，返回 `{ action, label, confidence: 'high'|'medium'|'low', matched }`
2. 补充常见变体：
   - 社媒发帖：`发帖/发推/发布/po/更新/发一条/发个|动态|帖|推文|ins|ig|tiktok|story`
   - 上架：`上架/发布 listing/提交 listing/上传产品/上新`
   - 采购：`下单/购买/采购/进货/补货`
   - 退款：`退款/退钱/赔偿/补偿`
3. 低置信命中（只命中单个弱词，如只有"动态"）仍返回 action，但标记 `needsReview: true`（照常生成审批条目，人工可见"需复核"）
4. 审批条目落库带上 `confidence` / `needs_review` 字段：`server/db.js` approvals 表用现有 `addColumnIfMissing`（22-24 行）加列，`createApproval`/`listApprovals` 透传
5. 前端审批列表可选展示「需复核」角标（P2 项，可后置）

**验收**：新增测试——至少 5 个"换说法"指令能命中审批（如"po个动态"、"发个ins"、"更新一下listing"、"采购一批"、"退我钱"）；原有关键词测试全部保持通过。

⚠️ **注意**：本次只放宽"识别"（更多说法进入审批），**不得放宽执行**；任何匹配都必须走审批闸门，批准后仍只归档不真执行。

---

### C4 前端自动化测试（jsdom 冒烟）

**问题**：前端 `public/app.js` 1989 行无自动化测试（早期 jsdom 冒烟已不在仓库，见 memory/2026-07-31.md）。

**做法**：
1. `server/package.json` devDependencies 增加 `jsdom`（选与 Node 22 兼容的版本）
2. 新增 `server/test/frontend.smoke.test.js`（node:test + jsdom），参照 memory/2026-07-31.md 的已知踩坑：
   - jsdom 不加载外部 `<script src>`，需手动 `createElement('script')` 注入 `public/app.js` 内容
   - 绕过登录重定向：预置 localStorage `oc_user`；`delete window.location` 后再替换整个对象（`Object.defineProperty` 会抛 Cannot redefine property）
   - mock `window.fetch`：仪表盘（/api/dashboard）、审批（/api/approvals）、线索（/api/leads）、命令轮询（/api/commands/:id）；SSE 指令流用 mock ReadableStream 或直接走轮询分支
3. 断言核心流：
   - 登录态加载 → KPI / 5 张 Agent 卡渲染
   - 审批中心：列表渲染 → 批准后进入历史（待审批数减一）
   - 线索管理：筛选 hot 只显示高意向
   - 指令控制台：mock 流式输出 → 产出面板更新 → 对外动作指令生成审批条目
4. `package.json` 加 `"test:frontend"` 脚本；README「快速开始」补运行方式

**验收**：`npm run test:frontend` 全绿；mock 数据字段与真实接口返回结构对齐（对照 `server/db.js` 的 `listApprovals`/`listLeads`/`getDashboard` 返回结构）。

---

## 5. P2 架构演进（可选，逐项评估后做；每项完成后 `npm test` 必须全绿）

### R1 server/index.js 按域拆分
1487 行单文件。拆为 `server/routes/{auth,agents,orders,leads,reports,kb,commands,approvals,integrations,health}.js`；中间件/限流器保留在 index.js 或抽 `server/middleware.js`。**每拆一个路由文件跑一次 `npm test`**，保持 API 路径不变。

### R2 工具注册表独立
`AGENT_TOOL_DEFS`（index.js 336-414 行）、`buildToolPrompt`、`runPlannedStep` 抽到 `server/tools/`（每工具一个文件 + index 注册表）。`TOOL_SCHEMAS` 输出结构不变。

### R3 调度器换 cron
`startScheduler()`（index.js 1429-1471 行）是 setInterval 60s tick + 分钟差判断，休眠/跨天会漏 tick。改用 `node-cron`（或 PM2 cron）触发每日 9:00 摘要、3:00 备份；保留连续失败计数与飞书告警。

### R4 实时推送统一
活动流/审批目前是 30s 轮询（public/app.js 1989 行附近）。可把活动事件并入现有 SSE 通道，或新增 `/api/events` SSE 长连接，前端改为订阅 + 轮询兜底。

### R5 审批执行器插件化
`POST /api/approvals/:id/execute`（index.js 1360-1366 行）目前固定返回"未接入"。设计 adapter：`server/executors/{instagram,x,wechat,erp}.js` 实现统一接口 `{ name, capability, execute(approval) }`；注册表为空时保持现状（只归档不执行）。等平台 API 凭据到位后按 adapter 接入，不破坏现有审计闭环。

### R6 请求日志与慢路径观测
加请求日志中间件（方法/路径/状态/耗时/用户维度）；直连耗时 >20s 或触发 Gateway 兜底时写 audit 慢路径记录（audit_logs 已有基础，`commands` 表已有 `prompt_cache_*` token 统计可复用）。

---

## 6. 明确不修改（防跑偏）

- 审批"批准只归档、不真执行"的设计 —— **保持**，直到 R5 的 adapter 与平台凭据就绪
- 不常驻 5 个 agent、不爬平台后台、不做矩阵发帖（AGENTS.md 红线）
- PDF/docx/xlsx 只上传不索引 —— **保持**，不引入解析库
- 前端不迁移 React/Vue —— **保持**原生 JS（拆文件后如顺手可加 ESLint，但不强求）
- 不做依赖大版本升级

---

## 7. 回归与收尾清单（全部完成后）

1. `cd server && npm test` → 全绿（原 31 项 + 新增项）
2. 语法检查：`node --check server/index.js server/bridge.js server/kb.js server/db.js public/app.js`
3. 本地启动 `npm start`，浏览器访问 http://localhost:3001 ：登录 → 下达一条普通指令 + 一条对外动作指令（如"发一条推广帖"）→ 确认路由、流式输出、审批条目生成正常
4. 后端在线时跑根目录 `.smoke.js`：`node .smoke.js "你好"`，确认端到端链路
5. 按 docs / server / frontend 分组提交；推送 `git push origin master:main`
6. 在 `memory/YYYY-MM-DD.md` 记录本次改动、验证结果与踩坑
7. 最终答复中列明：每项完成状态、验证结果、以及任何「⚠️ 需人工」事项（如密钥轮换）
