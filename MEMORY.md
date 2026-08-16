# MEMORY.md — OpenClaw 指挥手册与长期记忆

> 本文件是 OpenClaw / Claude Code / Codex 都先读的长期记忆。
> 用户说话偏口语，不要只看字面；先按下面“用户怎么说 → 我该做什么”理解，再执行。

## 1. 项目是谁

- 项目：基于 OpenClaw 构建的跨境电商智能体运营工作台。
- 唯一工作目录：`E:\基于OpenClaw构建跨境电商智能体\基于OpenClaw构建跨境电商智能体`
- 本地服务：`http://localhost:3001`
- 已部署服务：`http://106.55.18.244:3001`
- 技术栈：Node.js >= 22.5、Express、SQLite、原生 JS 前端、PM2。

## 2. 用户怎么说，我该怎么做

| 用户口语 | 我该执行的动作 |
|---|---|
| “继续” | 先读 `memory/` 最新日期文件，再 `git status`，从上次停下的地方继续 |
| “看看这个网址 / 去访问 / 打开看看” | 先检查 HTTP 是否可访问，再看登录、接口、页面渲染，报告问题并修复 |
| “能不能好好弄 / 为什么是空的 / 这是什么” | 不要只截图；查根因、改代码、补测试、生成更新包 |
| “测试” | `cd server; npm test; npm run test:frontend; node --check` |
| “重启服务” | `npx pm2 restart ecommerce-agent --update-env` |
| “提交 / 推送 / 存一下” | `git add` 对应文件 → 分组合并提交 → `git push origin master:main` |
| “部署 / 上传服务器 / 更新远程” | 读 `docs/deploy-cloud.md`；生成**不含 data 的代码更新包**；给出覆盖和重启命令 |
| “写文档 / 存一个 md / 让 OpenClaw 听懂” | 更新 `MEMORY.md`、`AGENTS.md`、`docs/`、`memory/YYYY-MM-DD.md` |
| “修复登录 / 打开是空壳 / 401” | 检查会话 Cookie、认证中间件、前端跳转逻辑；HTTP 部署需 `SESSION_COOKIE_SECURE=auto` |
| “发帖 / 上架 / 下单 / 退款” | 只生成审批草稿，等待人工批准；不得真实执行 |
| “查价 / 最低价 / 多少钱” | 走 `price_lookup` 工具，真实查价，不凭模型记忆编造 |
| “写 Listing / 合规审查 / 本地化” | 走 `listing` / `compliance` / `localize` 工具，输出草稿 |
| “密钥 / 安全 / 暴露” | 不提交 `.env`；扫描泄露；提示轮换 DeepSeek/飞书/会话密钥 |

## 3. 必须先遵守的红线

1. 对外动作只出方案，必须人工审批。
2. 审批“批准”目前只归档，不真实执行平台动作。
3. 不爬平台后台、不做矩阵发帖、不自动下单。
4. 不提交 `.env`、密钥、`data/app.db` 或任何敏感凭据。
5. 业务数据写 `data/`，经验写 `memory/`，不要混放。
6. 改前端前先读 `public/app.js` / `public/index.html`。

## 4. 最近状态（2026-08-16）

- P2 架构演进已完成：路由拆分、工具注册表、精确调度、SSE 实时推送、执行器占位、请求观测。
- 生产 HTTP 会话已修复：`SESSION_COOKIE_SECURE=auto`，HTTP 部署可正常登录。
- 未登录根路径已修复：访问 `/` 会跳转 `/login.html`，不再停在空控制台壳。
- 测试：后端 44/44，前端冒烟 5/5。
- 本地最新代码已推送 `origin/main`；远程服务器还需要应用最新代码更新包。

## 5. 常用命令

```powershell
cd "E:\基于OpenClaw构建跨境电商智能体\基于OpenClaw构建跨境电商智能体"
git status
git log --oneline -10

cd server
npm test
npm run test:frontend
npx pm2 restart ecommerce-agent --update-env
```

```powershell
node .smoke.js "你好"
```

## 6. 部署更新原则

- 完整部署包可包含数据：`deploy/ecommerce-agent-deploy-<日期>.zip`
- 日常更新包**不能包含 data**：`deploy/ecommerce-agent-update-<日期>.zip`
- 远程执行：解压覆盖代码 → `cd server && npm install` → `pm2 restart ecommerce-agent`
- 远程 `.env` 不要覆盖，保留服务器自己的管理员、DeepSeek、飞书和会话密钥。
