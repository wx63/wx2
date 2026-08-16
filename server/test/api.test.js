const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.SESSION_SECRET = 'test-secret-change-me';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'password123';
process.env.ADMIN_NAME = 'Admin';
process.env.ALLOW_REGISTER = 'true';
process.env.OPENCLAW_DIRECT_TIMEOUT_MS = '100';
process.env.OPENCLAW_GATEWAY_TIMEOUT_MS = '100';
process.env.OPENCLAW_PROVIDER_BASE_URL = 'http://127.0.0.1:9';
process.env.OPENCLAW_PROVIDER_API_KEY = 'test-key';
process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:9';
process.env.OPENCLAW_GATEWAY_TOKEN = 'test-token';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-agent-test-'));
process.env.OPENCLAW_DATA_DIR = path.join(tmp, 'data');
process.env.OPENCLAW_DB_PATH = path.join(tmp, 'data', 'app.db');
process.env.OPENCLAW_KB_DIR = path.join(tmp, 'kb');
fs.mkdirSync(process.env.OPENCLAW_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OPENCLAW_KB_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.OPENCLAW_DATA_DIR, 'approvals.json'), JSON.stringify([
  { id: 'AP-TEMP-001', title: '临时迁移审批', command: '仅测试临时数据目录', status: 'pending', createdAt: '2026-08-04T00:00:00.000Z' },
]));
fs.writeFileSync(path.join(process.env.OPENCLAW_KB_DIR, '退换货政策.md'), '# 退换货政策\n\n## 欧盟冷静期\n欧盟消费者享有 14 天冷静期。\n');

const app = require('../index');
const dbmod = require('../db');
const bridge = require('../bridge');
const scheduler = require('../scheduler');
const bcrypt = require('bcryptjs');

function makeServer() {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function cookieFetch(base) {
  let cookie = '';
  return async (url, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.cookie = cookie;
    const resp = await fetch(base + url, { ...options, headers });
    const setCookie = resp.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return resp;
  };
}

function jsonReq(method, body) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) };
}

let ctx;
test.before(async () => {
  ctx = await makeServer();
  dbmod.createUser({ email: 'viewer@example.com', name: 'Viewer', passwordHash: bcrypt.hashSync('password123', 12), role: 'viewer' });
  dbmod.createUser({ email: 'operator@example.com', name: 'Operator', passwordHash: bcrypt.hashSync('password123', 12), role: 'operator' });
});

