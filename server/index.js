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
const { runAgent, detectAction } = require('./bridge');
const { loadKnowledgeBase, retrieve, answer, fileStats } = require('./kb');
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
  markCommandRunning,
  finishCommandJob,
  recoverInterruptedCommands,
  recentCommands,
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

app.use(helmet({ contentSecurityPolicy: false }));
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
  rolling: true,
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
  markCommandRunning(commandId);
  const startedAt = Date.now();
  const action = detectAction(meta.command);
  try {
    const result = await runAgent(meta.command, { agentId: meta.agentId, sessionId: meta.sessionId });
    const jobMeta = { ...(result._meta || { path: 'unknown' }) };
    jobMeta.durationMs = Date.now() - startedAt;
    jobMeta.contentLen = (result.content || '').length;
    jobMeta.needsApproval = !!action;

    if (!result.ok) {
      jobMeta.status = 'error';
      jobMeta.error = result.error || '执行失败';
      finishCommandJob(commandId, jobMeta);
      logAudit({ userId: meta.userId, action: 'command_error', entityType: 'command', entityId: String(commandId), metadata: { path: jobMeta.path, error: jobMeta.error }, ip: meta.ip, userAgent: meta.userAgent });
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
      });
      jobMeta.approvalId = approval.id;
    }

    jobMeta.status = 'ok';
    jobMeta.content = result.content;
    jobMeta.error = null;
    finishCommandJob(commandId, jobMeta);
    addActivity({ tag: action ? '审批' : '指令', color: action ? '#fbbf24' : '#6366f1', text: action ? `生成审批条目 ${approval.id}：${approval.title}` : `完成指令：${meta.command.slice(0, 30)}`, userId: meta.userId });
    logAudit({ userId: meta.userId, action: 'command_run', entityType: 'command', entityId: String(commandId), metadata: { needsApproval: !!action, approvalId: approval && approval.id }, ip: meta.ip, userAgent: meta.userAgent });
  } catch (e) {
    console.error('[command-job] error:', e);
    finishCommandJob(commandId, { status: 'error', durationMs: Date.now() - startedAt, error: '内部错误', needsApproval: !!action });
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
app.get('/api/health', (req, res) => {
  const bridge = require('./bridge');
  res.json({
    ok: true,
    service: 'ecommerce-agent-server',
    time: new Date().toISOString(),
    model: bridge.DIRECT_MODEL,
    providerBaseUrl: bridge.PROVIDER.baseUrl || null,
    directConfigured: !!(bridge.PROVIDER.baseUrl && bridge.PROVIDER.apiKey),
    gatewayUrl: bridge.GATEWAY_URL,
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
  if (!user || user.status !== 'active' || typeof password !== 'string') {
    logAudit({ action: 'login_failed', metadata: { email: normalizedEmail }, ...requestMeta(req) });
    return res.status(401).json({ ok: false, error: '邮箱或密码错误' });
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
  res.json({ ok: true, data: getDashboard(req.user.id) });
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

app.get('/api/activity', (req, res) => {
  const limit = Math.min(100, Math.max(1, +req.query.limit || 30));
  res.json({ ok: true, data: listActivity(limit) });
});

app.get('/api/leads', (req, res) => {
  const grade = String(req.query.grade || 'all');
  if (!['all', 'hot', 'warm', 'cold'].includes(grade)) return res.status(400).json({ ok: false, error: '非法线索分级' });
  res.json({ ok: true, data: listLeads(grade) });
});
app.get('/api/leads/export.csv', (req, res) => {
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

app.get('/api/approvals', (req, res) => {
  res.json({ ok: true, data: listApprovals() });
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
const migrated = migrateApprovalsFromJson(path.join(DATA_DIR, 'approvals.json'));
if (migrated) console.log(`✅ 已迁移 approvals.json 至 SQLite：${migrated} 条`);

app.get('/', (req, res, next) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'), err => err && next()));
app.get('/index.html', (req, res, next) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'), err => err && next()));
app.use(express.static(PUBLIC_DIR, { index: false, dotfiles: 'deny' }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'API 不存在' });
  res.status(404).send('Not Found');
});

app.use((err, req, res, next) => {
  if (err && err.message === 'CORS origin denied') return res.status(403).json({ ok: false, error: 'CORS origin denied' });
  console.error('[server] error:', err);
  res.status(500).json({ ok: false, error: '内部错误' });
});

if (require.main === module) {
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
