// coverage.test.js — 全端点覆盖测试（与 api.test.js 同一套 env/helper 模式）
// 覆盖：health、logout、forgot-password、agents、settings、activity、leads、
// KB（files/retrieve/upload/delete）、orders（patch/delete/list 过滤）、
// dashboard、actions/detect 校验、command 队列全链路、审批中心。
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
process.env.ALLOW_REGISTER = 'true';
process.env.OPENCLAW_DIRECT_TIMEOUT_MS = '100';
process.env.OPENCLAW_GATEWAY_TIMEOUT_MS = '100';
process.env.OPENCLAW_PROVIDER_BASE_URL = 'http://127.0.0.1:9';
process.env.OPENCLAW_PROVIDER_API_KEY = 'test-key';
process.env.OPENCLAW_GATEWAY_URL = 'http://127.0.0.1:9';
process.env.OPENCLAW_GATEWAY_TOKEN = 'test-token';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-coverage-'));
process.env.OPENCLAW_DATA_DIR = path.join(tmp, 'data');
process.env.OPENCLAW_DB_PATH = path.join(tmp, 'data', 'app.db');
process.env.OPENCLAW_KB_DIR = path.join(tmp, 'kb');
fs.mkdirSync(process.env.OPENCLAW_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OPENCLAW_KB_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.OPENCLAW_KB_DIR, '退换货政策.md'), '# 退换货政策\n\n## 欧盟冷静期\n欧盟消费者享有 14 天冷静期，可无条件退货。\n');

const app = require('../index');
const dbmod = require('../db');
const bcrypt = require('bcryptjs');

// 上传接口写入的是项目根目录 知识库（server/routes/kb.js 硬编码），测试用它做上传/删除回环，
// 结束时清理，避免污染真实项目目录。
const PROJECT_KB_DIR = path.join(__dirname, '..', '..', '知识库');

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
  dbmod.createUser({ email: 'operator2@example.com', name: 'Operator2', passwordHash: bcrypt.hashSync('password123', 12), role: 'operator' });
});

test.after(() => {
  ctx.server.close();
  try { dbmod.db.close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function loginAs(email) {
  const f = cookieFetch(ctx.base);
  const resp = await f('/api/auth/login', jsonReq('POST', { email, password: 'password123' }));
  assert.equal(resp.status, 200, `login failed for ${email}`);
  return f;
}

async function waitForCommand(f, commandId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const resp = await f('/api/commands/' + commandId);
    if (resp.status === 200) {
      const body = await resp.json();
      lastStatus = body.data.status;
      if (['done', 'error', 'cancelled'].includes(body.data.status)) return body.data;
    }
    await new Promise(r => setTimeout(r, 40));
  }
  throw new Error(`command ${commandId} did not reach terminal state, last=${lastStatus}`);
}

// ---------- 健康检查 / 会话 ----------

test('health endpoint requires auth and reports service shape', async () => {
  assert.equal((await fetch(ctx.base + '/api/health')).status, 401);
  const admin = await loginAs('admin@example.com');
  const resp = await admin('/api/health');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'ecommerce-agent-server');
  assert.equal(typeof body.model, 'string');
  assert.equal(typeof body.directConfigured, 'boolean');
  assert.equal(typeof body.gatewayConfigured, 'boolean');
});

test('logout destroys session and subsequent requests are unauthorized', async () => {
  const f = await loginAs('viewer@example.com');
  assert.equal((await f('/api/auth/me')).status, 200);
  const out = await f('/api/auth/logout', { method: 'POST' });
  assert.equal(out.status, 200);
  assert.equal((await out.json()).ok, true);
  assert.equal((await f('/api/auth/me')).status, 401);
});

test('forgot-password returns generic message for unknown email', async () => {
  const resp = await fetch(ctx.base + '/api/auth/forgot-password', jsonReq('POST', { email: 'nobody@example.com' }));
  assert.equal(resp.status, 200);
  assert.equal((await resp.json()).ok, true);
});

test('forgot-password returns 502 when SMTP not configured for known email', async () => {
  const resp = await fetch(ctx.base + '/api/auth/forgot-password', jsonReq('POST', { email: 'viewer@example.com' }));
  assert.equal(resp.status, 502);
  const body = await resp.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'SMTP 未配置');
});

// ---------- Agent 管理 ----------

test('agents list exposes all seeded agents with skills', async () => {
  const viewer = await loginAs('viewer@example.com');
  const resp = await viewer('/api/agents');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.ok(Array.isArray(body.data));
  assert.ok(body.data.length >= 5, '至少 5 名数字员工');
  for (const agent of body.data) {
    assert.equal(typeof agent.id, 'number');
    assert.ok(agent.name);
    assert.ok(Array.isArray(agent.skills));
    assert.ok(['online', 'busy', 'offline'].includes(agent.status));
  }
});