test.after(() => {
  ctx.server.close();
  try { dbmod.db.close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function loginAs(email) {
  const f = cookieFetch(ctx.base);
  const resp = await f('/api/auth/login', jsonReq('POST', { email, password: 'password123' }));
  assert.equal(resp.status, 200);
  return f;
}

test('login and session cookie', async () => {
  const f = cookieFetch(ctx.base);
  const bad = await f('/api/auth/login', jsonReq('POST', { email: 'admin@example.com', password: 'wrongpass' }));
  assert.equal(bad.status, 401);

  const good = await f('/api/auth/login', jsonReq('POST', { email: 'admin@example.com', password: 'password123' }));
  assert.equal(good.status, 200);
  const body = await good.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.email, 'admin@example.com');
  assert.equal(body.user.password_hash, undefined);

  const me = await f('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, 'admin@example.com');
});

test('remember me extends session cookie max age', async () => {
  const f = cookieFetch(ctx.base);
  const resp = await f('/api/auth/login', jsonReq('POST', { email: 'admin@example.com', password: 'password123', remember: true }));
  assert.equal(resp.status, 200);
  const setCookie = resp.headers.get('set-cookie') || '';
  const expires = setCookie.match(/Expires=([^;]+)/i)?.[1];
  assert.ok(expires, 'remember 登录应返回 Expires');
  const expiresMs = Date.parse(expires);
  const min = Date.now() + 29 * 24 * 60 * 60 * 1000;
  const max = Date.now() + 31 * 24 * 60 * 60 * 1000;
  assert.ok(expiresMs >= min && expiresMs <= max, `remember 会话应约 30 天，实际 ${new Date(expiresMs).toISOString()}`);
});

test('password reset endpoint changes password with valid token', async () => {
  const email = 'reset-flow@example.com';
  dbmod.createUser({ email, name: 'Reset Flow', passwordHash: bcrypt.hashSync('old-password-123', 12), role: 'operator' });
  const token = 'reset-token-' + Date.now();
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  dbmod.createPasswordReset({ email, tokenHash: hash, expiresAt: Date.now() + 30 * 60 * 1000 });

  const reset = await fetch(ctx.base + '/api/auth/reset-password', jsonReq('POST', {
    token,
    password: 'new-password-123',
    confirmPassword: 'new-password-123',
  }));
  assert.equal(reset.status, 200);

  const oldLogin = await fetch(ctx.base + '/api/auth/login', jsonReq('POST', { email, password: 'old-password-123' }));
  assert.equal(oldLogin.status, 401);
  const newLogin = await fetch(ctx.base + '/api/auth/login', jsonReq('POST', { email, password: 'new-password-123' }));
  assert.equal(newLogin.status, 200);

  const reuse = await fetch(ctx.base + '/api/auth/reset-password', jsonReq('POST', {
    token,
    password: 'another-password-123',
    confirmPassword: 'another-password-123',
  }));
  assert.equal(reuse.status, 400);
});

test('public registration creates least-privilege viewer session', async () => {
  const f = cookieFetch(ctx.base);
  const status = await f('/api/auth/register-status');
  assert.equal(status.status, 200);
  assert.equal((await status.json()).data.enabled, true);

  const resp = await f('/api/auth/register', jsonReq('POST', {
    name: 'New User',
    email: 'newuser@example.com',
    password: 'password123',
    confirmPassword: 'password123',
  }));
  assert.equal(resp.status, 201);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.email, 'newuser@example.com');
  assert.equal(body.user.role, 'viewer');
  assert.equal(body.user.password_hash, undefined);

  const dashboard = await f('/api/dashboard');
  assert.equal(dashboard.status, 200);

  const report = await f('/api/reports', jsonReq('POST', { title: 'x' }));
  assert.equal(report.status, 403);
});

test('public registration rejects duplicate email and mismatched passwords', async () => {
  const f = cookieFetch(ctx.base);
  const duplicate = await f('/api/auth/register', jsonReq('POST', {
    email: 'newuser@example.com',
    password: 'password123',
    confirmPassword: 'password123',
  }));
  assert.equal(duplicate.status, 409);

  const mismatch = await f('/api/auth/register', jsonReq('POST', {
    email: 'another@example.com',
    password: 'password123',
    confirmPassword: 'different1',
  }));
  assert.equal(mismatch.status, 400);
});

test('login failure lock returns 429 after repeated failures', async () => {
  const f = cookieFetch(ctx.base);
  const body = { email: 'locked@example.com', password: 'wrongpass' };
  for (let i = 0; i < 5; i++) {
    const resp = await f('/api/auth/login', jsonReq('POST', body));
    assert.equal(resp.status, 401);
  }
  const locked = await f('/api/auth/login', jsonReq('POST', body));
  assert.equal(locked.status, 429);
});

test('permissions for anonymous, viewer, operator, admin', async () => {
  assert.equal((await fetch(ctx.base + '/api/dashboard')).status, 401);

  const viewer = await loginAs('viewer@example.com');
  assert.equal((await viewer('/api/reports', jsonReq('POST', { title: 'x' }))).status, 403);

  const operator = await loginAs('operator@example.com');
  assert.equal((await operator('/api/commands')).status, 403);

  const admin = await loginAs('admin@example.com');
  assert.equal((await admin('/api/commands')).status, 200);
});

test('approval migration uses isolated data directory', () => {
  const migrated = dbmod.getApproval('AP-TEMP-001');
  assert.equal(migrated.title, '临时迁移审批');
  assert.equal(migrated.command, '仅测试临时数据目录');
});


test('approval creation persists linked agent run', () => {
  const runId = dbmod.createAgentRun({ commandId: null, userId: 1, command: 'link approval', agentId: 'main' });
  const ap = dbmod.createApproval({ title: '链接运行审批', command: '发帖', action: 'social_post', draft: 'draft', risk: 'risk', createdBy: 1, runId });
  assert.equal(ap.runId, runId);
});
test('approval lifecycle and execute is archive-only', async () => {
  const operator = await loginAs('operator@example.com');
  const ap = dbmod.createApproval({ title: '测试审批', command: '发帖测试', action: 'social_post', draft: '草稿', risk: '测试', createdBy: 1 });

  const ok = await operator(`/api/approvals/${encodeURIComponent(ap.id)}/decide`, jsonReq('POST', { decision: 'approve' }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.status, 'approved');

  const second = await operator(`/api/approvals/${encodeURIComponent(ap.id)}/decide`, jsonReq('POST', { decision: 'reject' }));
  assert.equal(second.status, 400);

  const exec = await operator(`/api/approvals/${encodeURIComponent(ap.id)}/execute`, { method: 'POST' });
  assert.equal(exec.status, 200);
  const execBody = await exec.json();
  assert.equal(execBody.executed, false);
});

test('approval batch decide processes pending and reports failed ids', async () => {
  const admin = await loginAs('admin@example.com');
  const a = dbmod.createApproval({ title: '批量审批 A', command: '发帖 A', action: 'social_post', draft: 'draft', risk: 'risk', createdBy: 1 });
  const b = dbmod.createApproval({ title: '批量审批 B', command: '发帖 B', action: 'social_post', draft: 'draft', risk: 'risk', createdBy: 1 });
  const done = dbmod.createApproval({ title: '已处理 B', command: '发帖 C', action: 'social_post', draft: 'draft', risk: 'risk', createdBy: 1 });
  dbmod.decideApproval({ id: done.id, decision: 'approve', userId: 1 });

  const resp = await admin('/api/approvals/batch-decide', jsonReq('POST', { ids: [a.id, b.id, done.id, 'AP-MISSING'], decision: 'approve' }));
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.equal(body.processed.length, 2);
  assert.equal(body.failed.length, 2);
  assert.equal(dbmod.getApproval(a.id).status, 'approved');
  assert.equal(dbmod.getApproval(b.id).status, 'approved');
});

test('demo clear endpoint removes only demo rows', async () => {
  const admin = await loginAs('admin@example.com');
  const before = dbmod.listActivity(100);
  const resp = await admin('/api/demo/clear', { method: 'POST' });
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.data.activity, 'number');
  const after = dbmod.listActivity(100);
  assert.ok(after.length <= before.length);
});

test('kb query unmatched path is deterministic', async () => {
  const viewer = await loginAs('viewer@example.com');
  const resp = await viewer('/api/kb-query', jsonReq('POST', { question: 'zzzzzz-unmatched-nonce' }));
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.sources, []);
  assert.match(body.answer, /转人工客服/);
});

test('report saving preserves content', async () => {
  const operator = await loginAs('operator@example.com');
  const saved = await operator('/api/reports', jsonReq('POST', { title: '报告标题', tag: '测试', color: '#6366f1', content: '完整报告正文' }));
  assert.equal(saved.status, 201);

  const listed = await operator('/api/reports');
  assert.equal(listed.status, 200);
  const reports = (await listed.json()).data;
  assert.ok(reports.some(r => r.title === '报告标题' && r.content === '完整报告正文'));
});

test('backend action detection is source of truth', async () => {
  const operator = await loginAs('operator@example.com');
  const approval = await operator('/api/actions/detect', jsonReq('POST', { command: '请为新品发广告草稿' }));
  assert.equal(approval.status, 200);
  const approvalBody = await approval.json();
  assert.equal(approvalBody.data.needsApproval, true);
  assert.equal(approvalBody.data.action, 'social_post');

  const analysis = await operator('/api/actions/detect', jsonReq('POST', { command: '分析昨日订单数据' }));
  assert.equal(analysis.status, 200);
  assert.equal((await analysis.json()).data.needsApproval, false);
});

test('csv export requires auth and restricts viewer', async () => {
  assert.equal((await fetch(ctx.base + '/api/leads/export.csv')).status, 401);
  const viewer = await loginAs('viewer@example.com');
  assert.equal((await viewer('/api/leads/export.csv')).status, 403);
  const admin = await loginAs('admin@example.com');
  const resp = await admin('/api/leads/export.csv');
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-type'), /text\/csv/);
  assert.match(resp.headers.get('content-disposition'), /leads\.csv/);
  const text = await resp.text();
  assert.match(text, /"线索ID","渠道"/);
  assert.match(text, /"状态"/);

});

test('agent step meta persists structured tool metadata', () => {
  const runId = dbmod.createAgentRun({ commandId: null, userId: 1, command: 'meta test', agentId: 'main' });
  dbmod.markAgentRunRunning(runId);
  dbmod.appendAgentStep({ runId, seq: 0, kind: 'tool', label: 'context', tool: 'context', input: 'q', output: 'hit', meta: { hits: 2, sources: ['a', 'b'] }, status: 'running' });
  dbmod.updateAgentStep(runId, 0, { status: 'done', output: 'hit', meta: { hits: 2, sources: ['a', 'b'] }, durationMs: 3 });
  const step = dbmod.getAgentRun(runId).steps[0];
  assert.deepEqual(step.meta, { hits: 2, sources: ['a', 'b'] });
});
test('agent run persistence records real steps', () => {
  const runId = dbmod.createAgentRun({ commandId: null, userId: 1, command: 'Agent test', agentId: 'main' });
  assert.ok(runId > 0);
  dbmod.markAgentRunRunning(runId);
  dbmod.appendAgentStep({ runId, seq: 0, kind: 'plan', label: 'route', tool: 'route', input: 'x', output: '', status: 'running' });
  dbmod.updateAgentStep(runId, 0, { status: 'done', output: 'routed', durationMs: 5 });
  dbmod.appendAgentStep({ runId, seq: 1, kind: 'tool', label: 'kb', tool: 'context', input: 'x', output: 'done', status: 'done' });
  dbmod.finishAgentRun(runId, { status: 'ok', plan: [{ seq: 1 }], result: 'final', durationMs: 10, path: 'agent', model: 'orchestrator' });
  const run = dbmod.getAgentRun(runId);
  assert.equal(run.status, 'ok');
  assert.equal(run.result, 'final');
  assert.equal(run.steps.length, 2);
  assert.equal(run.steps[0].output, 'routed');
});



test('agent run context summary and stats persist', () => {
  const runId = dbmod.createAgentRun({ commandId: null, userId: 1, command: 'context test', agentId: 'main', context: { task: 'context test', route: '运营总监', agentId: 0 } });
  dbmod.markAgentRunRunning(runId);
  dbmod.appendAgentStep({ runId, seq: 0, kind: 'plan', label: 'route', tool: 'route', input: 'x', output: 'routed', status: 'done' });
  dbmod.finishAgentRun(runId, { status: 'ok', plan: [], result: '最终产出', summary: '摘要内容', context: { task: 'context test' }, stats: { steps: 1, tools: 0, retries: 1 }, durationMs: 5, path: 'agent', model: 'orchestrator' });
  const run = dbmod.getAgentRun(runId);
  assert.equal(run.summary, '摘要内容');
  assert.deepEqual(run.context, { task: 'context test' });
  assert.deepEqual(run.stats, { steps: 1, tools: 0, retries: 1 });
});
test('agent command execution persists failed orchestration run', async () => {
  const result = await app.executeAgentCommand({ commandId: null, userId: 1, command: '分析竞品趋势', agentId: 'main', sessionId: 'test-run' });
  assert.equal(result.ok, false);
  const run = dbmod.getAgentRun(result.runId);
  assert.equal(run.status, 'error');
  assert.ok(run.steps.length >= 2);
  assert.ok(run.steps.some(s => s.tool === 'route'));
});

test('agent run admin cancel and rerun endpoints work', async () => {
  const runId = dbmod.createAgentRun({ commandId: null, userId: 1, command: 'cancel rerun test', agentId: 'main', context: { task: 'cancel rerun', agentId: 0 } });
  dbmod.markAgentRunRunning(runId);
  const admin = await loginAs('admin@example.com');
  const cancel = await admin('/api/agent-runs/' + runId + '/cancel', { method: 'POST' });
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).data.status, 'cancelled');
  const rerun = await admin('/api/agent-runs/' + runId + '/rerun', { method: 'POST' });
  assert.equal(rerun.status, 202);
  const rerunBody = await rerun.json();
  assert.ok(rerunBody.commandId > 0);
});

