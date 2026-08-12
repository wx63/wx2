const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.SESSION_SECRET = 'test-secret-change-me';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'password123';
process.env.ADMIN_NAME = 'Admin';
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

test('feishu integration status endpoint is available', async () => {
  const admin = await loginAs('admin@example.com');
  const resp = await admin('/api/integrations/feishu');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(typeof body.data.configured, 'boolean');
});

test('agentic fallback path remains compatible', async () => {
  const result = await app.executeAgentCommand({ commandId: null, userId: 1, command: '??????', agentId: 'main', sessionId: 'test-agentic' });
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