test('agent status patch updates and validates', async () => {
  const operator = await loginAs('operator@example.com');
  const list = await (await operator('/api/agents')).json();
  const target = list.data[0];

  const ok = await operator('/api/agents/' + target.id, jsonReq('PATCH', { status: 'busy' }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.status, 'busy');

  const invalid = await operator('/api/agents/' + target.id, jsonReq('PATCH', { status: 'sleeping' }));
  assert.equal(invalid.status, 400);

  const missing = await operator('/api/agents/999999', jsonReq('PATCH', { status: 'online' }));
  assert.equal(missing.status, 404);
});

test('agent skill toggle persists and rejects bad index', async () => {
  const operator = await loginAs('operator@example.com');
  const list = await (await operator('/api/agents')).json();
  const target = list.data[0];
  const skillIdx = 0;

  const resp = await operator(`/api/agents/${target.id}/skills/${skillIdx}`, jsonReq('PATCH', { enabled: false }));
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.data.skills[skillIdx].on, false);

  const bad = await operator(`/api/agents/${target.id}/skills/999`, jsonReq('PATCH', { enabled: true }));
  assert.equal(bad.status, 404);

  // 复原，避免影响其它断言
  await operator(`/api/agents/${target.id}/skills/${skillIdx}`, jsonReq('PATCH', { enabled: true }));
});

test('viewer cannot mutate agents', async () => {
  const viewer = await loginAs('viewer@example.com');
  assert.equal((await viewer('/api/agents/1', jsonReq('PATCH', { status: 'online' }))).status, 403);
  assert.equal((await viewer('/api/agents/1/skills/0', jsonReq('PATCH', { enabled: true }))).status, 403);
});

// ---------- 设置 ----------

test('settings get returns defaults merged for any role', async () => {
  const viewer = await loginAs('viewer@example.com');
  const resp = await viewer('/api/settings');
  assert.equal(resp.status, 200);
  const data = (await resp.json()).data;
  assert.equal(typeof data.feishu_webhook, 'string');
  assert.equal(typeof data.feishu_cmd, 'boolean');
  assert.ok('roas_alert' in data);
});

test('settings patch persists value and rejects unknown key / viewer', async () => {
  const operator = await loginAs('operator@example.com');
  const patched = await operator('/api/settings', jsonReq('PATCH', { key: 'n8n_callback', value: 'https://hook.example.com/flow' }));
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).data.n8n_callback, 'https://hook.example.com/flow');

  const unknown = await operator('/api/settings', jsonReq('PATCH', { key: 'not_a_key', value: 'x' }));
  assert.equal(unknown.status, 400);

  const viewer = await loginAs('viewer@example.com');
  assert.equal((await viewer('/api/settings', jsonReq('PATCH', { key: 'feishu_webhook', value: 'x' }))).status, 403);
});

// ---------- 活动流 ----------

test('activity feed records order change events', async () => {
  const operator = await loginAs('operator@example.com');
  await operator('/api/orders', jsonReq('POST', { orderNo: 'ORD-ACT-001', customerName: 'Activity Buyer', status: 'pending' }));
  const resp = await operator('/api/activity?limit=50');
  assert.equal(resp.status, 200);
  const items = (await resp.json()).data;
  assert.ok(Array.isArray(items));
  assert.ok(items.some(a => a.text && a.text.includes('ORD-ACT-001')), '活动流应包含订单变更事件');
});

// ---------- 线索 ----------

test('leads list grade filter works and viewer is blocked', async () => {
  const operator = await loginAs('operator@example.com');
  const all = await (await operator('/api/leads')).json();
  assert.ok(all.data.length >= 8);

  const hot = await (await operator('/api/leads?grade=hot')).json();
  assert.ok(hot.data.length >= 1);
  assert.ok(hot.data.every(l => l.grade === 'hot'));

  const invalid = await operator('/api/leads?grade=unknown');
  assert.equal(invalid.status, 400);

  const viewer = await loginAs('viewer@example.com');
  assert.equal((await viewer('/api/leads')).status, 403);
});

test('lead promote marks status promoted', async () => {
  const operator = await loginAs('operator@example.com');
  const resp = await operator('/api/leads/L-20260731-01/promote', { method: 'POST' });
  assert.equal(resp.status, 200);
  const data = (await resp.json()).data;
  assert.equal(data.status, 'promoted');

  const missing = await operator('/api/leads/L-DOES-NOT-EXIST/promote', { method: 'POST' });
  assert.equal(missing.status, 404);
});

// ---------- 知识库 ----------

test('kb files list returns shape for any role', async () => {
  const viewer = await loginAs('viewer@example.com');
  const resp = await viewer('/api/kb/files');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.files));
  assert.equal(typeof body.totalChunks, 'number');
});