test('agent runs endpoint filters and paginates', async () => {
  const admin = await loginAs('admin@example.com');
  const resp = await admin('/api/agent-runs?limit=5&offset=0&status=ok&search=test');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(typeof body.data.total, 'number');
  assert.ok(Array.isArray(body.data.items));
  assert.equal(body.data.limit, 5);
  assert.equal(body.data.offset, 0);
});


test('local order CRUD and stats endpoint works', async () => {
  const admin = await loginAs('admin@example.com');
  const created = await admin('/api/orders', jsonReq('POST', { orderNo: 'ORD-TEST-001', customerName: 'Test Buyer', product: 'Pet Bottle', qty: 2, amount: 39.8, status: 'pending' }));
  assert.equal(created.status, 201);
  const order = (await created.json()).data;
  assert.equal(order.orderNo, 'ORD-TEST-001');

  const listed = await admin('/api/orders?search=ORD-TEST-001');
  assert.equal(listed.status, 200);
  const listBody = await listed.json();
  assert.ok(listBody.data.items.some(o => o.orderNo === 'ORD-TEST-001'));

  const stats = await admin('/api/orders/stats');
  assert.equal(stats.status, 200);
  const statsBody = await stats.json();
  assert.ok(statsBody.data.total >= 1);
});

test('viewer cannot read order list or stats', async () => {
  const viewer = await loginAs('viewer@example.com');
  assert.equal((await viewer('/api/orders')).status, 403);
  assert.equal((await viewer('/api/orders/stats')).status, 403);
});

