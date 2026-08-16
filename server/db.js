// db.js — SQLite 数据层（node:sqlite，Node 内置，无需 npm install）
// 负责账号、审计、命令日志、审批与控制台业务状态的本地持久化。

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const events = require('./events');

const DATA_DIR = process.env.OPENCLAW_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.OPENCLAW_DB_PATH || path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

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
    created_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid       TEXT PRIMARY KEY,
    sess      TEXT NOT NULL,
    expired   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

  CREATE TABLE IF NOT EXISTS login_attempts (
    key         TEXT PRIMARY KEY,
    count       INTEGER NOT NULL DEFAULT 0,
    until       INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  INTEGER NOT NULL,
    used_at     TEXT,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER,
    action         TEXT NOT NULL,
    entity_type    TEXT,
    entity_id      TEXT,
    ip             TEXT,
    user_agent     TEXT,
    metadata_json  TEXT,
    created_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
    prompt_cache_hit_tokens INTEGER,
    prompt_cache_miss_tokens INTEGER,
    created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    decided_at      TEXT,
    executed_at     TEXT,
    execute_status  TEXT,
    execute_error   TEXT,
    run_id          INTEGER,
    confidence      TEXT,
    needs_review    INTEGER NOT NULL DEFAULT 0,
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
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
    updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS activity_feed (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tag         TEXT NOT NULL,
    color       TEXT,
    text        TEXT NOT NULL,
    created_by  INTEGER,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
    created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(command_id) REFERENCES commands(id)
  );
  CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);

  CREATE TABLE IF NOT EXISTS orders (
    id            TEXT PRIMARY KEY,
    order_no      TEXT NOT NULL UNIQUE,
    customer_name TEXT,
    channel       TEXT,
    country       TEXT,
    product       TEXT,
    sku           TEXT,
    qty           INTEGER DEFAULT 1,
    amount        REAL DEFAULT 0,
    currency      TEXT DEFAULT 'USD',
    status        TEXT NOT NULL DEFAULT 'pending',
    tracking_no   TEXT,
    carrier       TEXT,
    note          TEXT,
    created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

  CREATE TABLE IF NOT EXISTS id_seq (
    name TEXT PRIMARY KEY,
    seq  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id     INTEGER NOT NULL,
    key         TEXT NOT NULL,
    value_json  TEXT NOT NULL,
    updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (user_id, key),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id  INTEGER,
    user_id     INTEGER,
    command     TEXT NOT NULL,
    agent_id    TEXT,
    status      TEXT NOT NULL DEFAULT 'queued',
    model       TEXT,
    path        TEXT,
    duration_ms INTEGER,
    plan_json   TEXT,
    result      TEXT,
    error       TEXT,
    summary     TEXT,
    context_json TEXT,
    stats_json  TEXT,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at TEXT,
    FOREIGN KEY(command_id) REFERENCES commands(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_command ON agent_runs(command_id);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs(created_at);

  CREATE TABLE IF NOT EXISTS agent_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      INTEGER NOT NULL,
    seq         INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    label       TEXT,
    tool        TEXT,
    args_json   TEXT,
    input       TEXT,
    output      TEXT,
    meta_json   TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    duration_ms INTEGER,
    created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY(run_id) REFERENCES agent_runs(id)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id);
`);

addColumnIfMissing('commands', 'user_id', 'INTEGER');
addColumnIfMissing('commands', 'content', 'TEXT');
addColumnIfMissing('commands', 'updated_at', 'TEXT');
addColumnIfMissing('commands', 'started_at', 'TEXT');
addColumnIfMissing('commands', 'finished_at', 'TEXT');
addColumnIfMissing('commands', 'run_id', 'INTEGER');
addColumnIfMissing('approvals', 'run_id', 'INTEGER');
addColumnIfMissing('approvals', 'confidence', 'TEXT');
addColumnIfMissing('approvals', 'needs_review', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('agent_steps', 'meta_json', 'TEXT');
addColumnIfMissing('agent_runs', 'summary', 'TEXT');
addColumnIfMissing('agent_runs', 'context_json', 'TEXT');
addColumnIfMissing('agent_runs', 'stats_json', 'TEXT');
addColumnIfMissing('commands', 'prompt_cache_hit_tokens', 'INTEGER');
addColumnIfMissing('commands', 'prompt_cache_miss_tokens', 'INTEGER');

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
  const ts = nowIso();
  db.prepare(`UPDATE users SET last_login_at = @ts, updated_at = @ts WHERE id = @id`).run({ id: userId, ts });
}

function recordLoginFailure(key, { maxFailures = 5, lockMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const storedKey = String(key || '');
  const row = db.prepare('SELECT count, until FROM login_attempts WHERE key = ?').get(storedKey);
  let count = row ? Number(row.count) : 0;
  let until = row ? Number(row.until) : 0;
  if (until > 0 && until <= now) {
    count = 0;
    until = 0;
  }
  count += 1;
  if (count >= maxFailures) until = now + lockMs;
  const updatedAt = nowIso();
  db.prepare(`INSERT INTO login_attempts (key, count, until, updated_at)
    VALUES (@key, @count, @until, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET count = excluded.count, until = excluded.until, updated_at = excluded.updated_at`).run({
    key: storedKey,
    count,
    until,
    updatedAt,
  });
  return { count, until };
}

function isLoginLocked(key) {
  const row = db.prepare('SELECT until FROM login_attempts WHERE key = ?').get(String(key || ''));
  return !!row && Number(row.until) > Date.now();
}

function clearLoginFailures(key) {
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(String(key || ''));
}

function createPasswordReset({ email, tokenHash, expiresAt }) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  db.prepare('DELETE FROM password_resets WHERE email = ?').run(normalizedEmail);
  db.prepare('INSERT INTO password_resets (email, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(normalizedEmail, String(tokenHash || ''), Number(expiresAt || 0));
  return db.prepare('SELECT * FROM password_resets WHERE email = ? ORDER BY id DESC LIMIT 1').get(normalizedEmail);
}

function findPasswordResetByTokenHash(tokenHash) {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(String(tokenHash || ''));
  if (!row) return null;
  if (row.used_at || Number(row.expires_at) <= Date.now()) return null;
  return row;
}

function markPasswordResetUsed(id) {
  db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(nowIso(), Number(id));
}

function updateUserPassword(userId, passwordHash) {
  const ts = nowIso();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(String(passwordHash), ts, Number(userId));
  return findUserById(Number(userId));
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
    runId: row.run_id,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    promptCacheHitTokens: row.prompt_cache_hit_tokens,
    promptCacheMissTokens: row.prompt_cache_miss_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function logCommand(r) {
  const stmt = db.prepare(`
    INSERT INTO commands (user_id, command, agent_id, session_id, model, path, duration_ms, status, content, content_len, error, needs_approval, approval_id, prompt_tokens, completion_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens, updated_at, started_at, finished_at)
    VALUES (@userId, @command, @agentId, @sessionId, @model, @path, @durationMs, @status, @content, @contentLen, @error, @needsApproval, @approvalId, @promptTokens, @completionTokens, @promptCacheHitTokens, @promptCacheMissTokens, @updatedAt, @startedAt, @finishedAt)
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
    promptCacheHitTokens: r.promptCacheHitTokens != null ? r.promptCacheHitTokens : null,
    promptCacheMissTokens: r.promptCacheMissTokens != null ? r.promptCacheMissTokens : null,
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
    prompt_cache_hit_tokens = @promptCacheHitTokens,
    prompt_cache_miss_tokens = @promptCacheMissTokens,
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
      promptCacheHitTokens: r.promptCacheHitTokens != null ? r.promptCacheHitTokens : null,
      promptCacheMissTokens: r.promptCacheMissTokens != null ? r.promptCacheMissTokens : null,
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
function agentStepRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    kind: row.kind,
    label: row.label,
    tool: row.tool,
    args: safeJsonParse(row.args_json, null),
    input: row.input,
    output: row.output,
    meta: safeJsonParse(row.meta_json, null),
    status: row.status,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}
function agentRunRow(row) {
  if (!row) return null;
  const steps = db.prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY seq, id').all(row.id).map(agentStepRow);
  return {
    id: row.id,
    commandId: row.command_id,
    userId: row.user_id,
    command: row.command,
    agentId: row.agent_id,
    status: row.status,
    model: row.model,
    path: row.path,
    durationMs: row.duration_ms,
    plan: safeJsonParse(row.plan_json, []),
    result: row.result,
    error: row.error,
    summary: row.summary,
    context: safeJsonParse(row.context_json, {}),
    stats: safeJsonParse(row.stats_json, {}),
    steps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

function createAgentRun({ commandId, userId, command, agentId, context }) {
  const ts = nowIso();
  const stmt = db.prepare(`INSERT INTO agent_runs (command_id, user_id, command, agent_id, status, context_json, updated_at)
    VALUES (@commandId, @userId, @command, @agentId, 'queued', @context, @updatedAt)`).run({
    commandId: commandId || null,
    userId: userId || null,
    command: String(command || '').slice(0, 4000),
    agentId: agentId || 'main',
    context: context != null ? toJson(context) : null,
    updatedAt: ts,
  });
  const runId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
  if (commandId) db.prepare('UPDATE commands SET run_id = ? WHERE id = ?').run(runId, commandId);
  return runId;
}
function markAgentRunRunning(runId) {
  const ts = nowIso();
  db.prepare(`UPDATE agent_runs SET status = 'running', updated_at = @ts WHERE id = @id`).run({ id: runId, ts });
  return getAgentRun(runId);
}

function appendAgentStep({ runId, seq, kind, label, tool, args, input, output, meta, status, durationMs }) {
  db.prepare(`INSERT INTO agent_steps (run_id, seq, kind, label, tool, args_json, input, output, meta_json, status, duration_ms)
    VALUES (@runId, @seq, @kind, @label, @tool, @args, @input, @output, @meta, @status, @durationMs)`).run({
    runId,
    seq: seq || 0,
    kind: kind || 'step',
    label: label ? String(label).slice(0, 300) : null,
    tool: tool || null,
    args: args != null ? toJson(args) : null,
    input: input ? String(input).slice(0, 12000) : null,
    output: output ? String(output).slice(0, 50000) : null,
    meta: meta != null ? toJson(meta) : null,
    status: status || 'done',
    durationMs: durationMs != null ? durationMs : null,
  });
  db.prepare(`UPDATE agent_runs SET updated_at = ? WHERE id = ?`).run(nowIso(), runId);
  return getAgentRun(runId);
}
function updateAgentStep(runId, seq, r) {
  db.prepare(`UPDATE agent_steps SET
    status = @status,
    output = @output,
    meta_json = @meta,
    duration_ms = @durationMs,
    label = @label
    WHERE run_id = @runId AND seq = @seq`).run({
    runId,
    seq,
    status: r.status || 'done',
    output: r.output ? String(r.output).slice(0, 50000) : null,
    meta: r.meta != null ? toJson(r.meta) : null,
    durationMs: r.durationMs != null ? r.durationMs : null,
    label: r.label ? String(r.label).slice(0, 300) : null,
  });
  db.prepare(`UPDATE agent_runs SET updated_at = ? WHERE id = ?`).run(nowIso(), runId);
  return getAgentRun(runId);
}
function finishAgentRun(runId, r) {
  const ts = nowIso();
  db.prepare(`UPDATE agent_runs SET
    status = @status,
    model = @model,
    path = @path,
    duration_ms = @durationMs,
    plan_json = @plan,
    result = @result,
    error = @error,
    summary = @summary,
    context_json = @context,
    stats_json = @stats,
    updated_at = @ts,
    finished_at = @ts
    WHERE id = @id`).run({
    id: runId,
    status: r.status || 'error',
    model: r.model || null,
    path: r.path || null,
    durationMs: r.durationMs != null ? r.durationMs : null,
    plan: r.plan != null ? toJson(r.plan) : null,
    result: r.result ? String(r.result).slice(0, 50000) : null,
    error: r.error ? String(r.error).slice(0, 2000) : null,
    summary: r.summary ? String(r.summary).slice(0, 2000) : null,
    context: r.context != null ? toJson(r.context) : null,
    stats: r.stats != null ? toJson(r.stats) : null,
    ts,
  });
  return getAgentRun(runId);
}
function getAgentRun(id) {
  return agentRunRow(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id));
}

function getAgentRunByCommandId(commandId) {
  return agentRunRow(db.prepare('SELECT * FROM agent_runs WHERE command_id = ? ORDER BY id DESC LIMIT 1').get(commandId));
}

function listAgentRuns({ limit = 50, offset = 0, status, search, userId, role } = {}) {
  const clauses = [];
  const params = [];
  if (status && status !== 'all') {
    clauses.push('status = ?');
    params.push(status);
  }
  if (search) {
    clauses.push('(command LIKE ? OR summary LIKE ? OR agent_id LIKE ?)');
    const like = '%' + String(search).slice(0, 200) + '%';
    params.push(like, like, like);
  }
  if (userId && role !== 'admin') {
    clauses.push('(user_id = ? OR user_id IS NULL)');
    params.push(userId);
  }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM agent_runs' + where).get(...params).n);
  const rows = db.prepare('SELECT * FROM agent_runs' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?').all(...params, limit, offset);
  return { total, limit, offset, items: rows.map(agentRunRow) };
}
function markAgentRunCancelled(runId, userId, reason) {
  const ts = nowIso();
  const sql = "UPDATE agent_runs SET status = 'cancelled', error = @error, updated_at = @ts, finished_at = @ts WHERE id = @id AND status IN ('queued', 'running')";
  db.prepare(sql).run({ id: runId, error: reason || "\u5df2\u7531\u7528\u6237\u53d6\u6d88", ts });
  return getAgentRun(runId);
}

function listCommandJobs() {
  return db.prepare('SELECT * FROM commands ORDER BY id DESC LIMIT 200').all().map(commandRow);
}
function recoverInterruptedRuns() {
  const ts = nowIso();
  const result = db.prepare(`UPDATE agent_runs SET status = 'error', error = '服务重启，Agent 任务未完成，请重新提交', updated_at = @ts, finished_at = @ts WHERE status IN ('queued', 'running')`).run({ ts });
  return result.changes || 0;
}

function makeApprovalId(rowid) {
  return 'AP-' + String(rowid).padStart(3, '0');
}

function createApproval({ title, command, action, draft, risk, createdBy, runId, confidence, needsReview }) {
  const id = 'AP-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const sql = "INSERT INTO approvals (id, title, command, action, draft, status, risk, created_by, run_id, confidence, needs_review) VALUES (@id, @title, @command, @action, @draft, 'pending', @risk, @createdBy, @runId, @confidence, @needsReview)";
  db.prepare(sql).run({
    id,
    title: String(title || '\u672a\u547d\u540d\u5ba1\u6279').slice(0, 300),
    command: String(command || '').slice(0, 4000),
    action: action || null,
    draft: draft || null,
    risk: risk || null,
    createdBy: createdBy || null,
    runId: runId || null,
    confidence: confidence || null,
    needsReview: needsReview ? 1 : 0,
  });
  const approval = getApproval(id);
  events.publish('approval', approval);
  return approval;
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
    runId: row.run_id,
    confidence: row.confidence,
    needsReview: !!row.needs_review,
  };
}

function getApproval(id) {
  return approvalRow(db.prepare('SELECT * FROM approvals WHERE id = ?').get(id));
}

function listApprovals({ limit = 200, userId, role } = {}) {
  if (role && !['admin', 'operator'].includes(role)) return [];
  let sql = 'SELECT * FROM approvals';
  const params = [];
  if (role === 'operator' && userId != null) {
    sql += ' WHERE (created_by = ? OR created_by IS NULL)';
    params.push(userId);
  }
  sql += ' ORDER BY created_at DESC, rowid DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(approvalRow);
}

function decideApproval({ id, decision, userId }) {
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const ts = nowIso();
  db.prepare(`UPDATE approvals SET status = @status, decided_by = @userId, decided_at = @ts WHERE id = @id`).run({ id, status, userId: userId || null, ts });
  const approval = getApproval(id);
  events.publish('approval', approval);
  return approval;
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

function updateAgentStatus(id, status, task) {
  if (task != null) {
    const ts = nowIso();
    db.prepare(`UPDATE agents SET status = @status, task = @task, updated_at = @ts WHERE id = @id`).run({ status, task: String(task).slice(0, 300), ts, id });
  } else {
    const ts = nowIso();
    db.prepare(`UPDATE agents SET status = @status, updated_at = @ts WHERE id = @id`).run({ status, ts, id });
  }
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
}

function updateAgentSkill(id, skillIndex, enabled) {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  if (!row) return null;
  const skills = safeJsonParse(row.skills_json, []);
  if (!skills[skillIndex]) return null;
  skills[skillIndex].on = !!enabled;
  const ts = nowIso();
  db.prepare(`UPDATE agents SET skills_json = @skills, updated_at = @ts WHERE id = @id`).run({ skills: toJson(skills), ts, id });
  return agentRow(db.prepare('SELECT * FROM agents WHERE id = ?').get(id));
}

function listKpis() {
  const rows = db.prepare('SELECT * FROM kpis ORDER BY sort_order').all().map(row => ({
    key: row.key,
    label: row.label,
    value: row.value,
    trend: row.trend,
    up: !!row.up,
    icon: row.icon,
    color: row.color,
    spark: safeJsonParse(row.spark_json, []),
  }));

  const leadCount = Number(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status = 'new'").get().n);
  const agentRows = db.prepare('SELECT status, COUNT(*) AS n FROM agents GROUP BY status').all();
  const agentMap = {};
  for (const r of agentRows) agentMap[r.status] = Number(r.n);
  const totalAgents = Number(db.prepare('SELECT COUNT(*) AS n FROM agents').get().n);
  const onlineAgents = (agentMap.online || 0) + (agentMap.busy || 0);
  const pendingApprovals = Number(db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'").get().n);

  let ordersAvailable = true;
  let orderCount = 0;
  try {
    orderCount = orderStats().total;
  } catch (e) {
    ordersAvailable = false;
  }

  return rows.map(k => {
    if (k.key === 'leads') {
      k.value = String(leadCount);
      k.trend = '\u5b9e\u65f6\u7ebf\u7d22\u5e93';
      k.up = false;
      k.spark = [leadCount];
    } else if (k.key === 'agents') {
      k.value = onlineAgents + ' / ' + totalAgents;
      k.trend = '\u5b9e\u65f6 Agent \u72b6\u6001';
      k.up = false;
      k.spark = [onlineAgents];
    } else if (k.key === 'risk') {
      k.value = String(pendingApprovals);
      k.trend = '\u5f85\u5ba1\u6279\u5916\u90e8\u52a8\u4f5c';
      k.up = false;
      k.spark = [pendingApprovals];
    } else if (k.key === 'orders') {
      if (!ordersAvailable) {
        k.value = '\u672a\u63a5\u5165';
        k.trend = '\u7b49\u5f85 ERP/\u5e73\u53f0 API';
        k.up = false;
      } else {
        k.value = String(orderCount);
        k.trend = '\u8ba2\u5355\u5e93\u5b9e\u65f6\u7edf\u8ba1';
        k.up = false;
      }
      k.spark = [ordersAvailable ? orderCount : 0];
    }
    return k;
  });
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
  events.publish('activity', {
    tag: String(tag || '系统').slice(0, 40),
    color: color || '#6366f1',
    text: String(text || '').slice(0, 1000),
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    createdAt: new Date().toISOString(),
  });
}

function listLeads(grade = 'all', { role = 'admin' } = {}) {
  if (role && !['admin', 'operator'].includes(role)) return [];
  const rows = grade && grade !== 'all'
    ? db.prepare('SELECT * FROM leads WHERE grade = ? ORDER BY created_at DESC').all(grade)
    : db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
  return rows.map(row => ({ id: row.id, channel: row.channel, name: row.name, country: row.country, msg: row.msg, grade: row.grade, intent: row.intent, score: row.score, time: row.time, status: row.status, promotedAt: row.promoted_at }));
}

function promoteLead(id, userId) {
  const ts = nowIso();
  db.prepare(`UPDATE leads SET status = 'promoted', promoted_by = @promotedBy, promoted_at = @ts WHERE id = @id`).run({ promotedBy: userId || null, ts, id });
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

function orderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNo: row.order_no,
    customerName: row.customer_name,
    channel: row.channel,
    country: row.country,
    product: row.product,
    sku: row.sku,
    qty: row.qty,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    trackingNo: row.tracking_no,
    carrier: row.carrier,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listOrders({ limit = 100, offset = 0, status = 'all', search = '' } = {}) {
  const clauses = [];
  const params = [];
  if (status && status !== 'all') {
    clauses.push('status = ?');
    params.push(status);
  }
  if (search) {
    clauses.push('(order_no LIKE ? OR customer_name LIKE ? OR product LIKE ? OR sku LIKE ? OR tracking_no LIKE ?)');
    const like = '%' + String(search).slice(0, 200) + '%';
    params.push(like, like, like, like, like);
  }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM orders' + where).get(...params).n);
  const rows = db.prepare('SELECT * FROM orders' + where + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(...params, limit, offset);
  return { total, limit, offset, items: rows.map(orderRow) };
}

const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

function ensureOrderSeq() {
  const row = db.prepare('SELECT MAX(CAST(substr(id, 5) AS INTEGER)) AS maxSeq FROM orders').get();
  const current = db.prepare("SELECT seq FROM id_seq WHERE name = 'order'").get();
  const maxSeq = row && row.maxSeq ? Number(row.maxSeq) : 0;
  const currentSeq = current ? Number(current.seq) : 0;
  if (!current || currentSeq < maxSeq) {
    db.prepare(`INSERT INTO id_seq (name, seq) VALUES ('order', @seq)
      ON CONFLICT(name) DO UPDATE SET seq = MAX(seq, @seq)`).run({ seq: maxSeq });
  }
}

function nextOrderSeq() {
  ensureOrderSeq();
  db.prepare(`INSERT INTO id_seq (name, seq) VALUES ('order', 0)
    ON CONFLICT(name) DO UPDATE SET seq = seq + 1`).run();
  return Number(db.prepare("SELECT seq FROM id_seq WHERE name = 'order'").get().seq);
}

function addOrder(data) {
  const seq = nextOrderSeq();
  const id = 'ORD-' + String(seq).padStart(5, '0');
  const orderNo = String(data.orderNo || id);
  db.prepare(`INSERT INTO orders (id, order_no, customer_name, channel, country, product, sku, qty, amount, currency, status, tracking_no, carrier, note)
    VALUES (@id, @orderNo, @customerName, @channel, @country, @product, @sku, @qty, @amount, @currency, @status, @trackingNo, @carrier, @note)`).run({
    id,
    orderNo: orderNo.slice(0, 80),
    customerName: data.customerName ? String(data.customerName).slice(0, 100) : null,
    channel: data.channel ? String(data.channel).slice(0, 40) : null,
    country: data.country ? String(data.country).slice(0, 40) : null,
    product: data.product ? String(data.product).slice(0, 200) : null,
    sku: data.sku ? String(data.sku).slice(0, 80) : null,
    qty: data.qty != null ? Math.max(1, Number(data.qty) || 1) : 1,
    amount: data.amount != null ? Number(data.amount) || 0 : 0,
    currency: data.currency ? String(data.currency).slice(0, 10) : 'USD',
    status: data.status ? String(data.status).slice(0, 20) : 'pending',
    trackingNo: data.trackingNo ? String(data.trackingNo).slice(0, 80) : null,
    carrier: data.carrier ? String(data.carrier).slice(0, 40) : null,
    note: data.note ? String(data.note).slice(0, 500) : null,
  });
  return orderRow(db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo));
}

function updateOrder(id, data) {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare(`UPDATE orders SET
    order_no = @orderNo, customer_name = @customerName, channel = @channel, country = @country,
    product = @product, sku = @sku, qty = @qty, amount = @amount, currency = @currency,
    status = @status, tracking_no = @trackingNo, carrier = @carrier, note = @note,
    updated_at = @updatedAt WHERE id = @id`).run({
    id,
    updatedAt: nowIso(),
    orderNo: String(data.orderNo || row.order_no).slice(0, 80),
    customerName: data.customerName != null ? String(data.customerName).slice(0, 100) : row.customer_name,
    channel: data.channel != null ? String(data.channel).slice(0, 40) : row.channel,
    country: data.country != null ? String(data.country).slice(0, 40) : row.country,
    product: data.product != null ? String(data.product).slice(0, 200) : row.product,
    sku: data.sku != null ? String(data.sku).slice(0, 80) : row.sku,
    qty: data.qty != null ? Math.max(1, Number(data.qty) || 1) : row.qty,
    amount: data.amount != null ? Number(data.amount) || 0 : row.amount,
    currency: data.currency ? String(data.currency).slice(0, 10) : row.currency,
    status: data.status ? String(data.status).slice(0, 20) : row.status,
    trackingNo: data.trackingNo != null ? String(data.trackingNo).slice(0, 80) : row.tracking_no,
    carrier: data.carrier != null ? String(data.carrier).slice(0, 40) : row.carrier,
    note: data.note != null ? String(data.note).slice(0, 500) : row.note,
  });
  return orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

function deleteOrder(id) {
  const result = db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  return result.changes > 0;
}

function orderStats() {
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n);
  const today = Number(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE date(created_at) = date('now')").get().n);
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all();
  const byStatus = Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
  return {
    total,
    today,
    pending: byStatus['pending'] || 0,
    shipped: byStatus['shipped'] || 0,
    paid: byStatus['paid'] || 0,
    delivered: byStatus['delivered'] || 0,
    cancelled: byStatus['cancelled'] || 0,
    byStatus,
  };
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
  const id = 'R-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
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
  const ts = nowIso();
  db.prepare(`INSERT INTO settings (user_id, key, value_json, updated_at)
    VALUES (@userId, @key, @value, @ts)
    ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = @ts`).run({ userId, key, value: toJson(value), ts });
  return getSettings(userId);
}

function getDashboard(userId, role = 'admin') {
  return {
    agents: listAgents(),
    kpis: listKpis(),
    activity: listActivity(30),
    leads: listLeads('all', { role }),
    reports: listReports(20),
    runs: role === 'admin' ? listAgentRuns({ limit: 10 }).items : listAgentRuns({ limit: 10, userId, role }).items,
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
  recordLoginFailure,
  isLoginLocked,
  clearLoginFailures,
  createPasswordReset,
  findPasswordResetByTokenHash,
  markPasswordResetUsed,
  updateUserPassword,
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
  listOrders,
  addOrder,
  updateOrder,
  deleteOrder,
  orderStats,
  addReport,
  getSettings,
  setSetting,
  getDashboard,
  createAgentRun,
  markAgentRunRunning,
  appendAgentStep,
  updateAgentStep,
  finishAgentRun,
  getAgentRun,
  getAgentRunByCommandId,
  listAgentRuns,
  markAgentRunCancelled,
  listCommandJobs,
  recoverInterruptedRuns,
};
