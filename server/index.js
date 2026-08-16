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
const { runAgentTools } = require('./bridge');
const { detectAction, getPublicRules } = require('./rules');
const { loadKnowledgeBase, retrieve, answer, fileStats } = require('./kb');
const feishu = require('./feishu');
const events = require('./events');
const { createRequestLogger } = require('./request-logger');
const { executeApproval, listExecutors } = require('./executors');
const { startScheduler } = require('./scheduler');
const { routeCommand, isPriceLookupCommand, buildAgentPlan, summarizePlan, extractSummary, agenticPreloadContext } = require('./planner');
const { AGENT_TOOL_DEFS, TOOL_SCHEMAS } = require('./tools');
const { runPlannedStep, truncateText } = require('./tools/runtime');
const { createApiRouter } = require('./routes');
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
  recordLoginFailure: recordLoginFailureDb,
  isLoginLocked: isLoginLockedDb,
  clearLoginFailures: clearLoginFailuresDb,
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
const allowPublicRegister = process.env.ALLOW_REGISTER === 'true' || (process.env.NODE_ENV !== 'production' && process.env.ALLOW_REGISTER !== 'false');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_SECRET = process.env.SESSION_SECRET || (isProduction ? '' : 'dev-only-change-me');
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === 'true' ? true : process.env.SESSION_COOKIE_SECURE === 'false' ? false : 'auto';

if (isProduction && (!SESSION_SECRET || SESSION_SECRET === 'replace-me' || SESSION_SECRET === 'dev-only-change-me')) {
  throw new Error('生产环境必须设置强 SESSION_SECRET，且不能使用 replace-me');
}
if (!isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'replace-me')) {
  console.warn('⚠ SESSION_SECRET 未配置或仍为 replace-me；开发环境使用临时密钥，生产环境会拒绝启动。');
}
if (isProduction) app.set('trust proxy', 1);

function checkProductionSecurity({ isProduction: productionMode, allowPublicRegister: registerAllowed, onWarn } = {}) {
  if (!productionMode || !registerAllowed) return null;
  const message = '⚠ 生产环境已开启公开注册，任何人可注册 viewer 账号看到运营数据；公网暴露前请设置 ALLOW_REGISTER=false。';
  const warn = typeof onWarn === 'function' ? onWarn : console.warn;
  warn(message);
  try {
    logAudit({ action: 'insecure_production', metadata: { allowRegister: true, message } });
  } catch (_) {}
  return message;
}
checkProductionSecurity({ isProduction, allowPublicRegister });

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
    secure: sessionCookieSecure,
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

const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

function loginFailureKey(ip, email) {
  return `${ip}:${email}`;
}

function isLoginLocked(key) {
  return isLoginLockedDb(key);
}

function recordLoginFailure(key) {
  return recordLoginFailureDb(key, { maxFailures: LOGIN_MAX_FAILURES, lockMs: LOGIN_LOCK_MS });
}

function clearLoginFailures(key) {
  return clearLoginFailuresDb(key);
}

function validateEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStringField(value, max = 4000) {
  return typeof value === 'string' && value.length <= max;
}