test('order status validation rejects invalid status on create and update', async () => {
  const admin = await loginAs('admin@example.com');
  const created = await admin('/api/orders', jsonReq('POST', { orderNo: 'ORD-STATUS-BAD', status: 'not_a_status' }));
  assert.equal(created.status, 400);
  const good = await admin('/api/orders', jsonReq('POST', { orderNo: 'ORD-STATUS-OK', status: 'paid' }));
  assert.equal(good.status, 201);
  const order = (await good.json()).data;
  const patched = await admin('/api/orders/' + order.id, jsonReq('PATCH', { status: 'not_a_status' }));
  assert.equal(patched.status, 400);
});

test('malformed JSON returns 400 and oversized JSON returns 413', async () => {
  const admin = await loginAs('admin@example.com');
  const malformed = await fetch(ctx.base + '/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"title": ',
  });
  assert.equal(malformed.status, 400);
  const oversized = await fetch(ctx.base + '/api/reports', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'x', content: 'a'.repeat(2 * 1024 * 1024 + 1) }),
  });
  assert.equal(oversized.status, 413);
});

test('invalid write payloads return 400 instead of 500', async () => {
  const admin = await loginAs('admin@example.com');
  assert.equal((await admin('/api/reports', jsonReq('POST', { title: 123 }))).status, 400);
  assert.equal((await admin('/api/orders', jsonReq('POST', { orderNo: { bad: true } }))).status, 400);
  assert.equal((await admin('/api/integrations/feishu/send', jsonReq('POST', { chatId: 'c', text: 123 }))).status, 400);
});

