// index.js — OpenClaw AI跨境运营员工平台 · 后端主服务
// Express API + 安全会话 + SQLite 业务数据 + 受限前端静态托管

const path = require('path');
if (process.env.NODE_ENV !== 'test') require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { runAgent, runAgentTools, detectAction } = require('./bridge');
const { loadKnowledgeBase, retrieve, answer, fileStats } = require('./kb');
const feishu = require('./feishu');
const {
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
  getAgentRun,
  markCommandRunning,
  finishCommandJob,
  recoverInterruptedCommands,
  recentCommands,
  listAgentRuns,
  markAgentRunCancelled,
  listCommandJobs,
  createAgentRun,
  markAgentRunRunning,
  appendAgentStep,
  updateAgentStep,
  finishAgentRun,
  recoverInterruptedRuns,
  createApproval,
  getApproval,
  listApprovals,
  decideApproval: decideApprovalDb,
  migrateApprovalsFromJson,
  listAgents,
  updateAgentStatus,
  updateAgentSkill,
  listActivity,
  addActivity,
  listOrders,
  addOrder,
  updateOrder,
  deleteOrder,
  orderStats,
  listLeads,
  promoteLead,
  listReports,
  addReport,
  getSettings,
  setSetting,
  getDashboard,
} = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_SECRET = process.env.SESSION_SECRET || (isProduction ? '' : 'dev-only-change-me');

if (isProduction && (!SESSION_SECRET || SESSION_SECRET === 'replace-me' || SESSION_SECRET === 'dev-only-change-me')) {
  throw new Error('生产环境必须设置强 SESSION_SECRET，且不能使用 replace-me');
}
if (!isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'replace-me')) {
  console.warn('⚠ SESSION_SECRET 未配置或仍为 replace-me；开发环境使用临时密钥，生产环境会拒绝启动。');
}
if (isProduction) app.set('trust proxy', 1);

function parseCorsOrigins(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(o => o !== '*');
}

const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
const sameOriginSet = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...allowedOrigins,
]);

if (allowedOrigins.length) {
  app.use(cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS origin denied'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }));
}

app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'], 'connect-src': ["'self'"], 'frame-ancestors': ["'none'"] } } }));
app.use(express.json({ limit: '2mb' }));

class SQLiteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expired <= Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 24 * 60 * 60 * 1000;
      const expired = Date.now() + maxAge;
      db.prepare(`INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired`).run(sid, JSON.stringify(sess), expired);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb && cb(null); }
    catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

app.use(session({
  name: 'oc.sid',
  secret: SESSION_SECRET,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

function requestMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') || '' };
}

function audit(req, action, entityType, entityId, metadata) {
  try {
    logAudit({ userId: req.user && req.user.id, action, entityType, entityId, metadata, ...requestMeta(req) });
  } catch (e) {
    console.warn('[audit] failed:', e.message);
  }
}

function attachUser(req, res, next) {
  if (!req.session.userId) return next();
  const row = findUserById(req.session.userId);
  if (!row || row.status !== 'active') {
    req.session.destroy(() => {});
    return next();
  }
  req.user = toSafeUser(row);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ ok: false, error: '权限不足' });
    next();
  };
}

function sameOriginWriteGuard(req, res, next) {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  const selfOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== selfOrigin && !sameOriginSet.has(origin)) return res.status(403).json({ ok: false, error: '跨站请求被拒绝' });
  next();
}

function makeLimiter({ windowMs, max, keyGenerator }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => res.status(429).json({ ok: false, error: '请求过于频繁，请稍后再试' }),
  });
}

const ipKey = (req) => rateLimit.ipKeyGenerator(req.ip);
const userOrIpKey = (req) => req.user ? `user:${req.user.id}` : `ip:${rateLimit.ipKeyGenerator(req.ip)}`;
const limitScale = process.env.NODE_ENV === 'test' ? 1000 : 1;
const loginLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 5 * limitScale, keyGenerator: ipKey });
const registerLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 20 * limitScale, keyGenerator: ipKey });
const commandLimiter = makeLimiter({ windowMs: 10 * 60 * 1000, max: 10 * limitScale, keyGenerator: userOrIpKey });
const kbQueryLimiter = makeLimiter({ windowMs: 10 * 60 * 1000, max: 30 * limitScale, keyGenerator: userOrIpKey });

function validateEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const FAKE_PASSWORD_HASH = bcrypt.hashSync('fake-password-for-timing', 12);

function safeUserResponse(req) {
  return req.user ? { ok: true, user: req.user } : { ok: false, error: '请先登录' };
}

function loginSession(req, user, cb) {
  req.session.regenerate(err => {
    if (err) return cb(err);
    req.session.userId = user.id;
    cb(null);
  });
}

function bootstrapAdminFromEnv() {
  if (usersCount() > 0) return;
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || !password) return;
  if (!validateEmail(email) || password.length < 8) {
    console.warn('⚠ ADMIN_EMAIL / ADMIN_PASSWORD 不合法，跳过管理员初始化。');
    return;
  }
  const user = createUser({ email, name: process.env.ADMIN_NAME || 'Admin', passwordHash: bcrypt.hashSync(password, 12), role: 'admin' });
  logAudit({ userId: user.id, action: 'admin_bootstrap', entityType: 'user', entityId: String(user.id), metadata: { email } });
  console.log(`✅ 已从环境变量初始化管理员账号：${email}`);
}
bootstrapAdminFromEnv();

app.use(attachUser);
app.use(sameOriginWriteGuard);

const ROUTE_RULES = [
  { agent: 0, name: '\u5E02\u573A\u8C03\u7814 Agent', kw: ['\u7ADE\u54C1', '\u5468\u62A5', '\u8C03\u7814', '\u8D8B\u52BF', '\u9009\u54C1', 'voc', '\u8BC4\u8BBA', '\u5E02\u573A'], color: '#60a5fa' },
  { agent: 1, name: '\u5185\u5BB9\u4E0E\u89C6\u89C9 Agent', kw: ['listing', '\u6807\u9898', 'seo', '\u811A\u672C', '\u6587\u6848', '\u591A\u8BED\u79CD', '\u672C\u5730\u5316', '\u7206\u6B3E'], color: '#a855f7' },
  { agent: 2, name: '\u83B7\u5BA2\u4E0E\u793E\u5A92 Agent', kw: ['\u53D1\u5E16', '\u793E\u5A92', '\u6392\u671F', '\u79CD\u8349', 'reddit', 'tiktok', 'x \u8D26\u53F7', '\u77E9\u9635'], color: '#fb7185' },
  { agent: 3, name: '\u5BA2\u670D\u4E0E\u8BA2\u5355 Agent', kw: ['\u5BA2\u6237', '\u56DE\u590D', '\u7269\u6D41', '\u67E5\u5355', '\u9000\u6362\u8D27', '\u5BA2\u670D', '\u8BE2', 'moq', '\u5C3A\u7801'], color: '#34d399' },
  { agent: 4, name: '\u5408\u89C4\u4E0E\u98CE\u63A7 Agent', kw: ['\u5BA1\u67E5', '\u4FB5\u6743', '\u654F\u611F\u8BCD', 'fda', '\u6C34\u5370', '\u5E7F\u544A', 'roas', '\u5408\u89C4', '\u4E0A\u67B6\u524D'], color: '#fbbf24' },
];

