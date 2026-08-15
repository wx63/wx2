# 基于 OpenClaw 构建跨境电商智能体

跨境电商运营工作台：多角色智能体 + 业务闭环（选品 / 内容 / 获客 / 客服 / 风控）。Express 同源托管前端，Node 后端桥接 OpenClaw Gateway / 模型 provider，并负责认证、权限与业务数据持久化。

## 快速开始

### 前置
- Node.js >= 22.5（后端使用 `node:sqlite` 原生 SQLite）
- OpenClaw 已安装并启动 Gateway（默认 http://127.0.0.1:18789），或配置了直连模型 provider

### 启动后端
```
cd server
npm install
cp ../.env.example ../.env   # 按需改配置
npm start
# -> http://localhost:3001
```

### 访问前端
起好后端后，直接用浏览器打开 http://localhost:3001/ （Express 托管前端静态文件，前后端同源，无需双击 index.html）。开发环境默认开启公开注册，新账号为 viewer 只读权限；生产环境需在 `.env` 显式设置 `ALLOW_REGISTER=true`。

### PM2 生产启动

```powershell
cd server
npm install
npm run start:prod
# 首次保存进程快照，登录自启用 HKCU Run 调用 server/pm2-resurrect.ps1
```

日志输出到根目录 `logs/out.log` / `logs/err.log`，已安装 `pm2-logrotate`（50MB、保留 7 份）。

## 架构

```
public/           # 前端控制台静态资产（唯一对外静态目录）
server/
  index.js        # Express：API 路由 + 认证/鉴权 + 受限静态托管
  bridge.js       # 模型桥接：快路径直连 provider -> 慢路径 Gateway 兜底
  kb.js           # 知识库 RAG：.md/.txt 分块检索 + 带来源引用答复
data/             # SQLite 运行时数据库（账号/审批/线索/报告/设置/审计）
知识库/            # RAG 源文档（只通过已认证 API 管理，不直接静态暴露）
memory/           # 运行日志 / 踩坑记录
docs/             # 设计文档
skills/           # 自定义技能（SKILL.md）
```

## Agent 编排器（v0.2）

后端 `/api/command` 不再只是单次 LLM 问答，而是执行真实 Agent 编排：

1. 运营总监路由：按指令关键词选择数字员工
2. 任务拆解：生成 `agent_runs` + `agent_steps`
3. 工具调用：知识库检索 / 客服答复 / Listing / 本地化 / 合规审查 / 线索打标 / 运营报告
4. 真实状态：前端轮询命令详情，展示后端落库的执行步骤
5. 审批闸门：对外动作仍生成草稿，等待人工确认后归档

当前工具均为本地能力，不真实调用微信 / WhatsApp / Instagram / X / ERP 等外部平台。
## 配置

所有配置走环境变量（见 .env.example）。常用：

| 变量 | 默认 | 说明 |
|------|------|------|
| PORT | 3001 | 后端端口 |
| SESSION_SECRET | replace-me | 会话签名密钥；生产环境必须改 |
| CORS_ORIGIN | 空 | 为空时不启用 CORS；如需跨域只填精确白名单 |
| ALLOW_REGISTER | development true / production false | 是否允许公开注册；新账号固定为 viewer 只读权限 |
| ADMIN_EMAIL / ADMIN_PASSWORD | 空 | 数据库无用户时自动创建首个 admin；未开启注册且空库未配置则无法登录 |
| OPENCLAW_DIRECT_MODEL | deepseek/deepseek-chat | 快路径模型，形如 <provider>/<model> |
| OPENCLAW_DIRECT_TIMEOUT_MS | 30000 | 直连超时 |
| OPENCLAW_GATEWAY_URL | http://127.0.0.1:18789 | Gateway 兜底地址 |
| OPENCLAW_PROVIDER_BASE_URL | (自动读 models.json) | 直连 provider baseUrl |
| OPENCLAW_PROVIDER_API_KEY | (自动读 models.json) | 直连 provider apiKey |

provider 凭据留空时，自动从 ~/.openclaw/agents/main/agent/models.json 按 OPENCLAW_DIRECT_MODEL 前缀读对应 provider 的 baseUrl/apiKey。

## OpenClaw 配置要求

- Gateway 已启动且 ~/.openclaw/openclaw.json 里 gateway.auth.token 可读（留空 OPENCLAW_GATEWAY_TOKEN 时自动读）
- models.json 里至少配了一个非 reasoning 模型作快路径（默认用 deepseek 官方 deepseek-chat）


## Feishu（飞书）接入

- 使用企业自建应用 + 机器人 + 长连接事件订阅
- 配置 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
- 服务启动后自动建立飞书长连接，无需公网回调地址
- 飞书消息会进入 Agent 编排器；普通咨询直接回复，对外动作生成审批草稿等待人工确认
- API：
  - `GET /api/integrations/feishu`：连接状态
  - `POST /api/integrations/feishu/send`：手动发送文本（需要 chatId）
## 常见问题

Q: 指令很慢 / 超时？
A: 检查走的是哪条路。看后端日志 / data/app.db 里的 commands.path / duration_ms。直连 deepseek 正常 7-20s；若退回 Gateway 会到 60s+。Gateway 路径慢是 main agent 16k 上下文开销 + 偶发 non_deliverable_terminal_turn，属已知问题。

Q: 中文指令失败率高？
A: 历史问题，已修（bridge.js 用 Buffer.from(body,'utf8')）。若复发，检查是否有人改回了 body: JSON.stringify(body)。

Q: 知识库上传后检索不到？
A: 只有 .md/.txt 进 RAG 索引；.pdf/.docx/.xlsx/.csv 可上传但标“未索引”（不解析入库）。

Q: 审批中心“批准并归档”点了没真发帖？
A: 正常。执行器尚未接入平台 API，当前只完成审批归档。接 Instagram/X/ERP 官方 API 后才会真执行。

## 工作约定

见 AGENTS.md。核心：对外动作（发帖/上架/下单/退款）AI 只出方案需人工审批；业务数据写 data/、经验写 memory/；改前端前先读全文件；不碰灰产。