test('kb retrieve is operator only and returns scored chunks', async () => {
  const viewer = await loginAs('viewer@example.com');
  assert.equal((await viewer('/api/kb/retrieve?q=欧盟')).status, 403);

  const operator = await loginAs('operator@example.com');
  const resp = await operator('/api/kb/retrieve?q=欧盟冷静期&k=3');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.ok(body.chunks.length >= 1, '应命中退换货政策');
  const top = body.chunks[0];
  assert.equal(top.file, '退换货政策.md');
  assert.equal(top.heading, '欧盟冷静期');
  assert.equal(typeof top.score, 'number');
  assert.ok(top.score > 0);
});

test('kb retrieve with empty query returns totals', async () => {
  const operator = await loginAs('operator@example.com');
  const resp = await operator('/api/kb/retrieve');
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.deepEqual(body.chunks, []);
  assert.ok(body.total >= 1);
});

test('kb upload then delete roundtrip cleans up project dir', async () => {
  const operator = await loginAs('operator@example.com');
  const name = `roundtrip-${Date.now()}.md`;
  const form = new FormData();
  form.append('files', new Blob(['# 测试文档\n\n## 章节\n内容。\n'], { type: 'text/markdown' }), name);

  let uploadedName = null;
  try {
    const up = await operator('/api/kb/upload', { method: 'POST', body: form });
    assert.equal(up.status, 200);
    const upBody = await up.json();
    assert.equal(upBody.ok, true);
    assert.equal(upBody.files.length, 1);
    uploadedName = upBody.files[0].name;
    assert.equal(upBody.files[0].originalName, name);
    assert.equal(upBody.files[0].indexed, true);

    const files = await (await operator('/api/kb/files')).json();
    assert.ok(files.files.some(f => f.name === uploadedName), '上传后文件列表应包含新文件');

    const del = await operator('/api/kb/files/' + encodeURIComponent(uploadedName), { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal((await del.json()).ok, true);

    const after = await (await operator('/api/kb/files')).json();
    assert.ok(!after.files.some(f => f.name === uploadedName), '删除后文件列表不应包含该文件');
  } finally {
    const leftover = uploadedName || name;
    fs.rmSync(path.join(PROJECT_KB_DIR, leftover), { force: true });
  }
});

test('kb delete rejects traversal and unsupported extension', async () => {
  const operator = await loginAs('operator@example.com');
  const traversal = await operator('/api/kb/files/' + encodeURIComponent('../evil.md'), { method: 'DELETE' });
  assert.equal(traversal.status, 400);
  const badExt = await operator('/api/kb/files/some.exe', { method: 'DELETE' });
  assert.equal(badExt.status, 400);
  const missing = await operator('/api/kb/files/nonexistent.md', { method: 'DELETE' });
  assert.equal(missing.status, 404);
});

// ---------- 订单 ----------

test('order patch updates fields and returns 404 for missing', async () => {
  const operator = await loginAs('operator@example.com');
  const created = await operator('/api/orders', jsonReq('POST', { orderNo: 'ORD-PATCH-001', customerName: 'Patch Buyer', qty: 1, amount: 9.9 }));
  assert.equal(created.status, 201);
  const order = (await created.json()).data;

  const patched = await operator('/api/orders/' + order.id, jsonReq('PATCH', { status: 'shipped', trackingNo: 'SF-10086', carrier: 'SF' }));
  assert.equal(patched.status, 200);
  const data = (await patched.json()).data;
  assert.equal(data.status, 'shipped');
  assert.equal(data.trackingNo, 'SF-10086');
  assert.equal(data.carrier, 'SF');

  const missing = await operator('/api/orders/99999999', jsonReq('PATCH', { status: 'paid' }));
  assert.equal(missing.status, 404);
});

test('order delete removes order and second delete 404s', async () => {
  const operator = await loginAs('operator@example.com');
  const created = await operator('/api/orders', jsonReq('POST', { orderNo: 'ORD-DEL-001' }));
  const order = (await created.json()).data;

  const del = await operator('/api/orders/' + order.id, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).ok, true);

  const again = await operator('/api/orders/' + order.id, { method: 'DELETE' });
  assert.equal(again.status, 404);

  const listed = await (await operator('/api/orders?search=ORD-DEL-001')).json();
  assert.ok(!listed.data.items.some(o => o.id === order.id));
});

test('order list status filter and limit clamp', async () => {
  const operator = await loginAs('operator@example.com');
  await operator('/api/orders', jsonReq('POST', { orderNo: 'ORD-FILTER-001', status: 'delivered' }));

  const filtered = await (await operator('/api/orders?status=delivered&limit=500')).json();
  assert.ok(filtered.data.items.length >= 1);
  assert.ok(filtered.data.items.every(o => o.status === 'delivered'));

  const clamped = await (await operator('/api/orders?limit=99999')).json();
  assert.equal(clamped.data.limit, 500);
  const floored = await (await operator('/api/orders?limit=-5')).json();
  assert.equal(floored.data.limit, 1);
  const zeroIsMissing = await (await operator('/api/orders?limit=0')).json();
  assert.equal(zeroIsMissing.data.limit, 100);
});

// ---------- 仪表盘 / 动作识别 ----------

test('dashboard aggregates all sections with correct shape', async () => {
  const operator = await loginAs('operator@example.com');
  const resp = await operator('/api/dashboard');
  assert.equal(resp.status, 200);
  const data = (await resp.json()).data;
  assert.ok(Array.isArray(data.agents) && data.agents.length >= 5);
  assert.equal(typeof data.kpis, 'object');
  assert.ok(Array.isArray(data.activity));
  assert.ok(Array.isArray(data.leads));
  assert.ok(Array.isArray(data.reports));
  assert.equal(typeof data.settings, 'object');
  assert.ok(data.runs && typeof data.runs === 'object');
});

test('actions detect rejects missing command', async () => {
  const operator = await loginAs('operator@example.com');
  const resp = await operator('/api/actions/detect', jsonReq('POST', {}));
  assert.equal(resp.status, 400);
});

// ---------- 指令队列全链路 ----------

test('command queue reaches terminal state through HTTP API', async () => {
  const operator = await loginAs('operator@example.com');
  const resp = await operator('/api/command', jsonReq('POST', { command: '生成运营报告' }));
  assert.equal(resp.status, 202);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'queued');
  assert.ok(body.commandId > 0);

  const done = await waitForCommand(operator, body.commandId);
  assert.ok(['done', 'error'].includes(done.status), `expected terminal status, got ${done.status}`);
  assert.equal(done.command, '生成运营报告');
});