function routeCommand(command) {
  const lower = String(command || '').toLowerCase();
  const greeting = ['\u4f60\u597d', '\u55e8', 'hello', 'hi', '\u65e9', '\u665a\u4e0a\u597d', '\u4e0a\u5348\u597d', '\u4e0b\u5348\u597d', '\u5728\u5417', '\u5728\u4e0d\u5728', '\u611f\u8c22', 'thanks', 'thank you', '\u8c22\u8c22', '\u518d\u89c1', 'bye', '\u5e2e\u5fd9'];
  for (const g of greeting) {
    if (lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + '\uFF0C') || lower.startsWith(g + ',')) {
      return { agent: 3, name: '\u5ba2\u670d\u4e0e\u8ba2\u5355 Agent', color: '#34d399', greeting: true };
    }
  }
  for (const rule of ROUTE_RULES) {
    if (rule.kw.some(k => lower.includes(k))) return rule;
  }
  return { agent: 3, name: '\u5ba2\u670d\u4e0e\u8ba2\u5355 Agent', color: '#34d399' };
}

function truncateText(value, max = 12000) {
  return String(value == null ? '' : value).slice(0, max);
}

function safeToolOutput(result) {
  if (!result) return { ok: false, error: '\u5DE5\u5177\u672A\u8FD4\u56DE\u7ED3\u679C' };
  if (result.ok === false) return result;
  return { ok: true, output: result.content || result.answer || JSON.stringify(result) };
}

// ========== Agent tool registry (single source) ==========
const AGENT_TOOL_DEFS = [
  {
    name: 'kb_search', label: '知识库检索', description: '检索本地知识库（尺码表/退换货/FAQ），返回带来源片段',
    schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    prompt: 'kb', handler: async (args, meta) => {
      const q = args.question || meta.command;
      const chunks = retrieve(q, 4);
      return { output: chunks.length ? chunks.map((c, i) => `片段${i + 1}【${c.file}·${c.heading}】\n${truncateText(c.content, 1600)}`).join('\n\n') : '未命中本地知识库。' };
    },
  },
  {
    name: 'research', label: '市场调研', description: '竞品/市场调研，输出结构化报告（用已有知识，不联网）',
    schema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    prompt: 'research', handler: async (args, meta) => safeToolOutput(await runAgentModel(buildToolPrompt('research', { topic: args.topic || meta.command }), meta)),
  },
  {
    name: 'listing', label: 'Listing 生成', description: '生成中英双语 Listing 草稿（SEO标题/五点描述/合规提示）',
    schema: { type: 'object', properties: { product: { type: 'string' }, context: { type: 'string', description: '可选：调研/知识库结论' } } },
    prompt: 'listing', handler: async (args, meta) => {
      const product = args.product || meta.command;
      const contextText = args.context ? `调研/上下文：\n${args.context}\n\n` : '';
      return safeToolOutput(await runAgentModel(buildToolPrompt('listing', { product: contextText ? `${contextText}\n产品：${product}` : product }), meta));
    },
  },
  {
    name: 'localize', label: '本地化', description: '多语种本地化改写（注意文化禁忌/货币/尺寸表达）',
    schema: { type: 'object', properties: { text: { type: 'string' }, target_language: { type: 'string' } }, required: ['text'] },
    prompt: 'localize', handler: async (args, meta) => safeToolOutput(await runAgentModel(buildToolPrompt('localize', { text: args.text || meta.command, targetLanguage: args.target_language || '目标语言' }), meta)),
  },
  {
    name: 'compliance', label: '合规审查', description: '敏感词/FDA禁用表述/侵权风险审查，输出违规点清单',
    schema: { type: 'object', properties: { items: { type: 'string' } }, required: ['items'] },
    prompt: 'compliance', handler: async (args, meta) => safeToolOutput(await runAgentModel(buildToolPrompt('compliance', { items: args.items || meta.command }), meta)),
  },
  {
    name: 'lead_data', label: '读取线索', description: '读取当前线索库记录',
    schema: { type: 'object', properties: {} },
    prompt: 'lead_data', handler: async (args, meta) => {
      const leads = listLeads('all');
      return { output: leads.map(l => `${l.id}|${l.channel}|${l.name}|${l.msg}`).join('\n') || '暂无线索数据。' };
    },
  },
  {
    name: 'leads', label: '线索打标', description: '对线索做意向分级（高意向/普通/垃圾），输出可导入 CSV 的表格',
    schema: { type: 'object', properties: { messages: { type: 'string' } }, required: ['messages'] },
    prompt: 'leads', handler: async (args, meta) => safeToolOutput(await runAgentModel(buildToolPrompt('leads', { messages: args.messages || meta.command }), meta)),
  },
  {
    name: 'order_stats', label: '订单统计', description: '统计当前订单数据',
    schema: { type: 'object', properties: {} },
    prompt: 'order_stats', handler: async (args, meta) => {
      try { const s = orderStats(); return { output: `订单总数 ${s.total}，今日 ${s.today}，待处理 ${s.pending}，已发货 ${s.shipped}` }; }
      catch (_) { return { output: '未接入订单数据源。' }; }
    },
  },
  {
    name: 'report', label: '运营报告', description: '生成运营报告（结论/数据洞察/建议）',
    schema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    prompt: 'report', handler: async (args, meta) => safeToolOutput(await runAgentModel(buildToolPrompt('report', { topic: args.topic || meta.command }), meta)),
  },
  {
    name: 'approval_draft', label: '审批草稿', description: '对外动作（发帖/上架/下单/退款）只出执行方案草稿，绝不真实执行',
    schema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
    prompt: 'approval_draft', handler: async (args, meta) => {
      const prompt = `你是跨境电商运营审批助手。以下任务属于对外动作，不得真实执行。\n请输出可直接人工审批的执行方案：\n- 目标平台/对象\n- 内容草稿\n- 风险提示\n- 需要人工确认的事项\n\n任务：${args.task || meta.command}`;
      return safeToolOutput(await runAgentModel(prompt, meta));
    },
  },
];

function summarizePlan(plan) {
  return plan.map((s, i) => ({ seq: i + 1, kind: s.kind, label: s.label, tool: s.tool || null }));
}

async function runAgentModel(prompt, meta) {
  return runAgent(prompt, { agentId: meta.agentId || 'main', sessionId: meta.sessionId || 'agent-run' });
}