test('order id sequence does not reuse deleted order ids', async () => {
  const admin = await loginAs('admin@example.com');
  const a = await admin('/api/orders', jsonReq('POST', { orderNo: 'ORD-SEQ-A' }));
  const b = await admin('/api/orders', jsonReq('POST', { orderNo: 'ORD-SEQ-B' }));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const aBody = (await a.json()).data;
  const bBody = (await b.json()).data;
  assert.ok(aBody.id < bBody.id);
  const del = await admin('/api/orders/' + aBody.id, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const c = await admin('/api/orders', jsonReq('POST', { orderNo: 'ORD-SEQ-C' }));
  assert.equal(c.status, 201);
  const cBody = (await c.json()).data;
  assert.ok(cBody.id > bBody.id);
  const listed = await admin('/api/orders?search=ORD-SEQ-B');
  assert.equal(listed.status, 200);
  const listBody = await listed.json();
  assert.ok(listBody.data.items.some(o => o.id === bBody.id && o.orderNo === 'ORD-SEQ-B'));
});

test('feishu integration status endpoint is available', async () => {
  const admin = await loginAs('admin@example.com');
  const resp = await admin('/api/integrations/feishu');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(typeof body.data.configured, 'boolean');
});

test('agentic fallback path remains compatible', async () => {
  const result = await app.executeAgentCommand({ commandId: null, userId: 1, command: '生成运营报告', agentId: 'main', sessionId: 'test-agentic' });
  assert.equal(result.path, 'agentic_fallback');
  assert.equal(typeof result.ok, 'boolean');
  assert.ok(result.runId > 0);
});

test('agent runs endpoint lists persisted runs', async () => {
  const admin = await loginAs('admin@example.com');
  const resp = await admin('/api/agent-runs');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.ok(Array.isArray(body.data.items));
  assert.ok(body.data.items.length >= 1);
});

// ---------- agentic 成功路径防回归测试（本地 mock 模型服务器，走真实 runAgentTools 循环） ----------

function createMockModelServer(opts = {}) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
          const hasToolResults = Array.isArray(parsed.messages) && parsed.messages.some(m => m.role === 'tool');
          let status = 200;
          let payload;
          if (hasTools && !hasToolResults) {
            payload = { choices: [{ message: { role: 'assistant', content: null, tool_calls: opts.toolCalls } }] };
          } else if (hasTools) {
            payload = { choices: [{ message: { role: 'assistant', content: opts.finalContent || '最终产出' } }] };
          } else if (opts.failPlain) {
            status = 500;
            payload = { error: { message: 'mock 500' } };
          } else {
            payload = { choices: [{ message: { role: 'assistant', content: opts.plainContent || '本地模拟工具输出' } }] };
          }
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: e.message } }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const MOCK_RESEARCH_CALL = { id: 'call_research', type: 'function', function: { name: 'research', arguments: JSON.stringify({ topic: '竞品调研' }) } };
const MOCK_LISTING_CALL = { id: 'call_listing', type: 'function', function: { name: 'listing', arguments: JSON.stringify({ product: '宠物饮水机' }) } };
const MOCK_COMPLIANCE_CALL = { id: 'call_compliance', type: 'function', function: { name: 'compliance', arguments: JSON.stringify({ items: '文案' }) } };

