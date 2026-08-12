# AGENTS.md — 跨境电商智能体项目

> 本目录是「基于OpenClaw构建跨境电商智能体」的唯一工作目录（2026-07-31 起）
> 所有 AI 工具（Claude Code / Codex / OpenClaw）在本目录内工作时遵守以下约定。

## 项目定位

基于 OpenClaw 构建跨境电商运营矩阵：多角色智能体 + 业务闭环（选品、内容、获客、客服、风控）。

## 目录约定

```
E:\基于OpenClaw构建跨境电商智能体\
├── public\                             # 前端控制台静态资产（唯一对外静态目录）
│   ├── index.html / app.js / styles.css
│   └── login.html / login.js / login.css
├── docs\                              # 设计文档
│   └── 架构设计.md                     # 系统架构 v1.0
├── 知识库\                            # RAG 源文档（尺码表/政策/产品手册）
├── data\                              # 业务数据（线索/订单/竞品快照）
│   └── archive\                       # 归档
├── skills\                            # 自定义技能（SKILL.md）
└── memory\                            # 项目运行日志/踩坑记录
```

## 工作规则

1. **对外动作要审批**：发帖、回复客户、下单、上架——AI 只出方案，人工确认后执行
2. **数据分层**：业务数据（账号/审批/线索/报告/设置/审计）进 `data\app.db`，经验教训写 `memory\`，不混放
3. **改前端前先看现状**：index.html/app.js 是已运行的界面，改动前先读全文件
4. **不碰灰产**：不做防关联矩阵发帖、不爬平台后台、不自动下单
5. **每完成一个功能**：更新 docs\ 对应文档 + 记入 memory\YYYY-MM-DD.md

## 启动方式

- 前端：通过后端访问 `http://localhost:3001/`；不要直接双击 HTML，业务 API 依赖同源会话
- AI 助手：Claude Code / Codex 在本目录内运行（`cd E:\基于OpenClaw构建跨境电商智能体`）
- OpenClaw：主 agent 常驻，通过会话指挥

## 当前状态（2026-07-31）

- [x] 前端控制台雏形（登录页 + 运营矩阵仪表盘）
- [x] 架构设计 v1.0
- [x] 前端控制台二期：指令控制台（路由+流式+审批闸门）/ 任务下达弹窗 / 审批中心 / 线索管理 / 知识库上传接通 / 设置持久化 / 实时活动流
- [x] OpenClaw 后端桥接（server/：指令执行 / SQLite 审批落库 / kb-query / 认证鉴权）
- [x] 知识库建立（Phase 1）：尺码表 / 退换货政策 / FAQ
- [x] kb-query 技能（Phase 1）：分块检索 + 带来源引用答复
- [x] 审批中心接通真实后端（拉取 / 批准 / 驳回落库）
- [x] git init + 首次提交（4ad0524）
- [ ] 客服闭环真实浏览器验收（Phase 1 收尾，jsdom 已过）
- [ ] lead-scoring 技能（Phase 2）
- [ ] listing-writer / compliance-check 技能（Phase 3）
- [x] 前端知识库页接后端真实文件列表（含上传/删除，md/txt 进 RAG）
- [x] Agent 编排器 v0.2：真实路由、任务拆解、工具调用、agent_runs/agent_steps 落库、前端展示真实执行轨迹
- [ ] 外部平台 API 对接（微信 / WhatsApp / Instagram / X / ERP），等账号与凭据提供后接入
- [ ] OpenClaw 上云部署