function buildToolPrompt(toolName, args, command) {
  const common = 'You are a cross-border ecommerce operations agent. Do not output opening remarks. Output the task result directly.\n';
  if (toolName === 'kb') return common + 'Answer the customer question using the knowledge base: ' + (args.question || command);
  if (toolName === 'research') return common + 'Execute a competitor/market research task and output a structured report.\nTask: ' + (args.topic || command);
  if (toolName === 'listing') return common + `\u8bf7\u5148\u7528\u4e2d\u6587\u8f93\u51fa\u5b8c\u6574 Listing \u8349\u7a3f\uff0c\u5305\u542b SEO \u6807\u9898\u3001\u4e94\u70b9\u63cf\u8ff0\u3001\u5356\u70b9\u603b\u7ed3\u3001\u5408\u89c4\u63d0\u793a\u3002\u6bcf\u4e2a\u6807\u9898\u5148\u7ed9\u4e2d\u6587\u89e3\u91ca\uff0c\u518d\u7ed9\u82f1\u6587\u4e0a\u67b6\u7248\u3002\u4e94\u70b9\u63cf\u8ff0\u540c\u6837\u4e2d\u82f1\u53cc\u8bed\u3002\u6700\u540e\u9644\u4e00\u4efd\u5168\u82f1\u6587\u53ef\u4e0a\u67b6\u7248\u3002\n\u4ea7\u54c1\uff1a${args.product || command}`;
  if (toolName === 'localize') return common + 'Localize the text into ' + (args.targetLanguage || 'target language') + ' and keep cultural/currency/size conventions.\nText:\n' + (args.text || command);
  if (toolName === 'compliance') return common + 'Audit the content for sensitive words, FDA claims, and infringement risk. Output a violation list and fixes.\nContent:\n' + (args.items || command);
  if (toolName === 'leads') return common + 'Grade the leads as hot/warm/cold and output a CSV-ready table.\nLeads:\n' + (args.messages || command);
  if (toolName === 'report') return common + 'Generate an operations report with conclusions, insights, and recommendations.\nTopic: ' + (args.topic || command);
  return common + 'Complete the task and output a deliverable.\nTask: ' + command;
}

async function runPlannedStep(step, meta) {
  const command = meta.command;
  if (step.tool === 'route') {
    return { ok: true, output: 'Routed to ' + (step.agentName || 'agent') + ', plan has ' + step.childCount + ' steps.', meta: { agentName: step.agentName, childCount: step.childCount } };
  }
  if (step.tool === 'context') {
    const q = step.args && step.args.question ? step.args.question : command;
    const chunks = retrieve(q, 4);
    if (!chunks.length) return { ok: true, output: 'No knowledge base match.', meta: { hits: 0 } };
    return { ok: true, output: chunks.map((c, i) => 'Fragment ' + (i + 1) + ' [' + c.file + ' - ' + c.heading + ']\n' + truncateText(c.content, 1600)).join('\n\n'), meta: { hits: chunks.length } };
  }
  if (step.tool === 'kb_answer') {
    const q = step.args && step.args.question ? step.args.question : command;
    return safeToolOutput(await answer(q));
  }
  if (step.tool === 'lead_data') {
    const leads = listLeads('all');
    const text = leads.map(l => `${l.id}|${l.channel}|${l.name}|${l.msg}`).join('\n');
    return { ok: true, output: text || 'No lead data.', meta: { count: leads.length } };
  }
  if (step.tool === 'order_stats') {
    try {
      const s = orderStats();
      return { ok: true, output: 'Orders total ' + s.total + ', today ' + s.today + ', pending ' + s.pending + ', shipped ' + s.shipped };
    } catch (_) { return { ok: true, output: 'No order source.' }; }
  }
  if (step.tool === 'greeting') {
    return { ok: true, output: 'Hello! I am your cross-border ecommerce assistant. Ask about sizing, returns, logistics, research, listings, or compliance.', meta: { type: 'greeting' } };
  }
  if (step.tool === 'approval_draft') {
    const prompt = `You are a cross-border ecommerce approval assistant. This task is an external action, do not execute it.\nOutput an approval-ready plan:\n- Target platform/object\n- Content draft\n- Risk notes\n- Items requiring manual confirmation\n\nTask: ${command}`;
    return safeToolOutput(await runAgentModel(prompt, meta));
  }
  const args = step.args || {};
  const prompt = buildToolPrompt(step.tool, args, command);
  return safeToolOutput(await runAgentModel(prompt, meta));
}

function buildAgentPlan(command, route) {
  const lower = String(command || '').toLowerCase();
  const plan = [];
  plan.push({ kind: 'plan', label: 'Route', tool: 'route', agentName: route.name, childCount: 3, color: route.color });
  if (route.greeting) {
    plan.push({ kind: 'tool', label: 'Greeting', tool: 'greeting', args: { text: command }, color: '#34d399' });
    plan.push({ kind: 'output', label: 'Output', tool: null, args: {}, color: route.color });
    return plan;
  }
  const wantsOrders = ['order', 'orders', 'today'].some(k => lower.includes(k));
  if (wantsOrders) {
    plan.push({ kind: 'tool', label: 'Order stats', tool: 'order_stats', args: { text: command }, color: '#60a5fa' });
    plan.push({ kind: 'output', label: 'Output', tool: null, args: {}, color: route.color });
    return plan;
  }
  const wantsKb = ['size', 'return', 'logistics', 'faq', 'policy'].some(k => lower.includes(k));
  if (wantsKb) plan.push({ kind: 'tool', label: 'KB context', tool: 'context', args: { question: command }, color: '#34d399' });
  if (route.agent === 0) plan.push({ kind: 'tool', label: 'Research', tool: 'research', args: { topic: command }, color: route.color });
  else if (route.agent === 1) plan.push({ kind: 'tool', label: 'Listing', tool: 'listing', args: { product: command }, color: route.color });
  else if (route.agent === 2) plan.push({ kind: 'tool', label: 'Report', tool: 'report', args: { topic: command }, color: route.color });
  else if (route.agent === 3) {
    if (lower.includes('lead') || lower.includes('clean')) {
      plan.push({ kind: 'tool', label: 'Lead data', tool: 'lead_data', args: {}, color: route.color });
      plan.push({ kind: 'tool', label: 'Leads', tool: 'leads', args: { messages: command }, color: route.color });
    } else plan.push({ kind: 'tool', label: 'KB answer', tool: 'kb_answer', args: { question: command }, color: route.color });
  }
  else if (route.agent === 4) plan.push({ kind: 'tool', label: 'Compliance', tool: 'compliance', args: { items: command }, color: route.color });
  else plan.push({ kind: 'tool', label: 'Report', tool: 'report', args: { topic: command }, color: route.color });
  if (detectAction(command)) plan.push({ kind: 'gate', label: 'Approval', tool: 'approval_draft', args: { command }, color: '#fbbf24' });
  plan.push({ kind: 'output', label: 'Output', tool: null, args: {}, color: route.color });
  return plan;
}

function extractSummary(content, fallback) {
  const text = String(content || '');
  const firstLine = text.split('\n').map(s => s.trim()).find(Boolean) || '';
  return truncateText(firstLine.slice(0, 160) || fallback, 200);
}

const TOOL_SCHEMAS = AGENT_TOOL_DEFS.map(d => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.schema } }));

function agenticPreloadContext(command) {
  const lower = String(command || '').toLowerCase();
  const wantsKb = ['\u5c3a\u7801', '\u9000\u6362\u8d27', '\u7269\u6d41', '\u5ba2\u670d', '\u56de\u590d', 'FAQ', '\u67e5\u5355', '\u653f\u7b56'].some(k => lower.includes(k));
  if (!wantsKb) return '';
  const chunks = retrieve(command, 4);
  if (!chunks.length) return '';
  return chunks.map((c, i) => '\u7247\u6bb5' + (i + 1) + '\u3010' + c.file + '\u00b7' + c.heading + '\u3011\n' + truncateText(c.content, 1600)).join('\n\n');
}