async function withMockModel(run, opts) {
  const { server, port } = await createMockModelServer(opts);
  const originalBase = bridge.PROVIDER.baseUrl;
  bridge.PROVIDER.baseUrl = `http://127.0.0.1:${port}/v1`;
  try {
    return await run();
  } finally {
    bridge.PROVIDER.baseUrl = originalBase;
    server.close();
  }
}

test('agentic toolchain success path persists real tool steps', async () => {
  await withMockModel(async () => {
    const result = await app.executeAgentCommand({ commandId: null, userId: 1, command: '调研竞品写 listing 再做合规审查', agentId: 'main', sessionId: 'test-agentic-ok' });
    assert.equal(result.path, 'agentic');
    assert.equal(result.ok, true);
    assert.equal(result.content, '最终产出');
    const run = dbmod.getAgentRun(result.runId);
    assert.equal(run.status, 'ok');
    const toolSteps = run.steps.filter(s => s.kind === 'tool' && s.meta && s.meta.agentic === true);
    assert.equal(toolSteps.length, 3);
    assert.deepEqual(toolSteps.map(s => s.tool), ['research', 'listing', 'compliance']);
  }, { toolCalls: [MOCK_RESEARCH_CALL, MOCK_LISTING_CALL, MOCK_COMPLIANCE_CALL], finalContent: '最终产出' });
});