function rejectInvalid(req, res, field, error = '字段类型或长度不正确') {
  audit(req, 'invalid_payload', 'request', null, { field });
  return res.status(400).json({ ok: false, error });
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
app.use(createRequestLogger({ logAudit }));
app.use(sameOriginWriteGuard);
app.use(createApiRouter({ allowPublicRegister, enqueueCommand }));

async function runAgenticCommand(meta) {
  const command = String(meta.command || '');
  const runId = meta.runId;
  const startedAt = Date.now();
  const stats = { steps: 0, tools: 0, retries: 0, failedSteps: 0 };
  const kbContext = agenticPreloadContext(command);
  const priceHint = isPriceLookupCommand(command) ? '\n\n[工具提示] 这是实时价格查询，请调用 price_lookup 工具，不要只凭模型记忆回答。\n' : '';
  const prompt = `${command}\n\n${kbContext ? '知识库上下文：\n' + kbContext + '\n\n' : ''}${priceHint}`.trim();
  const maxRounds = Math.max(1, Math.min(12, Number(process.env.AGENT_MAX_ROUNDS || 8)));
  const result = await runAgentTools(prompt, TOOL_SCHEMAS, {
    maxRounds,
    sessionId: meta.sessionId,
    onDelta: (delta) => {
      if (typeof meta.onDelta === 'function') meta.onDelta(delta);
    },
    executor: async (name, args) => {
      const def = AGENT_TOOL_DEFS.find(d => d.name === name);
      if (!def) return { output: '未知工具: ' + name };
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
    return { ok: false, error: '所有工具调用失败，已回退规则管道', _fallbackable: true, stats };
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
  if (isPriceLookupCommand(command) && !(result.steps || []).some(s => s.tool === 'price_lookup')) {
    const def = AGENT_TOOL_DEFS.find(d => d.name === 'price_lookup');
    const forced = def ? await def.handler({ query: command }, meta) : { output: '' };
    const seq = stats.steps;
    appendAgentStep({
      runId, seq, kind: 'tool', label: 'price_lookup', tool: 'price_lookup',
      args: { query: command }, input: command, output: truncateText(forced.output || '', 20000),
      meta: { agentic: true, forced: true }, status: 'done', durationMs: 0,
    });
    stats.steps += 1;
    stats.tools += 1;
    result.steps.push({ tool: 'price_lookup', args: { query: command }, output: forced.output, error: '' });
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
  return { ok: true, runId, content: result.content, action: detectAction(command), steps: stats.steps, route: meta.routeName, routeAgent: meta.routeAgent, model: result.model, path: 'agentic', stats, usage: result.usage || {} };
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
  const notify = (payload) => {
    if (typeof meta.onComplete !== 'function') return;
    setImmediate(() => {
      try {
        const result = meta.onComplete(payload);
        if (result && typeof result.then === 'function') result.catch(e => console.error('[command-job] callback error:', e));
      } catch (e) {
        console.error('[command-job] callback error:', e);
      }
    });
  };
  markCommandRunning(commandId);
  const startedAt = Date.now();
  const action = detectAction(meta.command);
  try {
    const result = await executeAgentCommand({ ...meta, commandId });
    const jobMeta = { path: 'agent', model: 'orchestrator' };
    jobMeta.durationMs = Date.now() - startedAt;
    jobMeta.contentLen = (result.content || '').length;
    jobMeta.needsApproval = !!action;
    if (jobMeta.durationMs >= 20000 || result.path === 'agentic_fallback') {
      logAudit({ userId: meta.userId, action: 'slow_command', entityType: 'command', entityId: String(commandId), metadata: { path: result.path || 'agent', durationMs: jobMeta.durationMs, needsApproval: !!action }, ip: meta.ip, userAgent: meta.userAgent });
    }
    const usage = result.usage || {};
    jobMeta.promptTokens = usage.prompt_tokens != null ? usage.prompt_tokens : null;
    jobMeta.completionTokens = usage.completion_tokens != null ? usage.completion_tokens : null;
    jobMeta.promptCacheHitTokens = usage.prompt_cache_hit_tokens != null ? usage.prompt_cache_hit_tokens : null;
    jobMeta.promptCacheMissTokens = usage.prompt_cache_miss_tokens != null ? usage.prompt_cache_miss_tokens : null;

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
        confidence: action.confidence,
        needsReview: action.needsReview,
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
    events.publish('command', { commandId, status: 'ok', route: result.route, approvalId: approval && approval.id });
    logAudit({ userId: meta.userId, action: 'command_run', entityType: 'command', entityId: String(commandId), metadata: { needsApproval: !!action, approvalId: approval && approval.id }, ip: meta.ip, userAgent: meta.userAgent });
    notify({ commandId, status: 'ok', command: meta.command, content: result.content, approvalId: approval && approval.id, approval: approval ? getApproval(approval.id) : null, route: result.route });
  } catch (e) {
    console.error('[command-job] error:', e);
    finishCommandJob(commandId, { status: 'error', durationMs: Date.now() - startedAt, error: '内部错误', needsApproval: !!action });
    events.publish('command', { commandId, status: 'error' });
    notify({ commandId, status: 'error', error: '\u5185\u90e8\u9519\u8bef' });
  }
}

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
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[server] error:', err);
  const msg = status >= 500 ? '内部错误'
    : err.type === 'entity.parse.failed' ? '请求体 JSON 格式错误'
    : err.type === 'entity.too.large' ? '请求体过大'
    : '请求无效';
  res.status(status).json({ ok: false, error: msg });
});

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
module.exports.checkProductionSecurity = checkProductionSecurity;