async function runAgenticCommand(meta) {
  const command = String(meta.command || '');
  const runId = meta.runId;
  const startedAt = Date.now();
  const stats = { steps: 0, tools: 0, retries: 0, failedSteps: 0 };
  const kbContext = agenticPreloadContext(command);
  const prompt = `${command}\n\n${kbContext ? '知识库上下文：\n' + kbContext : ''}`;
  const maxRounds = Math.max(1, Math.min(12, Number(process.env.AGENT_MAX_ROUNDS || 8)));
  const result = await runAgentTools(prompt, TOOL_SCHEMAS, {
    maxRounds,
    sessionId: meta.sessionId,
    executor: async (name, args) => {
      const def = AGENT_TOOL_DEFS.find(d => d.name === name);
      if (!def) return { output: `???? ${name}` };
      return def.handler(args || {}, meta);
    },
    onStep: async (step) => {
      const seq = stats.steps;
      appendAgentStep({
        runId, seq, kind: 'tool', label: step.tool, tool: step.tool,
        args: step.args || {}, input: command, output: truncateText(step.output || '', 20000),
        meta: { agentic: true, error: step.error || null }, status: step.error ? 'error' : 'done',
        durationMs: 0,
      });
      stats.steps += 1;
      stats.tools += 1;
    },
  });
  stats.durationMs = Date.now() - startedAt;
  if (!result.ok) return { ok: false, error: result.error, stats };
  if ((result.steps || []).length && (result.steps || []).every(s => s.error)) {
    return { ok: false, error: '????????', _fallbackable: true, stats };
  }
  if (detectAction(command) && !(result.steps || []).some(s => s.tool === 'approval_draft')) {
    const def = AGENT_TOOL_DEFS.find(d => d.name === 'approval_draft');
    const forced = def ? await def.handler({ task: command }, meta) : { output: '' };
    const seq = stats.steps;
    appendAgentStep({
      runId, seq, kind: 'tool', label: 'approval_draft', tool: 'approval_draft',
      args: { task: command }, input: command, output: truncateText(forced.output || '', 20000),
      meta: { agentic: true, forced: true }, status: 'done', durationMs: 0,
    });
    stats.steps += 1;
    stats.tools += 1;
    result.steps.push({ tool: 'approval_draft', args: { task: command }, output: forced.output, error: '' });
    result.content = forced.output || result.content;
  }
  finishAgentRun(runId, {
    status: 'ok',
    plan: result.steps.map((s, i) => ({ seq: i + 1, kind: 'tool', label: s.tool, tool: s.tool })),
    result: result.content,
    summary: extractSummary(result.content, 'Agentic 完成'),
    context: { ...meta.context, mode: 'agentic', kb: !!kbContext },
    stats,
    durationMs: stats.durationMs,
    path: 'agentic',
    model: result.model || 'orchestrator',
  });
  return { ok: true, runId, content: result.content, action: detectAction(command), steps: stats.steps, route: meta.routeName, routeAgent: meta.routeAgent, model: result.model, path: 'agentic', stats };
}

function resolveAgentMode() {
  const mode = String(process.env.AGENT_MODE || 'auto').toLowerCase();
  if (mode === 'agentic' || mode === 'rules') return mode;
  return 'agentic';
}

async function executeAgentCommand(meta) {
  const command = String(meta.command || '');
  const route = routeCommand(command);
  const context = {
    task: command,
    route: route.name,
    agentId: route.agent,
    createdAt: new Date().toISOString(),
    sessionId: meta.sessionId || null,
  };
  const runId = createAgentRun({
    commandId: meta.commandId,
    userId: meta.userId,
    command,
    agentId: meta.agentId || 'main',
    context,
  });
  markAgentRunRunning(runId);
  if (route.agent != null) updateAgentStatus(route.agent, 'busy', '正在执行：' + truncateText(command, 80));
  const startedAt = Date.now();
  const stats = { steps: 0, tools: 0, retries: 0, failedSteps: 0 };
  const mode = resolveAgentMode();
  if (mode === 'agentic' && !route.greeting) {
    const agentic = await runAgenticCommand({
      ...meta,
      runId,
      command,
      context,
      routeName: route.name,
      routeAgent: route.agent,
    });
    if (agentic.ok) {
      if (route.agent != null) updateAgentStatus(route.agent, 'online', '待命');
      return agentic;
    }
    stats.retries += 1;
  }
  const plan = buildAgentPlan(command, route);
  const outputs = [];

  try {
    let seq = 0;
    for (const step of plan) {
      const stepStarted = Date.now();
      appendAgentStep({
        runId, seq, kind: step.kind, label: step.label, tool: step.tool,
        args: step.args, input: command, status: 'running',
      });
      let result;
      try {
        result = await runPlannedStep(step, { ...meta, agentId: 'main', sessionId: meta.sessionId || `run-${runId}` });
        if (!result.ok && step.tool && step.kind === 'tool') {
          stats.retries += 1;
          result = await runPlannedStep(step, { ...meta, agentId: 'main', sessionId: meta.sessionId || `run-${runId}`, retry: true });
        }
      } catch (e) {
        result = { ok: false, error: e.message || '\u5DE5\u5177\u6267\u884C\u5931\u8D25' };
      }
      const output = result.ok ? result.output : `\u6267\u884C\u5931\u8D25\uFF1A${result.error}`;
      updateAgentStep(runId, seq, {
        status: result.ok ? 'done' : 'error',
        output: truncateText(output, 20000),
        meta: result.meta || { tool: step.tool, retried: stats.retries > 0 },
        durationMs: Date.now() - stepStarted,
      });
      outputs.push(output);
      stats.steps += 1;
      if (step.tool) stats.tools += 1;
      if (!result.ok) {
        stats.failedSteps += 1;
        throw new Error(result.error || 'Agent \u6B65\u9AA4\u6267\u884C\u5931\u8D25');
      }
      seq += 1;
    }

    const content = outputs.join('\n\n---\n\n');
  if (route.agent != null) updateAgentStatus(route.agent, 'online', '待命');
    stats.durationMs = Date.now() - startedAt;
    finishAgentRun(runId, {
      status: 'ok',
      plan: summarizePlan(plan),
      result: content,
      summary: extractSummary(content, route.name),
      context,
      stats,
      durationMs: stats.durationMs,
      path: stats.retries > 0 ? 'agentic_fallback' : 'agent',
      model: 'orchestrator',
    });
    return { ok: true, runId, content, action: detectAction(command), steps: outputs.length, route: route.name, routeAgent: route.agent, model: 'orchestrator', path: stats.retries > 0 ? 'agentic_fallback' : 'agent', stats };
  } catch (e) {
    stats.durationMs = Date.now() - startedAt;
    if (route.agent != null) updateAgentStatus(route.agent, "online", "待命");
    finishAgentRun(runId, {
      status: 'error',
      plan: summarizePlan(plan),
      error: e.message || 'Agent \u6267\u884C\u5931\u8D25',
      summary: extractSummary(e.message, route.name),
      context,
      stats,
      durationMs: stats.durationMs,
      path: stats.retries > 0 ? 'agentic_fallback' : 'agent',
      model: 'orchestrator',
    });
    return { ok: false, runId, error: e.message || 'Agent \u6267\u884C\u5931\u8D25', stats, path: stats.retries > 0 ? 'agentic_fallback' : 'agent' };
  }
}
// ---------- 异步命令队列 ----------
const COMMAND_CONCURRENCY = Math.max(1, Number(process.env.COMMAND_CONCURRENCY || 1));
const commandQueue = [];
let commandActive = 0;