test('agentic forced approval draft when model misses approval tool', async () => {
  await withMockModel(async () => {
    const result = await app.executeAgentCommand({ commandId: null, userId: 1, command: '请为新品发广告草稿', agentId: 'main', sessionId: 'test-agentic-approval' });
    assert.equal(result.path, 'agentic');
    assert.equal(result.ok, true);
    const run = dbmod.getAgentRun(result.runId);
    const forced = run.steps.filter(s => s.tool === 'approval_draft');
    assert.equal(forced.length, 1);
    assert.equal(forced[0].meta.forced, true);
    assert.equal(run.status, 'ok');
    assert.match(run.result, /模拟/);
  }, { toolCalls: [MOCK_RESEARCH_CALL], finalContent: '无审批草稿' });
});

test('agentic all-tools-failed falls back to rules pipeline', async () => {
  await withMockModel(async () => {
    const result = await app.executeAgentCommand({ commandId: null, userId: 1, command: '生成运营报告', agentId: 'main', sessionId: 'test-agentic-allfail' });
    assert.equal(result.path, 'agentic_fallback');
    assert.equal(result.ok, false);
    assert.ok(result.runId > 0);
  }, { toolCalls: [MOCK_RESEARCH_CALL], failPlain: true });
});

test('listRecentCommands filters completed commands and respects limit/exclude', () => {
  const sessionId = 'history-limit-' + Date.now();
  const ids = [];
  for (let i = 1; i <= 6; i += 1) {
    ids.push(dbmod.logCommand({
      userId: 1,
      command: `history-${i}`,
      agentId: 'main',
      sessionId,
      status: 'ok',
      content: `result-${i}`,
      durationMs: 1,
    }));
  }
  dbmod.logCommand({ userId: 1, command: 'history-queued', agentId: 'main', sessionId, status: 'queued', content: null });
  dbmod.logCommand({ userId: 2, command: 'history-other-user', agentId: 'main', sessionId, status: 'ok', content: 'other' });
  dbmod.logCommand({ userId: 1, command: 'history-other-session', agentId: 'main', sessionId: sessionId + '-other', status: 'ok', content: 'other' });

  const rows = dbmod.listRecentCommands({ userId: 1, sessionId, limit: 5, excludeId: ids[5] });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => r.command).reverse(), ['history-1', 'history-2', 'history-3', 'history-4', 'history-5']);
  assert.equal(rows.some(r => r.id === ids[5]), false);
  assert.equal(rows.some(r => r.command === 'history-queued'), false);
  assert.equal(rows.some(r => r.command === 'history-other-user'), false);
  assert.equal(rows.some(r => r.command === 'history-other-session'), false);
});

test('production security guard warns on insecure public registration', () => {
  const warnings = [];
  const message = app.checkProductionSecurity({ isProduction: true, allowPublicRegister: true, onWarn: (m) => warnings.push(m) });
  assert.match(message, /生产环境已开启公开注册/);
  assert.equal(warnings.length, 1);
  assert.equal(app.checkProductionSecurity({ isProduction: true, allowPublicRegister: false, onWarn: (m) => warnings.push(m) }), null);
  assert.equal(warnings.length, 1);
});

test('login failure lock persists in database', () => {
  const key = 'persist:' + Date.now();
  for (let i = 0; i < 5; i += 1) {
    dbmod.recordLoginFailure(key, { maxFailures: 5, lockMs: 60000 });
  }
  assert.equal(dbmod.isLoginLocked(key), true);
  dbmod.clearLoginFailures(key);
  assert.equal(dbmod.isLoginLocked(key), false);
});

test('api rules endpoint exposes backend single source rules', async () => {
  const viewer = await loginAs('viewer@example.com');
  const resp = await viewer('/api/rules');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.ok(body.data.routeRules.length >= 5);
  assert.ok(body.data.actionRules.some(r => r.action === 'social_post' && Array.isArray(r.patterns) && r.patterns.length));
});