test('command validation rejects missing command and viewer', async () => {
  const operator = await loginAs('operator@example.com');
  const bad = await operator('/api/command', jsonReq('POST', {}));
  assert.equal(bad.status, 400);

  const viewer = await loginAs('viewer@example.com');
  assert.equal((await viewer('/api/command', jsonReq('POST', { command: '分析数据' }))).status, 403);
});

test('command ownership enforced between operators', async () => {
  const op1 = await loginAs('operator@example.com');
  const resp = await op1('/api/command', jsonReq('POST', { command: '查看订单情况' }));
  const commandId = (await resp.json()).commandId;

  const op2 = await loginAs('operator2@example.com');
  const denied = await op2('/api/commands/' + commandId);
  assert.equal(denied.status, 403);

  const admin = await loginAs('admin@example.com');
  const allowed = await admin('/api/commands/' + commandId);
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).data.command, '查看订单情况');
});

test('commands list endpoint is admin only', async () => {
  const operator = await loginAs('operator@example.com');
  assert.equal((await operator('/api/commands')).status, 403);

  const admin = await loginAs('admin@example.com');
  const resp = await admin('/api/commands?limit=5');
  assert.equal(resp.status, 200);
  assert.ok(Array.isArray((await resp.json()).data));
});

test('command run endpoint returns run data or null', async () => {
  const operator = await loginAs('operator@example.com');
  const resp = await operator('/api/command', jsonReq('POST', { command: '生成周报' }));
  const commandId = (await resp.json()).commandId;
  await waitForCommand(operator, commandId);

  const run = await operator('/api/commands/' + commandId + '/run');
  assert.equal(run.status, 200);
  const body = await run.json();
  assert.equal(body.ok, true);
  assert.ok(body.data === null || typeof body.data === 'object');

  const missing = await operator('/api/commands/99999999/run');
  assert.equal(missing.status, 404);
});

// ---------- 审批中心 ----------

test('approvals list is operator only and decide validates decision', async () => {
  const viewer = await loginAs('viewer@example.com');
  assert.equal((await viewer('/api/approvals')).status, 403);

  const operator = await loginAs('operator@example.com');
  const list = await (await operator('/api/approvals')).json();
  assert.ok(Array.isArray(list.data));

  const ap = dbmod.createApproval({ title: '覆盖测试审批', command: '发帖', action: 'social_post', draft: '草稿', risk: '测试', createdBy: 1 });
  const badDecision = await operator(`/api/approvals/${ap.id}/decide`, jsonReq('POST', { decision: 'maybe' }));
  assert.equal(badDecision.status, 400);

  const missing = await operator('/api/approvals/AP-NOT-FOUND/decide', jsonReq('POST', { decision: 'approve' }));
  assert.equal(missing.status, 404);

  const executeBeforeApprove = await operator(`/api/approvals/${ap.id}/execute`, { method: 'POST' });
  assert.equal(executeBeforeApprove.status, 400);
});