function enqueueCommand(commandId, meta) {
  commandQueue.push({ commandId, meta });
  setImmediate(drainCommandQueue);
}

function drainCommandQueue() {
  while (commandActive < COMMAND_CONCURRENCY && commandQueue.length) {
    const job = commandQueue.shift();
    commandActive += 1;
    processCommandJob(job.commandId, job.meta)
      .catch(e => console.error('[command-job] unhandled error:', e))
      .finally(() => {
        commandActive -= 1;
        drainCommandQueue();
      });
  }
}

async function processCommandJob(commandId, meta) {
  const notify = (payload) => { if (typeof meta.onComplete === 'function') setImmediate(() => meta.onComplete(payload).catch(e => console.error('[command-job] callback error:', e))); };
  markCommandRunning(commandId);
  const startedAt = Date.now();
  const action = detectAction(meta.command);
  try {
    const result = await executeAgentCommand({ ...meta, commandId });
    const jobMeta = { path: 'agent', model: 'orchestrator' };
    jobMeta.durationMs = Date.now() - startedAt;
    jobMeta.contentLen = (result.content || '').length;
    jobMeta.needsApproval = !!action;

    if (!result.ok) {
      jobMeta.status = 'error';
      jobMeta.error = result.error || '执行失败';
      finishCommandJob(commandId, jobMeta);
      logAudit({ userId: meta.userId, action: 'command_error', entityType: 'command', entityId: String(commandId), metadata: { path: jobMeta.path, error: jobMeta.error }, ip: meta.ip, userAgent: meta.userAgent });
      notify({ commandId, status: 'error', error: result.error || '\u6267\u884c\u5931\u8d25' });
      return;
    }

    let approval = null;
    if (action) {
      approval = createApproval({
        title: `${action.label}：${meta.command.slice(0, 30)}`,
        command: meta.command,
        action: action.action,
        draft: result.content,
        risk: '对外动作，需人工确认后执行',
        createdBy: meta.userId,
        runId: result.runId,
      });
      jobMeta.approvalId = approval.id;
    }

    jobMeta.status = 'ok';
    jobMeta.content = result.content;
    jobMeta.error = null;
    finishCommandJob(commandId, jobMeta);
    let report = null;
    if (!action && result.content) {
      report = addReport({
        agent: result.routeAgent != null ? result.routeAgent : 0,
        title: meta.command.slice(0, 24) + (meta.command.length > 24 ? '…' : ''),
        tag: result.route || 'Agent',
        color: '#6366f1',
        content: result.content,
        commandId,
        userId: meta.userId,
      });
      const updated = getAgentRun(result.runId);
      if (updated && updated.steps && updated.steps.length) {
        const last = updated.steps[updated.steps.length - 1];
        updateAgentStep(result.runId, last.seq, { status: last.status, output: last.output, meta: { ...(last.meta || {}), reportId: report.id }, durationMs: last.durationMs });
      }
    }
    addActivity({ tag: action ? '审批' : '指令', color: action ? '#fbbf24' : '#6366f1', text: action ? `生成审批条目 ${approval.id}：${approval.title}` : `完成指令：${meta.command.slice(0, 30)}`, userId: meta.userId });
    logAudit({ userId: meta.userId, action: 'command_run', entityType: 'command', entityId: String(commandId), metadata: { needsApproval: !!action, approvalId: approval && approval.id }, ip: meta.ip, userAgent: meta.userAgent });
    notify({ commandId, status: 'ok', content: result.content, approvalId: approval && approval.id, route: result.route });
  } catch (e) {
    console.error('[command-job] error:', e);
    finishCommandJob(commandId, { status: 'error', durationMs: Date.now() - startedAt, error: '内部错误', needsApproval: !!action });
    notify({ commandId, status: 'error', error: '\u5185\u90e8\u9519\u8bef' });
  }
}

// ---------- 知识库上传（multer） ----------
const KB_DIR = path.join(__dirname, '..', '知识库');
const KB_ALLOWED_EXT = new Set(['.md', '.txt', '.pdf', '.docx', '.xlsx', '.csv']);
const KB_INDEXED_EXT = new Set(['.md', '.txt']);

const kbUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });
      cb(null, KB_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      let orig = file.originalname;
      try { orig = Buffer.from(orig, 'latin1').toString('utf8'); } catch {}
      const base = path.basename(orig, ext).replace(/[^\w一-龥.-]/g, '_');
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (KB_ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error(`不支持的文件类型：${ext}`));
  },
});

// ---------- public API ----------
app.get('/api/health', requireAuth, (req, res) => {
  const bridge = require('./bridge');
  res.json({
    ok: true,
    service: 'ecommerce-agent-server',
    time: new Date().toISOString(),
    model: bridge.DIRECT_MODEL,
    directConfigured: !!(bridge.PROVIDER.baseUrl && bridge.PROVIDER.apiKey),
    gatewayConfigured: !!bridge.GATEWAY_URL,
  });
});

app.post('/api/auth/register', registerLimiter, (req, res) => {
  logAudit({ action: 'register_blocked', metadata: { reason: 'public_registration_disabled' }, ...requestMeta(req) });
  res.status(403).json({ ok: false, error: '公开注册已关闭，请联系管理员创建账号' });
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = validateEmail(normalizedEmail) ? findUserByEmail(normalizedEmail) : null;
  const passwordString = typeof password === 'string' ? password : '';
  if (!user || user.status !== 'active') {
    await bcrypt.compare(passwordString, FAKE_PASSWORD_HASH);
    logAudit({ action: 'login_failed', metadata: { email: normalizedEmail }, ...requestMeta(req) });
    return res.status(401).json({ ok: false, error: '\u90ae\u7bb1\u6216\u5bc6\u7801\u9519\u8bef' });
  }
  if (!passwordString) {
    await bcrypt.compare(passwordString, FAKE_PASSWORD_HASH);
    logAudit({ userId: user.id, action: 'login_failed', entityType: 'user', entityId: String(user.id), ...requestMeta(req) });
    return res.status(401).json({ ok: false, error: '\u90ae\u7bb1\u6216\u5bc6\u7801\u9519\u8bef' });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    logAudit({ userId: user.id, action: 'login_failed', entityType: 'user', entityId: String(user.id), ...requestMeta(req) });
    return res.status(401).json({ ok: false, error: '邮箱或密码错误' });
  }
  loginSession(req, user, err => {
    if (err) return res.status(500).json({ ok: false, error: '登录失败，请稍后重试' });
    updateLastLogin(user.id);
    req.user = toSafeUser(findUserById(user.id));
    audit(req, 'login', 'user', String(user.id));
    res.json(safeUserResponse(req));
  });
});