test('action detection catches paraphrased external actions', async () => {
  const operator = await loginAs('operator@example.com');
  const cases = [
    ['帮我po个动态', 'social_post'],
    ['发个ins', 'social_post'],
    ['更新一下listing', 'listing_submit'],
    ['采购一批', 'purchase'],
    ['退我钱', 'refund'],
  ];
  for (const [command, expected] of cases) {
    const resp = await operator('/api/actions/detect', jsonReq('POST', { command }));
    assert.equal(resp.status, 200, command);
    const data = (await resp.json()).data;
    assert.equal(data.needsApproval, true, command);
    assert.equal(data.action, expected, command);
  }
});

test('approval persistence includes confidence and needs review', () => {
  const ap = dbmod.createApproval({ title: '低置信审批', command: '补货', action: 'purchase', draft: '草稿', risk: '测试', createdBy: 1, confidence: 'low', needsReview: true });
  assert.equal(ap.confidence, 'low');
  assert.equal(ap.needsReview, true);
});

test('approval reminder only lists pending unnotified approvals', () => {
  const pending = dbmod.createApproval({ title: '待提醒审批', command: '发帖', action: 'social_post', draft: '草稿', risk: '测试', createdBy: 1 });
  const alreadyNotified = dbmod.createApproval({ title: '已提醒审批', command: '上架', action: 'listing_submit', draft: '草稿', risk: '测试', createdBy: 1 });
  dbmod.markApprovalNotified(alreadyNotified.id, new Date().toISOString());
  dbmod.decideApproval({ id: pending.id, decision: 'approve', userId: 1 });
  dbmod.markApprovalNotified(pending.id, new Date().toISOString());

  const list = dbmod.listPendingApprovalsUnnotified(20);
  assert.ok(!list.some(a => a.id === pending.id));
  assert.ok(!list.some(a => a.id === alreadyNotified.id));
});

test('approval executor registry exposes adapters and remains archive-only', async () => {
  const admin = await loginAs('admin@example.com');
  const ap = dbmod.createApproval({ title: '执行器注册测试', command: '发帖', action: 'social_post', draft: '草稿', risk: '测试', createdBy: 1 });
  const decided = await admin(`/api/approvals/${encodeURIComponent(ap.id)}/decide`, jsonReq('POST', { decision: 'approve' }));
  assert.equal(decided.status, 200);
  const exec = await admin(`/api/approvals/${encodeURIComponent(ap.id)}/execute`, { method: 'POST' });
  assert.equal(exec.status, 200);
  const body = await exec.json();
  assert.equal(body.executed, false);
  assert.ok(body.adapters.length >= 4);
  assert.ok(body.adapters.some(a => a.name === 'instagram' && a.configured === false));
});

test('scheduler computes exact next run without minute drift', () => {
  const onTime = new Date(2026, 7, 16, 9, 0, 0);
  assert.equal(scheduler.msUntilMinute(9 * 60, onTime), 0);
  const lateStart = new Date(2026, 7, 16, 9, 0, 30);
  assert.equal(scheduler.msUntilMinute(9 * 60, lateStart), 0);
  const afterWindow = new Date(2026, 7, 16, 9, 3, 0);
  assert.ok(scheduler.msUntilMinute(9 * 60, afterWindow) > 0);
  const nextDayTarget = new Date(2026, 7, 17, 9, 0, 0);
  assert.equal(scheduler.msUntilMinute(9 * 60, afterWindow), nextDayTarget.getTime() - afterWindow.getTime());
});

test('SSE events stream requires auth and emits hello', async () => {
  const anon = await fetch(ctx.base + '/api/events');
  assert.equal(anon.status, 401);
  const admin = await loginAs('admin@example.com');
  const resp = await admin('/api/events');
  assert.equal(resp.status, 200);
  assert.match(String(resp.headers.get('content-type')), /text\/event-stream/);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let sawHello = false;
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !sawHello) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    sawHello = text.includes('event: hello');
  }
  await reader.cancel();
  assert.equal(sawHello, true);
});
