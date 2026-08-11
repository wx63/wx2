// db.js — SQLite 数据层（node:sqlite，Node 内置，无需 npm install）
// 负责账号、审计、命令日志、审批与控制台业务状态的本地持久化。

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.OPENCLAW_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.OPENCLAW_DB_PATH || path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function addColumnIfMissing(table, column, ddl) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
}

function safeJsonParse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function toJson(value) {
  return JSON.stringify(value == null ? null : value);
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- schema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT NOT NULL UNIQUE,
    name           TEXT,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'operator',
    status         TEXT NOT NULL DEFAULT 'active',
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now')),
    last_login_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid       TEXT PRIMARY KEY,
    sess      TEXT NOT NULL,
    expired   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER,
    action         TEXT NOT NULL,
    entity_type    TEXT,
    entity_id      TEXT,
    ip             TEXT,
    user_agent     TEXT,
    metadata_json  TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

  CREATE TABLE IF NOT EXISTS commands (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER,
    command      TEXT NOT NULL,
    agent_id     TEXT,
    session_id   TEXT,
    model        TEXT,
    path         TEXT,
    duration_ms  INTEGER,
    status       TEXT,
    content_len  INTEGER,
    error        TEXT,
    needs_approval INTEGER,
    approval_id  TEXT,
    prompt_tokens   INTEGER,
    completion_tokens INTEGER,
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_commands_created ON commands(created_at);
  CREATE INDEX IF NOT EXISTS idx_commands_user ON commands(user_id);

  CREATE TABLE IF NOT EXISTS approvals (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    command         TEXT NOT NULL,
    action          TEXT,
    draft           TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    risk            TEXT,
    created_by      INTEGER,
    decided_by      INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    decided_at      TEXT,
    executed_at     TEXT,
    execute_status  TEXT,
    execute_error   TEXT,
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(decided_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_approvals_created ON approvals(created_at);
  CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

  CREATE TABLE IF NOT EXISTS agents (
    id              INTEGER PRIMARY KEY,
    emoji           TEXT,
    name            TEXT NOT NULL,
    role            TEXT,
    color           TEXT,
    status          TEXT NOT NULL DEFAULT 'online',
    task            TEXT,
    metrics_json    TEXT NOT NULL DEFAULT '{}',
    skills_json     TEXT NOT NULL DEFAULT '[]',
    templates_json  TEXT NOT NULL DEFAULT '[]',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS kpis (
    key         TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    value       TEXT NOT NULL,
    trend       TEXT,
    up          INTEGER NOT NULL DEFAULT 0,
    icon        TEXT,
    color       TEXT,
    spark_json  TEXT NOT NULL DEFAULT '[]',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity_feed (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tag         TEXT NOT NULL,
    color       TEXT,
    text        TEXT NOT NULL,
    created_by  INTEGER,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_feed(created_at);

  CREATE TABLE IF NOT EXISTS leads (
    id           TEXT PRIMARY KEY,
    channel      TEXT NOT NULL,
    name         TEXT NOT NULL,
    country      TEXT,
    msg          TEXT,
    grade        TEXT NOT NULL,
    intent       TEXT,
    score        INTEGER,
    time         TEXT,
    status       TEXT NOT NULL DEFAULT 'new',
    created_at   TEXT DEFAULT (datetime('now')),
    promoted_at  TEXT,
    promoted_by  INTEGER,
    FOREIGN KEY(promoted_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_leads_grade ON leads(grade);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

  CREATE TABLE IF NOT EXISTS reports (
    id          TEXT PRIMARY KEY,
    agent_id    INTEGER,
    title       TEXT NOT NULL,
    tag         TEXT,
    color       TEXT,
    content     TEXT,
    command_id  INTEGER,
    created_by  INTEGER,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(command_id) REFERENCES commands(id)
  );
  CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);

  CREATE TABLE IF NOT EXISTS settings (
    user_id     INTEGER NOT NULL,
    key         TEXT NOT NULL,
    value_json  TEXT NOT NULL,
    updated_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, key),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

addColumnIfMissing('commands', 'user_id', 'INTEGER');
addColumnIfMissing('commands', 'content', 'TEXT');
addColumnIfMissing('commands', 'updated_at', 'TEXT');
addColumnIfMissing('commands', 'started_at', 'TEXT');
addColumnIfMissing('commands', 'finished_at', 'TEXT');

const DEFAULT_AGENTS = [
  { id: 0, emoji: '🔍', name: '市场调研 Agent', role: 'VOC 分析 · 竞品抓取 · 趋势预测', color: '#60a5fa', status: 'online', task: '正在交叉检索亚马逊 US / Shopee 东南亚 3 个品类的竞品数据', metrics: { 报告: 4, 数据源: 12 }, skills: [{ name: 'VOC 用户声音分析', on: true }, { name: '跨平台竞品数据抓取', on: true }, { name: 'POD 选品可行性报告', on: true }, { name: '趋势预测', on: false }], templates: [{ title: '竞品周报', prompt: '汇总本周亚马逊 US 宠物用品 Top20 竞品的价格、销量、差评关键词，输出竞品周报', icon: '📊' }, { title: 'VOC 分析', prompt: '抓取本品近 30 天的买家评论，分类正向/负向诉求并提炼 5 条产品改进建议', icon: '🗣️' }, { title: 'POD 选品报告', prompt: '调研定制宠物铭牌品类的需求量、竞争度与 POD 供应链可行性，出选品报告', icon: '🏷️' }, { title: '趋势预测', prompt: '预测未来 90 天东南亚市场家居收纳品类的搜索趋势与爆款候选', icon: '📈' }] },
  { id: 1, emoji: '🎨', name: '内容与视觉 Agent', role: '多语种 Listing · SEO · 爆款视频脚本', color: '#a855f7', status: 'busy', task: '生成 5 条 Shopee 西班牙语 Listing 的五点描述与 SEO 标题', metrics: { Listing: 23, 脚本: 6 }, skills: [{ name: '多语种 Listing 生成', on: true }, { name: 'SEO 标题优化', on: true }, { name: 'GEO 内容本地化', on: true }, { name: 'TikTok/IG 视频脚本', on: true }], templates: [{ title: '多语种 Listing', prompt: '为【便携折叠宠物水壶】生成英语/西语/日语三语 Listing 五点描述 + SEO 标题', icon: '📝' }, { title: 'SEO 标题优化', prompt: '对现有 5 条亚马逊 Listing 标题做 SEO 优化，植入高频长尾词', icon: '🔍' }, { title: '视频脚本', prompt: '为 TikTok 写一条 30 秒开箱爆款脚本，含分镜与口播', icon: '🎬' }, { title: '本地化文案', prompt: '把英文 Listing 本地化为越南语，注意文化禁忌与货币表述', icon: '🌍' }] },
  { id: 2, emoji: '📣', name: '获客与社媒 Agent', role: '社媒内容排期 · 互动种草 · 线索抓取', color: '#fb7185', status: 'online', task: '为 3 个 X 账号排期今日内容（合规频率，非矩阵）', metrics: { 发帖: 18, 线索: 37 }, skills: [{ name: '社媒内容排期', on: true }, { name: '自动互动种草', on: true }, { name: 'Reddit 线索抓取', on: false }, { name: '高意向线索整理', on: true }], templates: [{ title: '排期今日内容', prompt: '为 3 个 X 账号排期今日 9 条内容，间隔 6-18 分钟，附文案与配图建议', icon: '📅' }, { title: '种草回复草稿', prompt: '为 Reddit r/dogs 里 5 条潜在买家提问生成种草回复草稿（待人工审批）', icon: '💬' }, { title: '线索整理', prompt: '整理昨日全渠道社媒进线，按意向分级并产出线索表', icon: '📥' }, { title: '周内容计划', prompt: '制定下周跨平台（X/TikTok/IG）内容日历', icon: '🗓️' }] },
  { id: 3, emoji: '💬', name: '客服与订单 Agent', role: '7×24 多渠道接待 · 查单 · 线索清洗', color: '#34d399', status: 'online', task: 'WhatsApp 进线 12 路会话，已为 3 位 B 端客户打标【高意向】', metrics: { 会话: 12, 打标: 3 }, skills: [{ name: 'RAG 知识库问答', on: true }, { name: 'ERP Function Calling（查物流/库存）', on: true }, { name: '退换货处理', on: true }, { name: '线索意向打标', on: true }], templates: [{ title: 'RAG 问答', prompt: '客户问「这件衣服有 XL 吗」，查知识库尺码表给出带对照的答复草稿', icon: '📐', mode: 'kb' }, { title: '查物流', prompt: '调用 ERP 查订单 #OC-2026-7732 的物流轨迹并生成回复草稿', icon: '📦' }, { title: '退换货处理', prompt: '处理 2 笔退货申请，核验退换货政策后生成处理方案', icon: '↩️', mode: 'kb' }, { title: '线索打标', prompt: '清洗今日进线的 14 条对话，按 B 端意向分级打标', icon: '🏷️' }] },
  { id: 4, emoji: '🛡️', name: '合规与风控 Agent', role: '侵权拦截 · 敏感词审查 · 广告异常监控', color: '#fbbf24', status: 'busy', task: '扫描 23 条待上架 Listing，拦截 1 处 “clinically proven” FDA 禁用表述', metrics: { 扫描: 23, 拦截: 6 }, skills: [{ name: '上架前侵权风险拦截', on: true }, { name: '敏感词 / FDA 禁用表述审查', on: true }, { name: '主图水印 / 元数据检测', on: true }, { name: '广告 ROAS 异常监控', on: false }], templates: [{ title: '上架前审查', prompt: '对待上架的 23 条 Listing 做侵权词/敏感词/FDA 表述审查，输出违规点清单', icon: '🛡️' }, { title: '水印检测', prompt: '扫描 18 张主图的水印与 EXIF 元数据，标记风险图', icon: '🖼️' }, { title: '广告异常', prompt: '监控 6 个在投广告的 ROAS，对低于阈值的生成预警', icon: '💰' }, { title: '敏感词库更新', prompt: '同步本周新增的平台禁用词到敏感词库', icon: '📚' }] },
];

const DEFAULT_KPIS = [
  { key: 'orders', label: '今日订单量', value: '1,284', trend: '▲ 12.4% vs 昨日', up: true, icon: '<path d="M6 2 3 6h3v12a1 1 0 0 0 1 1h12v3l4-4-4-4v3h-11V6h3z" fill="currentColor"/>', color: '#60a5fa', spark: [4, 6, 5, 8, 7, 9, 11] },
  { key: 'leads', label: '待处理线索', value: '37', trend: '▲ 8 条高意向', up: true, icon: '<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M5 21a7 7 0 0 1 14 0" fill="currentColor"/>', color: '#fb7185', spark: [3, 4, 4, 6, 5, 7, 8] },
  { key: 'agents', label: '在线 Agent', value: '5 / 5', trend: '全部在岗', up: false, icon: '<circle cx="9" cy="9" r="3" fill="currentColor"/><circle cx="17" cy="11" r="2.5" fill="currentColor"/><path d="M3 19a6 6 0 0 1 11 0M14 19a5 5 0 0 1 7-1.5" fill="none" stroke="currentColor" stroke-width="2"/>', color: '#34d399', spark: [5, 5, 5, 5, 5, 5, 5] },
  { key: 'risk', label: '风险拦截', value: '6', trend: '▲ 含 1 处 FDA 禁用词', up: true, icon: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z" fill="currentColor"/>', color: '#fbbf24', spark: [2, 3, 4, 5, 5, 6, 6] },
];

const DEFAULT_FEED = [
  { tag: '合规', color: '#fbbf24', text: '拦截 1 处 “clinically proven” FDA 禁用表述（Listing #2284）' },
  { tag: '内容', color: '#a855f7', text: '完成 3 条 Shopee 西班牙语 Listing 五点描述' },
  { tag: '客服', color: '#34d399', text: 'WhatsApp 进线客户 #C-7732 打标【高意向-B端】' },
  { tag: '获客', color: '#fb7185', text: '演示数据：X 账号 @brand_us 发帖草稿已生成，待人工审批' },
  { tag: '调研', color: '#60a5fa', text: '生成 POD 选品报告：定制宠物铭牌（需求↑ / 可行）' },
];

const DEFAULT_LEADS = [
  { id: 'L-20260731-01', channel: 'WhatsApp', name: 'M. Reyes', country: '🇵🇭 菲律宾', msg: 'MOQ 多少？定制 logo 起订量？', grade: 'hot', intent: 'B 端·求 MOQ/定制', time: '10:22', score: 92 },
  { id: 'L-20260731-02', channel: 'X / DM', name: '@petlover_us', country: '🇺🇸 美国', msg: '这款有 XL 吗？多久到货？', grade: 'hot', intent: 'C 端·询规格', time: '11:04', score: 81 },
  { id: 'L-20260731-03', channel: 'Reddit', name: 'u/seller_jp', country: '🇯🇵 日本', msg: '想做代理，请问批发价表', grade: 'hot', intent: 'B 端·求批发价', time: '11:38', score: 88 },
  { id: 'L-20260731-04', channel: 'WhatsApp', name: 'L. Tan', country: '🇲🇾 马来', msg: '颜色有哪些？能换吗', grade: 'warm', intent: 'C 端·咨询属性', time: '09:50', score: 54 },
  { id: 'L-20260731-05', channel: 'X / DM', name: '@hobbyist', country: '🇺🇸 美国', msg: '好看，关注了', grade: 'cold', intent: 'C 端·无明确意向', time: '08:15', score: 23 },
  { id: 'L-20260731-06', channel: 'Reddit', name: 'u/curious', country: '🇸🇬 新加坡', msg: '在哪买？有链接吗', grade: 'warm', intent: 'C 端·问购买入口', time: '12:10', score: 47 },
  { id: 'L-20260731-07', channel: 'WhatsApp', name: 'P. Santos', country: '🇧🇷 巴西', msg: '5000 件起订能做吗？FOB 价？', grade: 'hot', intent: 'B 端·大单询价', time: '12:45', score: 95 },
  { id: 'L-20260731-08', channel: 'X / DM', name: '@bot_x12', country: '🇺🇸 美国', msg: '点击查看优惠详情→bit.ly/xxx', grade: 'cold', intent: '垃圾·外链', time: '07:30', score: 8 },
];

const DEFAULT_SETTINGS = {
  model_0: 'claude-opus-5',
  model_1: 'claude-sonnet-5',
  model_3: 'claude-sonnet-5',
  model_4: 'claude-sonnet-5',
  feishu_webhook: '',
  n8n_callback: '',
  feishu_cmd: true,
  roas_alert: true,
  browser_sandbox: true,
  env_iso: true,
  dm_guard: true,
  sandbox_backend: 'Docker（默认）',
  auto_agents_md: true,
  weekly_digest: true,
};

function seedDefaults() {
  const agentCount = Number(db.prepare('SELECT COUNT(*) AS n FROM agents').get().n);
  if (!agentCount) {
    const stmt = db.prepare(`INSERT INTO agents (id, emoji, name, role, color, status, task, metrics_json, skills_json, templates_json, sort_order)
      VALUES (@id, @emoji, @name, @role, @color, @status, @task, @metrics, @skills, @templates, @sortOrder)`);
    DEFAULT_AGENTS.forEach((a, i) => stmt.run({ id: a.id, emoji: a.emoji, name: a.name, role: a.role, color: a.color, status: a.status, task: a.task, metrics: toJson(a.metrics), skills: toJson(a.skills), templates: toJson(a.templates), sortOrder: i }));
  }

  const kpiCount = Number(db.prepare('SELECT COUNT(*) AS n FROM kpis').get().n);
  if (!kpiCount) {
    const stmt = db.prepare(`INSERT INTO kpis (key, label, value, trend, up, icon, color, spark_json, sort_order)
      VALUES (@key, @label, @value, @trend, @up, @icon, @color, @spark, @sortOrder)`);
    DEFAULT_KPIS.forEach((k, i) => stmt.run({ key: k.key, label: k.label, value: k.value, trend: k.trend, up: k.up ? 1 : 0, icon: k.icon, color: k.color, spark: toJson(k.spark), sortOrder: i }));
  }

  const feedCount = Number(db.prepare('SELECT COUNT(*) AS n FROM activity_feed').get().n);
  if (!feedCount) {
    const stmt = db.prepare('INSERT INTO activity_feed (tag, color, text) VALUES (@tag, @color, @text)');
    DEFAULT_FEED.forEach(f => stmt.run(f));
  }

  const leadCount = Number(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n);
  if (!leadCount) {
    const stmt = db.prepare(`INSERT INTO leads (id, channel, name, country, msg, grade, intent, score, time)
      VALUES (@id, @channel, @name, @country, @msg, @grade, @intent, @score, @time)`);
    DEFAULT_LEADS.forEach(l => stmt.run(l));
  }
}

seedDefaults();

function toSafeUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status, createdAt: row.created_at, lastLoginAt: row.last_login_at };
}

function usersCount() {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n);
}

function createUser({ email, name, passwordHash, role }) {
  const stmt = db.prepare(`INSERT INTO users (email, name, password_hash, role, status) VALUES (@email, @name, @passwordHash, @role, 'active')`);
  stmt.run({ email, name: name || null, passwordHash, role: role || 'operator' });
  return findUserById(Number(db.prepare('SELECT last_insert_rowid() AS id').get().id));
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
}

function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function updateLastLogin(userId) {
  db.prepare(`UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(userId);
}

function logAudit({ userId, action, entityType, entityId, ip, userAgent, metadata }) {
  db.prepare(`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip, user_agent, metadata_json)
    VALUES (@userId, @action, @entityType, @entityId, @ip, @userAgent, @metadata)`).run({
    userId: userId || null,
    action: String(action || '').slice(0, 120),
    entityType: entityType || null,
    entityId: entityId || null,
    ip: ip || null,
    userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    metadata: metadata ? toJson(metadata) : null,
  });
}

function commandRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    command: row.command,
    agentId: row.agent_id,
    sessionId: row.session_id,
    model: row.model,
    path: row.path,
    durationMs: row.duration_ms,
    status: row.status,
    content: row.content,
    contentLen: row.content_len,
    error: row.error,
    needsApproval: !!row.needs_approval,
    approvalId: row.approval_id,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function logCommand(r) {
  const stmt = db.prepare(`
    INSERT INTO commands (user_id, command, agent_id, session_id, model, path, duration_ms, status, content, content_len, error, needs_approval, approval_id, prompt_tokens, completion_tokens, updated_at, started_at, finished_at)
    VALUES (@userId, @command, @agentId, @sessionId, @model, @path, @durationMs, @status, @content, @contentLen, @error, @needsApproval, @approvalId, @promptTokens, @completionTokens, @updatedAt, @startedAt, @finishedAt)
  `);
  const ts = nowIso();
  stmt.run({
    userId: r.userId || null,
    command: String(r.command || '').slice(0, 4000),
    agentId: r.agentId || null,
    sessionId: r.sessionId || null,
    model: r.model || null,
    path: r.path || null,
    durationMs: r.durationMs != null ? r.durationMs : null,
    status: r.status || null,
    content: r.content ? String(r.content).slice(0, 20000) : null,
    contentLen: r.contentLen != null ? r.contentLen : null,
    error: r.error ? String(r.error).slice(0, 1000) : null,
    needsApproval: r.needsApproval ? 1 : 0,
    approvalId: r.approvalId || null,
    promptTokens: r.promptTokens != null ? r.promptTokens : null,
    completionTokens: r.completionTokens != null ? r.completionTokens : null,
    updatedAt: r.updatedAt || ts,
    startedAt: r.startedAt || null,
    finishedAt: r.finishedAt || null,
  });
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

function createCommandJob(r) {
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO commands (user_id, command, agent_id, session_id, status, needs_approval, updated_at)
    VALUES (@userId, @command, @agentId, @sessionId, 'queued', @needsApproval, @updatedAt)
  `);
  stmt.run({
    userId: r.userId || null,
    command: String(r.command || '').slice(0, 4000),
    agentId: r.agentId || null,
    sessionId: r.sessionId || null,
    needsApproval: r.needsApproval ? 1 : 0,
    updatedAt: ts,
  });
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

function getCommand(id) {
  return commandRow(db.prepare('SELECT * FROM commands WHERE id = ?').get(id));
}

function markCommandRunning(id) {
  const ts = nowIso();
  db.prepare(`UPDATE commands SET status = 'running', started_at = COALESCE(started_at, @ts), updated_at = @ts WHERE id = @id`).run({ id, ts });
  return getCommand(id);
}

function finishCommandJob(id, r) {
  const ts = nowIso();
  db.prepare(`UPDATE commands SET
    model = @model,
    path = @path,
    duration_ms = @durationMs,
    status = @status,
    content = @content,
    content_len = @contentLen,
    error = @error,
    needs_approval = @needsApproval,
    approval_id = @approvalId,
    prompt_tokens = @promptTokens,
    completion_tokens = @completionTokens,
    updated_at = @ts,
    finished_at = @ts
    WHERE id = @id`).run({
      id,
      model: r.model || null,
      path: r.path || null,
      durationMs: r.durationMs != null ? r.durationMs : null,
      status: r.status || 'error',
      content: r.content ? String(r.content).slice(0, 20000) : null,
      contentLen: r.contentLen != null ? r.contentLen : null,
      error: r.error ? String(r.error).slice(0, 1000) : null,
      needsApproval: r.needsApproval ? 1 : 0,
      approvalId: r.approvalId || null,
      promptTokens: r.promptTokens != null ? r.promptTokens : null,
      completionTokens: r.completionTokens != null ? r.completionTokens : null,
      ts,
    });
  return getCommand(id);
}

function recoverInterruptedCommands() {
  const ts = nowIso();
  const result = db.prepare(`UPDATE commands SET status = 'error', error = '服务重启，异步任务未完成，请重新提交', updated_at = @ts, finished_at = @ts WHERE status IN ('queued', 'running')`).run({ ts });
  return result.changes || 0;
}

function recentCommands(limit = 50) {
  return db.prepare('SELECT * FROM commands ORDER BY id DESC LIMIT ?').all(limit).map(commandRow);
}

function makeApprovalId(rowid) {
  return 'AP-' + String(rowid).padStart(3, '0');
}

function createApproval({ title, command, action, draft, risk, createdBy }) {
  const tempId = `AP-TMP-${Date.now()}`;
  db.prepare(`INSERT INTO approvals (id, title, command, action, draft, status, risk, created_by)
    VALUES (@id, @title, @command, @action, @draft, 'pending', @risk, @createdBy)`).run({
    id: tempId,
    title: String(title || '未命名审批').slice(0, 300),
    command: String(command || '').slice(0, 4000),
    action: action || null,
    draft: draft || null,
    risk: risk || null,
    createdBy: createdBy || null,
  });
  const rowid = Number(db.prepare('SELECT rowid AS id FROM approvals WHERE id = ?').get(tempId).id);
  const id = makeApprovalId(rowid);
  db.prepare('UPDATE approvals SET id = ? WHERE id = ?').run(id, tempId);
  return getApproval(id);
}

function approvalRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    command: row.command,
    action: row.action,
    draft: row.draft,
    status: row.status,
    risk: row.risk,
    createdBy: row.created_by,
    decidedBy: row.decided_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    executedAt: row.executed_at,
    executeStatus: row.execute_status,
    executeError: row.execute_error,
  };
}

function getApproval(id) {
  return approvalRow(db.prepare('SELECT * FROM approvals WHERE id = ?').get(id));
}

function listApprovals(limit = 200) {
  return db.prepare('SELECT * FROM approvals ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit).map(approvalRow);
}

function decideApproval({ id, decision, userId }) {
  const status = decision === 'approve' ? 'approved' : 'rejected';
  db.prepare(`UPDATE approvals SET status = @status, decided_by = @userId, decided_at = datetime('now') WHERE id = @id`).run({ id, status, userId: userId || null });
  return getApproval(id);
}

function migrateApprovalsFromJson(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM approvals').get().n);
  if (count > 0) return 0;
  let list;
  try { list = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return 0; }
  if (!Array.isArray(list) || !list.length) return 0;
  const stmt = db.prepare(`INSERT OR IGNORE INTO approvals (id, title, command, action, draft, status, risk, created_at, decided_at)
    VALUES (@id, @title, @command, @action, @draft, @status, @risk, @createdAt, @decidedAt)`);
  let migrated = 0;
  for (const a of list) {
    stmt.run({
      id: a.id || `AP-MIG-${migrated + 1}`,
      title: a.title || a.command || '迁移审批',
      command: a.command || '',
      action: a.action || null,
      draft: a.draft || null,
      status: ['pending', 'approved', 'rejected'].includes(a.status) ? a.status : 'pending',
      risk: a.risk || null,
      createdAt: a.createdAt || a.created || nowIso(),
      decidedAt: a.decidedAt || null,
    });
    migrated += 1;
  }
  return migrated;
}

function agentRow(row) {
  return {
    id: row.id,
    emoji: row.emoji,
    name: row.name,
    role: row.role,
    color: row.color,
    status: row.status,
    task: row.task,
    metrics: safeJsonParse(row.metrics_json, {}),
    skills: safeJsonParse(row.skills_json, []),
    templates: safeJsonParse(row.templates_json, []),
  };
}

function listAgents() {
  return db.prepare('SELECT * FROM agents ORDER BY sort_order, id').all().map(agentRow);
}

function updateAgentStatus(id, status) {
  db.prepare(`UPDATE agents SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
}

function updateAgentSkill(id, skillIndex, enabled) {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  if (!row) return null;
  const skills = safeJsonParse(row.skills_json, []);
  if (!skills[skillIndex]) return null;
  skills[skillIndex].on = !!enabled;
  db.prepare(`UPDATE agents SET skills_json = ?, updated_at = datetime('now') WHERE id = ?`).run(toJson(skills), id);
  return agentRow(db.prepare('SELECT * FROM agents WHERE id = ?').get(id));
}

function listKpis() {
  return db.prepare('SELECT * FROM kpis ORDER BY sort_order').all().map(row => ({
    key: row.key,
    label: row.label,
    value: row.value,
    trend: row.trend,
    up: !!row.up,
    icon: row.icon,
    color: row.color,
    spark: safeJsonParse(row.spark_json, []),
  }));
}

function listActivity(limit = 30) {
  return db.prepare('SELECT * FROM activity_feed ORDER BY id DESC LIMIT ?').all(limit).map(row => ({
    id: row.id,
    tag: row.tag,
    color: row.color,
    text: row.text,
    time: row.created_at ? new Date(row.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '',
    createdAt: row.created_at,
  }));
}

function addActivity({ tag, color, text, userId }) {
  db.prepare('INSERT INTO activity_feed (tag, color, text, created_by) VALUES (@tag, @color, @text, @userId)').run({
    tag: String(tag || '系统').slice(0, 40),
    color: color || '#6366f1',
    text: String(text || '').slice(0, 1000),
    userId: userId || null,
  });
}

function listLeads(grade = 'all') {
  const rows = grade && grade !== 'all'
    ? db.prepare('SELECT * FROM leads WHERE grade = ? ORDER BY created_at DESC').all(grade)
    : db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
  return rows.map(row => ({ id: row.id, channel: row.channel, name: row.name, country: row.country, msg: row.msg, grade: row.grade, intent: row.intent, score: row.score, time: row.time, status: row.status, promotedAt: row.promoted_at }));
}

function promoteLead(id, userId) {
  db.prepare(`UPDATE leads SET status = 'promoted', promoted_by = ?, promoted_at = datetime('now') WHERE id = ?`).run(userId || null, id);
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

function listReports(limit = 20) {
  return db.prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT ?').all(limit).map(row => ({
    id: row.id,
    agent: row.agent_id,
    title: row.title,
    tag: row.tag,
    color: row.color,
    content: row.content,
    time: row.created_at ? new Date(row.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '',
    createdAt: row.created_at,
  }));
}

function addReport({ agent, title, tag, color, content, commandId, userId }) {
  const seq = Number(db.prepare('SELECT COUNT(*) AS n FROM reports').get().n) + 1;
  const id = 'R-' + String(seq).padStart(3, '0');
  db.prepare(`INSERT INTO reports (id, agent_id, title, tag, color, content, command_id, created_by)
    VALUES (@id, @agent, @title, @tag, @color, @content, @commandId, @userId)`).run({
    id,
    agent: agent != null ? agent : null,
    title: String(title || '未命名报告').slice(0, 300),
    tag: tag || null,
    color: color || null,
    content: content ? String(content).slice(0, 8000) : null,
    commandId: commandId || null,
    userId: userId || null,
  });
  return listReports(1)[0];
}

function getSettings(userId) {
  const rows = db.prepare('SELECT key, value_json FROM settings WHERE user_id = ?').all(userId);
  const settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) settings[r.key] = safeJsonParse(r.value_json, null);
  return settings;
}

function setSetting(userId, key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) throw new Error('未知设置项');
  db.prepare(`INSERT INTO settings (user_id, key, value_json, updated_at)
    VALUES (@userId, @key, @value, datetime('now'))
    ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')`).run({ userId, key, value: toJson(value) });
  return getSettings(userId);
}

function getDashboard(userId) {
  return {
    agents: listAgents(),
    kpis: listKpis(),
    activity: listActivity(30),
    leads: listLeads('all'),
    reports: listReports(20),
    settings: getSettings(userId),
  };
}

module.exports = {
  db,
  DATA_DIR,
  DB_PATH,
  toSafeUser,
  usersCount,
  createUser,
  findUserByEmail,
  findUserById,
  updateLastLogin,
  logAudit,
  logCommand,
  createCommandJob,
  getCommand,
  markCommandRunning,
  finishCommandJob,
  recoverInterruptedCommands,
  recentCommands,
  createApproval,
  getApproval,
  listApprovals,
  decideApproval,
  migrateApprovalsFromJson,
  listAgents,
  updateAgentStatus,
  updateAgentSkill,
  listKpis,
  listActivity,
  addActivity,
  listLeads,
  promoteLead,
  listReports,
  addReport,
  getSettings,
  setSetting,
  getDashboard,
};