app.post('/api/auth/logout', (req, res) => {
  const userId = req.session.userId;
  req.session.destroy(() => {
    res.clearCookie('oc.sid');
    logAudit({ userId, action: 'logout', entityType: 'user', entityId: userId ? String(userId) : null, ...requestMeta(req) });
    res.json({ ok: true });
  });
});

// 此后的业务 API 均需登录
app.use('/api', requireAuth);

app.get('/api/auth/me', (req, res) => res.json(safeUserResponse(req)));

app.get('/api/dashboard', (req, res) => {
  res.json({ ok: true, data: getDashboard(req.user.id, req.user.role) });
});

app.post('/api/actions/detect', (req, res) => {
  const command = req.body && req.body.command;
  if (!command || typeof command !== 'string' || command.length > 4000) return res.status(400).json({ ok: false, error: '缺少 command 字段或指令过长' });
  const action = detectAction(command);
  res.json({ ok: true, data: { needsApproval: !!action, action: action ? action.action : null, label: action ? action.label : null } });
});

app.get('/api/agents', (req, res) => res.json({ ok: true, data: listAgents() }));
app.patch('/api/agents/:id', requireRole('operator', 'admin'), (req, res) => {
  const status = req.body && req.body.status;
  if (!['online', 'busy', 'offline'].includes(status)) return res.status(400).json({ ok: false, error: '非法 Agent 状态' });
  const row = updateAgentStatus(Number(req.params.id), status);
  if (!row) return res.status(404).json({ ok: false, error: 'Agent 不存在' });
  audit(req, 'agent_status_update', 'agent', String(req.params.id), { status });
  res.json({ ok: true, data: listAgents().find(a => a.id === Number(req.params.id)) });
});
app.patch('/api/agents/:id/skills/:skillIndex', requireRole('operator', 'admin'), (req, res) => {
  const enabled = !!(req.body && req.body.enabled);
  const agent = updateAgentSkill(Number(req.params.id), Number(req.params.skillIndex), enabled);
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent 或技能不存在' });
  audit(req, 'agent_skill_update', 'agent', String(req.params.id), { skillIndex: Number(req.params.skillIndex), enabled });
  res.json({ ok: true, data: agent });
});


app.get('/api/orders', requireAuth, (req, res) => {
  const limit = Math.min(500, Math.max(1, +req.query.limit || 100));
  const offset = Math.max(0, +req.query.offset || 0);
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim();
  res.json({ ok: true, data: listOrders({ limit, offset, status, search }) });
});

app.get('/api/orders/stats', requireAuth, (req, res) => {
  res.json({ ok: true, data: orderStats() });
});

app.post('/api/orders', requireRole('operator', 'admin'), (req, res) => {
  const data = req.body || {};
  if (!data.orderNo) return res.status(400).json({ ok: false, error: '?? orderNo' });
  try {
    const order = addOrder(data);
    addActivity({ tag: '\u8ba2\u5355', color: '#60a5fa', text: '\u8ba2\u5355\u53d8\u66f4 ' + order.orderNo, userId: req.user.id });
    audit(req, 'order_create', 'order', order.id);
    res.status(201).json({ ok: true, data: order });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.patch('/api/orders/:id', requireRole('operator', 'admin'), (req, res) => {
  const order = updateOrder(req.params.id, req.body || {});
  if (!order) return res.status(404).json({ ok: false, error: '\u8ba2\u5355\u4e0d\u5b58\u5728' });
  addActivity({ tag: '??', color: '#60a5fa', text: '???? ' + order.orderNo, userId: req.user.id });
  audit(req, 'order_update', 'order', order.id);
  res.json({ ok: true, data: order });
});

app.delete('/api/orders/:id', requireRole('operator', 'admin'), (req, res) => {
  const ok = deleteOrder(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: '?????' });
  audit(req, 'order_delete', 'order', req.params.id);
  res.json({ ok: true });
});
app.get('/api/activity', (req, res) => {
  const limit = Math.min(100, Math.max(1, +req.query.limit || 30));
  res.json({ ok: true, data: listActivity(limit) });
});

app.get('/api/leads', requireRole('operator', 'admin'), (req, res) => {
  const grade = String(req.query.grade || 'all');
  if (!['all', 'hot', 'warm', 'cold'].includes(grade)) return res.status(400).json({ ok: false, error: '非法线索分级' });
  res.json({ ok: true, data: listLeads(grade, { role: req.user.role }) });
});
app.get('/api/leads/export.csv', requireRole('operator', 'admin'), (req, res) => {
  const leads = listLeads('all');
  const header = ['线索ID', '渠道', '客户', '地区', '原话', '意向', '分级', '得分', '时间', '状态'];
  const rows = leads.map(l => [l.id, l.channel, l.name, l.country, l.msg, l.intent, l.grade, l.score, l.time, l.status]);
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send('﻿' + csv);
});
app.post('/api/leads/:id/promote', requireRole('operator', 'admin'), (req, res) => {
  const row = promoteLead(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ ok: false, error: '线索不存在' });
  addActivity({ tag: '客服', color: '#34d399', text: `线索 ${row.id}「${row.name}」转入 CRM 跟进池`, userId: req.user.id });
  audit(req, 'lead_promote', 'lead', row.id);
  res.json({ ok: true, data: row });
});

app.get('/api/reports', (req, res) => {
  const limit = Math.min(100, Math.max(1, +req.query.limit || 20));
  res.json({ ok: true, data: listReports(limit) });
});
app.post('/api/reports', requireRole('operator', 'admin'), (req, res) => {
  const { agent, title, tag, color, content } = req.body || {};
  if (!title || typeof title !== 'string') return res.status(400).json({ ok: false, error: '缺少 title 字段' });
  const report = addReport({ agent, title, tag, color, content, userId: req.user.id });
  res.status(201).json({ ok: true, data: report });
});

app.get('/api/settings', (req, res) => res.json({ ok: true, data: getSettings(req.user.id) }));
app.patch('/api/settings', requireRole('operator', 'admin'), (req, res) => {
  const { key, value } = req.body || {};
  if (!key || typeof key !== 'string') return res.status(400).json({ ok: false, error: '缺少 key 字段' });
  try {
    const settings = setSetting(req.user.id, key, value);
    audit(req, 'settings_update', 'setting', key);
    res.json({ ok: true, data: settings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 知识库检索（kb-query skill）
app.post('/api/kb-query', kbQueryLimiter, requireRole('viewer', 'operator', 'admin'), async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== 'string' || question.length > 4000) {
    return res.status(400).json({ ok: false, error: '缺少 question 字段或问题过长' });
  }
  try {
    const result = await answer(question);
    addActivity({ tag: '客服', color: '#34d399', text: `RAG 检索：${question.slice(0, 24)}`, userId: req.user.id });
    res.json(result);
  } catch (e) {
    console.error('[kb-query] error:', e);
    res.status(500).json({ ok: false, error: '知识库检索失败' });
  }
});

app.get('/api/kb/retrieve', requireRole('operator', 'admin'), (req, res) => {
  const q = String(req.query.q || '');
  const k = Math.min(10, Math.max(1, +req.query.k || 3));
  if (!q) {
    const total = Object.values(fileStats()).reduce((s, v) => s + v.chunks, 0);
    return res.json({ ok: true, chunks: [], total });
  }
  const chunks = retrieve(q, k);
  res.json({ ok: true, chunks: chunks.map(c => ({ file: c.file, heading: c.heading, score: c.score, preview: c.content.slice(0, 120) })) });
});

app.get('/api/kb/files', (req, res) => {
  const files = [];
  try {
    const stats = fileStats();
    for (const f of fs.readdirSync(KB_DIR)) {
      const ext = path.extname(f).toLowerCase();
      if (!KB_ALLOWED_EXT.has(ext)) continue;
      const stat = fs.statSync(path.join(KB_DIR, f));
      const indexed = KB_INDEXED_EXT.has(ext);
      files.push({ name: f, size: stat.size, mtime: stat.mtime.toISOString(), indexed, chunks: indexed ? (stats[f]?.chunks || 0) : 0 });
    }
    files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  } catch (e) {}
  const totalChunks = Object.values(fileStats()).reduce((s, v) => s + v.chunks, 0);
  res.json({ ok: true, files, totalChunks });
});

app.post('/api/kb/upload', requireRole('operator', 'admin'), (req, res) => {
  kbUpload.array('files', 20)(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message || '上传失败' });
    const saved = (req.files || []).map(f => {
      const ext = path.extname(f.originalname).toLowerCase();
      return { name: f.filename, originalName: f.originalname, size: f.size, mtime: new Date().toISOString(), indexed: KB_INDEXED_EXT.has(ext) };
    });
    if (saved.some(f => f.indexed)) loadKnowledgeBase();
    addActivity({ tag: '知识库', color: '#a855f7', text: `上传 ${saved.length} 个知识库文档`, userId: req.user.id });
    audit(req, 'kb_upload', 'kb_file', null, { files: saved.map(f => f.name) });
    res.json({ ok: true, files: saved });
  });
});

app.delete('/api/kb/files/:name', requireRole('operator', 'admin'), (req, res) => {
  let name;
  try { name = decodeURIComponent(req.params.name); }
  catch { return res.status(400).json({ ok: false, error: '非法文件名' }); }
  const safe = path.basename(name);
  if (!safe || safe !== name || safe.includes('\\') || safe.includes('/')) return res.status(400).json({ ok: false, error: '非法文件名' });
  const ext = path.extname(safe).toLowerCase();
  if (!KB_ALLOWED_EXT.has(ext)) return res.status(400).json({ ok: false, error: '不支持的文件类型' });
  const full = path.join(KB_DIR, safe);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: '文件不存在' });
  try {
    fs.unlinkSync(full);
    loadKnowledgeBase();
    addActivity({ tag: '知识库', color: '#fbbf24', text: `删除知识库文档：${safe}`, userId: req.user.id });
    audit(req, 'kb_delete', 'kb_file', safe);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: '删除失败' });
  }
});

