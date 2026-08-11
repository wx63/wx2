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
起好后端后，直接用浏览器打开 http://localhost:3001/ （Express 托管前端静态文件，前后端同源，无需双击 index.html）。公开注册已关闭，首次启动空数据库前请在 `.env` 配置 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 初始化管理员账号。

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

## 配置

所有配置走环境变量（见 .env.example）。常用：

| 变量 | 默认 | 说明 |
|------|------|------|
| PORT | 3001 | 后端端口 |
| SESSION_SECRET | replace-me | 会话签名密钥；生产环境必须改 |
| CORS_ORIGIN | 空 | 为空时不启用 CORS；如需跨域只填精确白名单 |
| ADMIN_EMAIL / ADMIN_PASSWORD | 空 | 数据库无用户时自动创建首个 admin；公开注册已关闭，空库未配置则无法登录 |
| OPENCLAW_DIRECT_MODEL | shuyanai/qwen3.6-flash | 快路径模型，形如 <provider>/<model> |
| OPENCLAW_DIRECT_TIMEOUT_MS | 30000 | 直连超时 |
| OPENCLAW_GATEWAY_URL | http://127.0.0.1:18789 | Gateway 兜底地址 |
| OPENCLAW_PROVIDER_BASE_URL | (自动读 models.json) | 直连 provider baseUrl |
| OPENCLAW_PROVIDER_API_KEY | (自动读 models.json) | 直连 provider apiKey |

provider 凭据留空时，自动从 ~/.openclaw/agents/main/agent/models.json 按 OPENCLAW_DIRECT_MODEL 前缀读对应 provider 的 baseUrl/apiKey。

## OpenClaw 配置要求

- Gateway 已启动且 ~/.openclaw/openclaw.json 里 gateway.auth.token 可读（留空 OPENCLAW_GATEWAY_TOKEN 时自动读）
- models.json 里至少配了一个非 reasoning 模型作快路径（默认用 deepseek 官方 deepseek-chat）

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