// 执行指令（核心）：提交异步任务，前端轮询 /api/commands/:id
app.post('/api/command', commandLimiter, requireRole('operator', 'admin'), (req, res) => {
  const { command, agentId } = req.body || {};
  if (!command || typeof command !== 'string' || command.length > 4000) {
    return res.status(400).json({ ok: false, error: '缺少 command 字段或指令过长' });
  }

  const action = detectAction(command);
  const meta = {
    command,
    agentId: agentId || 'main',
    sessionId: `user-${req.user.id}`,
    userId: req.user.id,
    needsApproval: !!action,
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  };
  const commandId = createCommandJob(meta);
  enqueueCommand(commandId, meta);
  audit(req, 'command_queued', 'command', String(commandId), { needsApproval: !!action });
  res.status(202).json({ ok: true, commandId, status: 'queued' });
});

function commandResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    command: row.command,
    content: row.content,
    error: row.error,
    needsApproval: row.needsApproval,
    approvalId: row.approvalId,
    approval: row.approvalId ? getApproval(row.approvalId) : null,
    run: row.runId ? getAgentRun(row.runId) : null,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

app.get('/api/commands/:id', requireRole('operator', 'admin'), (req, res) => {
  const row = getCommand(Number(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: '命令不存在' });
  if (req.user.role !== 'admin' && row.userId !== req.user.id) return res.status(403).json({ ok: false, error: '权限不足' });
  res.json({ ok: true, data: commandResponse(row) });
});

app.get('/api/commands', requireRole('admin'), (req, res) => {
  const limit = Math.min(200, Math.max(1, +req.query.limit || 50));
  res.json({ ok: true, data: recentCommands(limit).map(commandResponse) });
});


app.get('/api/integrations/feishu', requireRole('operator', 'admin'), (req, res) => {
  res.json({ ok: true, data: feishu.getStatus() });
});

app.post('/api/integrations/feishu/send', requireRole('operator', 'admin'), async (req, res) => {
  const { chatId, text } = req.body || {};
  if (!chatId || !text) return res.status(400).json({ ok: false, error: '缺少 chatId 或 text' });
  try {
    const result = await feishu.sendText(String(chatId), String(text));
    audit(req, 'feishu_send', 'feishu_message', null, { chatId });
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(502).json({ ok: false, error: '飞书发送失败：' + e.message });
  }
});
app.get('/api/agent-runs', requireRole('operator', 'admin'), (req, res) => {
  const limit = Math.min(200, Math.max(1, +req.query.limit || 50));
  const offset = Math.max(0, +req.query.offset || 0);
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim();
  res.json({ ok: true, data: listAgentRuns({ limit, offset, status, search, userId: req.user.id, role: req.user.role }) });
});

app.post('/api/agent-runs/:id/cancel', requireRole('operator', 'admin'), (req, res) => {
  const run = getAgentRun(Number(req.params.id));
  if (!run) return res.status(404).json({ ok: false, error: '\u8fd0\u884c\u4e0d\u5b58\u5728' });
  if (req.user.role !== 'admin' && run.userId != null && run.userId !== req.user.id) return res.status(403).json({ ok: false, error: '\u6743\u9650\u4e0d\u8db3' });
  if (!['queued', 'running'].includes(run.status)) return res.status(400).json({ ok: false, error: '\u4ec5 queued/running \u53ef\u53d6\u6d88' });
  const cancelled = markAgentRunCancelled(run.id, req.user.id, '\u5df2\u7531\u7528\u6237\u53d6\u6d88');
  if (run.context && run.context.agentId != null) updateAgentStatus(run.context.agentId, 'online', '\u5f85\u547d');
  audit(req, 'agent_run_cancel', 'agent_run', String(run.id));
  res.json({ ok: true, data: cancelled });
});

app.post('/api/agent-runs/:id/rerun', requireRole('operator', 'admin'), (req, res) => {
  const run = getAgentRun(Number(req.params.id));
  if (!run) return res.status(404).json({ ok: false, error: 'Agent ?????' });
  if (req.user.role !== 'admin' && run.userId != null && run.userId !== req.user.id) return res.status(403).json({ ok: false, error: '\u6743\u9650\u4e0d\u8db3' });
  const sessionId = run.context && run.context.sessionId ? run.context.sessionId : 'user-' + req.user.id;
  const needsApproval = !!detectAction(run.command);
  const meta = { userId: req.user.id, command: run.command, agentId: run.agentId || 'main', sessionId, needsApproval, ip: req.ip, userAgent: req.get('user-agent') || '' };
  const commandId = createCommandJob(meta);
  enqueueCommand(commandId, meta);
  audit(req, 'agent_run_rerun', 'agent_run', String(run.id), { commandId });
  res.status(202).json({ ok: true, commandId, status: 'queued' });
});

app.get('/api/commands/:id/run', requireRole('operator', 'admin'), (req, res) => {
  const row = getCommand(Number(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: '命令不存在' });
  if (req.user.role !== 'admin' && row.userId !== req.user.id) return res.status(403).json({ ok: false, error: '权限不足' });
  res.json({ ok: true, data: row.runId ? getAgentRun(row.runId) : null });
});

app.get('/api/approvals', requireRole('operator', 'admin'), (req, res) => {
  res.json({ ok: true, data: listApprovals({ userId: req.user.id, role: req.user.role }) });
});

app.post('/api/approvals/:id/decide', requireRole('operator', 'admin'), (req, res) => {
  const { id } = req.params;
  const { decision } = req.body || {};
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ ok: false, error: 'decision 必须是 approve 或 reject' });
  const item = getApproval(id);
  if (!item) return res.status(404).json({ ok: false, error: '审批条目不存在' });
  if (item.status !== 'pending') return res.status(400).json({ ok: false, error: '该审批条目已处理，请刷新审批中心' });
  const updated = decideApprovalDb({ id, decision, userId: req.user.id });
  addActivity({ tag: '审批', color: decision === 'approve' ? '#34d399' : '#fb7185', text: `${decision === 'approve' ? '批准并归档' : '驳回'} #${id}`, userId: req.user.id });
  audit(req, 'approval_decide', 'approval', id, { decision });
  res.json({ ok: true, data: updated });
});

app.post('/api/approvals/:id/execute', requireRole('operator', 'admin'), (req, res) => {
  const { id } = req.params;
  const item = getApproval(id);
  if (!item) return res.status(404).json({ ok: false, error: '审批条目不存在' });
  if (item.status !== 'approved') return res.status(400).json({ ok: false, error: '仅已批准并归档可执行' });
  res.json({ ok: false, executed: false, error: '执行器未接入（Instagram/X/ERP 等平台 API 尚未对接），仅完成审批归档，未真实执行对外动作', data: item });
});

// ---------- 启动与前端托管 ----------
loadKnowledgeBase();
const recoveredCommands = recoverInterruptedCommands();
if (recoveredCommands) console.log(`⚠ 已恢复中断的异步命令：${recoveredCommands} 条标记为失败`);
const recoveredRuns = recoverInterruptedRuns();
try {
  if (feishu.configured()) {
  feishu.startFeishuLongConnection({
    onMessage: async ({ chatId, text }) => {
      if (!chatId || !text) return;
      if (String(text).length > 4000) { try { await feishu.sendText(chatId, "\u6d88\u606f\u8fc7\u957f\uff0c\u8bf7\u7cbe\u7b80\u540e\u91cd\u8bd5"); } catch (_) {} return; }
      if (feishu.isRateLimited(chatId)) { try { await feishu.sendText(chatId, "\u6d88\u606f\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5"); } catch (_) {} return; }
      const meta = {
        userId: null,
        command: String(text),
        agentId: "main",
        sessionId: "feishu:" + chatId,
        needsApproval: !!detectAction(text),
        ip: "feishu",
        userAgent: "feishu-long-connection",
      };
      meta.onComplete = async ({ commandId, status, content, approvalId }) => {
        try {
          if (status === "error") { await feishu.sendText(chatId, "\u5904\u7406\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5"); return; }
          if (approvalId) { await feishu.sendText(chatId, "\u5df2\u751f\u6210\u5ba1\u6279\u8349\u7a3f " + approvalId + "\uff0c\u5f85\u4eba\u5de5\u786e\u8ba4\u540e\u6267\u884c\u3002"); return; }
          await feishu.sendText(chatId, String(content || "").slice(0, 3500));
        } catch (e) { console.error("[feishu] reply error:", e); }
      };
      const commandId = createCommandJob(meta);
      enqueueCommand(commandId, meta);
    },
  });
}
} catch (e) {
  console.error('[feishu] start failed:', e.message);
}

if (recoveredRuns) console.log(`⚠ 已恢复中断的 Agent 运行：${recoveredRuns} 条标记为失败`);
const migrated = migrateApprovalsFromJson(path.join(DATA_DIR, 'approvals.json'));
if (migrated) console.log(`✅ 已迁移 approvals.json 至 SQLite：${migrated} 条`);

app.get('/', (req, res, next) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'), err => err && next()));
app.get('/index.html', (req, res, next) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'), err => err && next()));
app.use(express.static(PUBLIC_DIR, { index: false, dotfiles: 'deny', setHeaders: (res, filePath) => { if (/\.(?:js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache, max-age=0'); } }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'API 不存在' });
  res.status(404).send('Not Found');
});

app.use((err, req, res, next) => {
  if (err && err.message === 'CORS origin denied') return res.status(403).json({ ok: false, error: 'CORS origin denied' });
  console.error('[server] error:', err);
  res.status(500).json({ ok: false, error: '内部错误' });
});

// ---------- lightweight scheduler ----------
const DAILY_DIGEST_MINUTE = Number(process.env.DAILY_DIGEST_MINUTE ?? 9 * 60);
const SCHEDULER_INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS || 60 * 1000);
let lastDigestAt = null;

function startScheduler() {
  setInterval(() => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (lastDigestAt && now - lastDigestAt < 60 * 60 * 1000) return;
    if (Math.abs(minutes - DAILY_DIGEST_MINUTE) <= 1) {
      lastDigestAt = now;
      try {
        const orders = orderStats();
        addActivity({ tag: 'daily', color: '#6366f1', text: 'scheduled digest: orders=' + orders.total + ', pending=' + orders.pending + ', shipped=' + orders.shipped, userId: null });
      } catch (e) { console.error('[scheduler] digest error:', e); }
    }
  }, SCHEDULER_INTERVAL_MS);
  console.log('[scheduler] started, interval=' + SCHEDULER_INTERVAL_MS + 'ms');
}
if (require.main === module) {
  if (process.env.NODE_ENV !== 'test') startScheduler();
  app.listen(PORT, () => {
    console.log(`✅ AI跨境运营平台后端已启动: http://localhost:${PORT}`);
    console.log(`   前端静态目录: ${PUBLIC_DIR}`);
    console.log(`   SQLite 数据库: ${DB_PATH}`);
    console.log(`   Gateway: ${require('./bridge').GATEWAY_URL}`);
    const bridge = require('./bridge');
    console.log(`   直连模型: ${bridge.DIRECT_MODEL}`);
    console.log(`   直连 Provider: ${bridge.PROVIDER.baseUrl || '未配置，使用 Gateway 兜底'}`);
    console.log(`   知识库分块: ${loadKnowledgeBase().length} 块`);
  });
}

module.exports = app;
module.exports.executeAgentCommand = executeAgentCommand;
