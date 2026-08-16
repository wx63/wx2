// e2e-live.test.js — 端到端验证：真实 Express 服务 + 临时 SQLite + 本地 mock 模型
//
// 原则：
//  - 启动一个独立实例（PORT=3121），数据落在系统临时目录，绝不触碰真实 data/app.db 与 .env。
//  - 用本地 loopback mock 模型服务器替代真实 LLM 调用，命令管道全程确定性执行。
//  - 覆盖关键用户旅程：认证、仪表盘、Agent、指令（SSE 与非 SSE）、审批、线索、
//    运行记录（过滤/分页/取消/重跑）、订单（CRUD/过滤/搜索/统计）、知识库只读、设置、报告、权限与 CSRF 守卫。
// 运行：cd server && node --test --test-concurrency=1 test/e2e-live.test.js

process.env.NODE_ENV = 'test'; // 跳过 dotenv/真实密钥、跳过 scheduler、限流放大、listen 由测试接管
process.env.PORT = '3121';
process.env.SESSION_SECRET = 'e2e-session-secret';
process.env.ADMIN_EMAIL = 'admin@e2e.local';
process.env.ADMIN_PASSWORD = 'e2e-admin-pass-123';
process.env.ALLOW_REGISTER = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-e2e-'));
process.env.OPENCLAW_DATA_DIR = path.join(tmp, 'data');
process.env.OPENCLAW_DB_PATH = path.join(tmp, 'data', 'app.db');
process.env.OPENCLAW_KB_DIR = path.join(tmp, 'kb'); // RAG 索引指向临时目录
fs.mkdirSync(process.env.OPENCLAW_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OPENCLAW_KB_DIR, { recursive: true });

const app = require('../index');
const bridge = require('../bridge');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ---------- 本地 mock 模型服务器（可 hold 单个请求用于“取消运行”测试） ----------
function createMockModelServer() {
  const held = [];
  let holdNext = false;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
        const hasToolResults = Array.isArray(parsed.messages) && parsed.messages.some(m => m.role === 'tool');
        let payload;
        if (holdNext) {
          holdNext = false;
          held.push(res);
          return; // 挂起，等待 release()
        }
        if (hasTools && !hasToolResults) {
          payload = { choices: [{ message: { role: 'assistant', content: null, tool_calls: MOCK_TOOL_CALLS } }] };
        } else if (hasTools) {
          payload = { choices: [{ message: { role: 'assistant', content: '最终产出（mock）' } }] };
        } else {
          payload = { choices: [{ message: { role: 'assistant', content: '本地模拟工具输出' } }] };
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
    });
  });
  return {
    server,
    start: () => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    close: () => new Promise(r => {
      releaseHeld();
      server.close(r);
    }),
    holdNext: () => { holdNext = true; },
    releaseHeld: releaseHeld,
  };

  function releaseHeld() {
    for (const res of held) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '本地模拟工具输出' } }] }));
    }
    held.length = 0;
  }
}

const MOCK_TOOL_CALLS = [
  { id: 'call_research', type: 'function', function: { name: 'research', arguments: JSON.stringify({ topic: '竞品调研' }) } },
  { id: 'call_listing', type: 'function', function: { name: 'listing', arguments: JSON.stringify({ product: '宠物饮水机' }) } },
  { id: 'call_compliance', type: 'function', function: { name: 'compliance', arguments: JSON.stringify({ items: '文案' }) } },
];

// ---------- HTTP 会话（带 cookie 管理） ----------
class Session {
  constructor() { this.cookie = ''; }
  async req(pathname, opts = {}) {
    const { method = 'GET', body, headers = {}, cookie } = opts;
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const cookieToUse = cookie !== undefined ? cookie : this.cookie;
    if (cookieToUse) h['Cookie'] = cookieToUse;
    const resp = await fetch(BASE + pathname, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookies = typeof resp.headers.getSetCookie === 'function'
      ? resp.headers.getSetCookie()
      : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie')] : []);
    const oc = setCookies.map(c => c.split(';')[0]).find(c => c.startsWith('oc.sid='));
    if (oc) this.cookie = oc;
    return resp;
  }
  async json(pathname, opts) {
    const resp = await this.req(pathname, opts);
    const body = await resp.json().catch(() => null);
    return { resp, body };
  }
}

const admin = new Session();
const viewer = new Session();

async function pollCommand(id, { timeout = 10000 } = {}) {
  const start = Date.now();
  for (;;) {
    const { resp, body } = await admin.json(`/api/commands/${id}`);
    assert.equal(resp.status, 200, `poll command ${id} 应 200`);
    if (body && body.ok && body.data && !['queued', 'running'].includes(body.data.status)) return body.data;
    if (Date.now() - start > timeout) throw new Error(`命令 ${id} 超时未完成：${body && body.data && body.data.status}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 启动 ----------
test('启动 E2E 服务（临时 DB + mock 模型）', async () => {
  const mockPort = await mockModel.start();
  bridge.PROVIDER.baseUrl = `http://127.0.0.1:${mockPort}`;
  bridge.PROVIDER.apiKey = 'e2e-mock-key';
  await new Promise((resolve, reject) => {
    appServer = app.listen(Number(process.env.PORT), '127.0.0.1', () => resolve());
    appServer.once('error', reject);
  });
  // 服务已监听：/api/* 全局 requireAuth（routes/index.js），未登录访问健康检查 → 401
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 401);
  const hb = await health.json();
  assert.equal(hb.ok, false);
});

// ---------- 认证 ----------
test('未登录访问受保护接口 → 401 请先登录', async () => {
  const { resp } = await new Session().json('/api/agents');
  assert.equal(resp.status, 401);
});

test('健康检查需登录（/api/* 全局认证）', async () => {
  const { resp, body } = await new Session().json('/api/health');
  assert.equal(resp.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error, '请先登录');
});

test('密码错误 → 401', async () => {
  const { resp, body } = await admin.json('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: 'wrong-password' } });
  assert.equal(resp.status, 401);
  assert.match(body.error, /邮箱或密码错误/);
});

test('管理员登录成功并取得会话', async () => {
  const { resp, body } = await admin.json('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(resp.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.user.role, 'admin');
  assert.ok(admin.cookie.includes('oc.sid='), '应获得 oc.sid cookie');
  const me = await admin.json('/api/auth/me');
  assert.equal(me.body.user.email, ADMIN_EMAIL);

  // 登录后健康检查 → 200，模型/网关配置字段齐全
  const health = await admin.json('/api/health');
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, 'ecommerce-agent-server');
  assert.equal(health.body.directConfigured, true);
});

test('公开注册 viewer 并可登录', async () => {
  const { resp, body } = await viewer.json('/api/auth/register', {
    method: 'POST',
    body: { name: 'E2E Viewer', email: 'viewer@e2e.local', password: 'viewer-pass-123', confirmPassword: 'viewer-pass-123' },
  });
  assert.equal(resp.status, 201);
  assert.equal(body.user.role, 'viewer');
  const me = await viewer.json('/api/auth/me');
  assert.equal(me.body.user.email, 'viewer@e2e.local');
});

test('重复注册邮箱 → 409', async () => {
  const { resp } = await viewer.json('/api/auth/register', {
    method: 'POST',
    body: { name: 'dup', email: 'viewer@e2e.local', password: 'viewer-pass-123', confirmPassword: 'viewer-pass-123' },
  });
  assert.equal(resp.status, 409);
});

test('viewer 无权限访问订单/运行/审批 → 403', async () => {
  for (const p of ['/api/orders', '/api/agent-runs', '/api/approvals']) {
    const { resp, body } = await viewer.json(p);
    assert.equal(resp.status, 403, `${p} 应 403，实际 ${resp.status}`);
    assert.match(body.error, /权限不足/);
  }
});

test('viewer 可读取 settings/agents/报告（只读域）', async () => {
  for (const p of ['/api/settings', '/api/agents', '/api/reports']) {
    const { resp } = await viewer.json(p);
    assert.equal(resp.status, 200, `${p} 应 200`);
  }
});

test('登出后 /api/auth/me → 401', async () => {
  const { resp } = await viewer.json('/api/auth/logout', { method: 'POST' });
  assert.equal(resp.status, 200);
  const me = await viewer.json('/api/auth/me');
  assert.equal(me.resp.status, 401);
});

// ---------- 仪表盘 / Agent ----------
test('仪表盘聚合数据齐全', async () => {
  const { resp, body } = await admin.json('/api/dashboard');
  assert.equal(resp.status, 200);
  assert.ok(Array.isArray(body.data.agents) && body.data.agents.length >= 5);
  assert.ok(Array.isArray(body.data.kpis) && body.data.kpis.length >= 4);
  assert.ok(Array.isArray(body.data.leads) && body.data.leads.length >= 8);
  assert.equal(typeof body.data.settings, 'object');
});

test('Agent 列表与状态/技能切换', async () => {
  const list = await admin.json('/api/agents');
  assert.equal(list.body.data.length, 5);

  // 状态切换 offline → online
  const off = await admin.json('/api/agents/0', { method: 'PATCH', body: { status: 'offline' } });
  assert.equal(off.body.data.status, 'offline');
  const on = await admin.json('/api/agents/0', { method: 'PATCH', body: { status: 'online' } });
  assert.equal(on.body.data.status, 'online');

  // 非法状态 → 400
  const bad = await admin.json('/api/agents/0', { method: 'PATCH', body: { status: 'nope' } });
  assert.equal(bad.resp.status, 400);

  // 技能开关：读取 agent0 首个技能原名 → 关闭 → 开启
  const a0 = list.body.data.find(a => a.id === 0);
  const skill0Name = a0.skills[0].name;
  const offSkill = await admin.json('/api/agents/0/skills/0', { method: 'PATCH', body: { enabled: false } });
  assert.equal(offSkill.body.data.skills[0].on, false);
  const onSkill = await admin.json('/api/agents/0/skills/0', { method: 'PATCH', body: { enabled: true } });
  assert.equal(onSkill.body.data.skills[0].on, true);
  assert.equal(onSkill.body.data.skills[0].name, skill0Name);
});

test('规则与动作识别端点', async () => {
  const rules = await admin.json('/api/rules');
  assert.ok(Array.isArray(rules.body.data.routeRules));
  assert.ok(Array.isArray(rules.body.data.actionRules));

  const act = await admin.json('/api/actions/detect', { method: 'POST', body: { command: '请为新品发广告' } });
  assert.equal(act.body.data.needsApproval, true);
  assert.equal(act.body.data.action, 'social_post');

  const noAct = await admin.json('/api/actions/detect', { method: 'POST', body: { command: '查一下汇率' } });
  assert.equal(noAct.body.data.needsApproval, false);
});

// ---------- 指令执行（SSE + 非 SSE） ----------
test('指令（非流式 202）→ 队列 → 完成并生成报告', async () => {
  const { resp, body } = await admin.json('/api/command', { method: 'POST', body: { command: '调研竞品写 listing 再做合规审查' } });
  assert.equal(resp.status, 202);
  assert.equal(body.ok, true);
  assert.equal(body.status, 'queued');
  const cmd = await pollCommand(body.commandId);
  assert.equal(cmd.status, 'ok');
  assert.ok(cmd.run && cmd.run.id > 0, '应关联 agent run');
  assert.ok(Array.isArray(cmd.run.steps) && cmd.run.steps.length >= 3, '应产生 research/listing/compliance 步骤');
  const runResp = await admin.json(`/api/commands/${body.commandId}/run`);
  assert.equal(runResp.body.data.id, cmd.run.id);
});

test('指令（流式 SSE）→ accepted/complete/done 事件', async () => {
  const resp = await admin.req('/api/command', { method: 'POST', body: { command: '生成运营报告', stream: true } });
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-type'), /text\/event-stream/);
  const events = [];
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let done = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !done) {
    const { value, done: d } = await reader.read();
    if (d) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const evt = /^event:\s*(.+)$/m.exec(block);
      const data = /^data:\s*(.+)$/m.exec(block);
      if (evt && data) {
        events.push({ event: evt[1], data: JSON.parse(data[1]) });
        if (evt[1] === 'done') { done = true; break; }
      }
    }
  }
  if (!done) reader.cancel().catch(() => {});
  const names = events.map(e => e.event);
  assert.ok(names.includes('accepted'), `应有 accepted，实际 ${names}`);
  assert.ok(names.includes('complete'), `应有 complete，实际 ${names}`);
  assert.ok(names.includes('done'), `应有 done，实际 ${names}`);
  const complete = events.find(e => e.event === 'complete');
  assert.equal(complete.data.status, 'ok');
  assert.ok(complete.data.commandId > 0);
});

test('对外动作指令 → 生成审批草稿（批准只归档，不真实执行）', async () => {
  const { body } = await admin.json('/api/command', { method: 'POST', body: { command: '请为新品发广告草稿' } });
  assert.equal(body.status, 'queued');
  const cmd = await pollCommand(body.commandId);
  assert.equal(cmd.status, 'ok');
  assert.equal(cmd.needsApproval, true);
  assert.ok(cmd.approvalId, '应生成审批条目');
  assert.equal(cmd.approval.status, 'pending');
  assert.equal(cmd.approval.action, 'social_post');
  ctx.approvalId = cmd.approvalId;

  // 批准 → 归档（状态 approved，已决策）
  const decide = await admin.json(`/api/approvals/${ctx.approvalId}/decide`, { method: 'POST', body: { decision: 'approve' } });
  assert.equal(decide.body.data.status, 'approved');
  assert.ok(decide.body.data.decidedAt);

  // 执行端点：仅归档、不真实执行平台动作（安全约束）
  const exec = await admin.json(`/api/approvals/${ctx.approvalId}/execute`, { method: 'POST' });
  assert.equal(exec.body.ok, false);
  assert.equal(exec.body.executed, false);
  assert.ok(exec.body.error, '应返回不执行的说明');
  assert.ok(Array.isArray(exec.body.adapters));

  // 重复决策 → 400
  const again = await admin.json(`/api/approvals/${ctx.approvalId}/decide`, { method: 'POST', body: { decision: 'reject' } });
  assert.equal(again.resp.status, 400);
});

test('审批列表包含已决策条目；非法 decision → 400', async () => {
  const list = await admin.json('/api/approvals');
  assert.ok(list.body.data.some(a => a.id === ctx.approvalId && a.status === 'approved'));
  const bad = await admin.json(`/api/approvals/${ctx.approvalId}/decide`, { method: 'POST', body: { decision: 'maybe' } });
  assert.equal(bad.resp.status, 400);
});

// ---------- 订单 CRUD / 过滤 / 搜索 / 统计 ----------
test('订单创建、过滤、搜索、更新、统计、删除全链路', async () => {
  // 初始为空
  const empty = await admin.json('/api/orders');
  assert.ok(Array.isArray(empty.body.data.items));

  const create1 = await admin.json('/api/orders', { method: 'POST', body: { orderNo: 'ORD-E2E-001', customerName: 'Dave', channel: '独立站', country: 'US', product: '宠物饮水机', sku: 'SKU-E2E', qty: 2, amount: 199.9, status: 'pending' } });
  assert.equal(create1.resp.status, 201);
  ctx.orderId = create1.body.data.id;
  const create2 = await admin.json('/api/orders', { method: 'POST', body: { orderNo: 'ORD-E2E-002', customerName: 'Eve', channel: 'Amazon', country: 'DE', product: '猫砂盆', sku: 'SKU-E2E2', qty: 1, amount: 89, status: 'shipped' } });
  assert.equal(create2.resp.status, 201);

  // 校验非法订单状态
  const badStatus = await admin.json('/api/orders', { method: 'POST', body: { orderNo: 'ORD-BAD', status: 'whatever' } });
  assert.equal(badStatus.resp.status, 400);

  // 状态过滤
  const shipped = await admin.json('/api/orders?status=shipped');
  assert.equal(shipped.body.data.items.length, 1);
  assert.equal(shipped.body.data.items[0].orderNo, 'ORD-E2E-002');

  // 搜索（客户名）
  const bySearch = await admin.json('/api/orders?search=Dave');
  assert.equal(bySearch.body.data.items.length, 1);
  assert.equal(bySearch.body.data.items[0].orderNo, 'ORD-E2E-001');

  // 更新
  const upd = await admin.json(`/api/orders/${ctx.orderId}`, { method: 'PATCH', body: { status: 'paid', trackingNo: 'TRK-123' } });
  assert.equal(upd.body.data.status, 'paid');
  assert.equal(upd.body.data.trackingNo, 'TRK-123');

  // 统计
  const stats = await admin.json('/api/orders/stats');
  assert.ok(stats.body.data.total >= 2);
  assert.ok(stats.body.data.paid >= 1);

  // 删除
  const del = await admin.json(`/api/orders/${ctx.orderId}`, { method: 'DELETE' });
  assert.equal(del.resp.status, 200);
  const afterDel = await admin.json('/api/orders?search=Dave');
  assert.equal(afterDel.body.data.items.length, 0);
});

test('订单删除不存在的 id → 404', async () => {
  const { resp } = await admin.json('/api/orders/99999', { method: 'DELETE' });
  assert.equal(resp.status, 404);
});

// ---------- 线索 ----------
test('线索列表/分级过滤/导出 CSV/转 CRM', async () => {
  const all = await admin.json('/api/leads');
  assert.ok(all.body.data.length >= 8);
  const hot = await admin.json('/api/leads?grade=hot');
  assert.ok(hot.body.data.every(l => l.grade === 'hot'));
  const bad = await admin.json('/api/leads?grade=weird');
  assert.equal(bad.resp.status, 400);

  const csvResp = await admin.req('/api/leads/export.csv');
  assert.match(csvResp.headers.get('content-type'), /text\/csv/);
  const csv = await csvResp.text();
  assert.match(csv, /线索ID/);
  assert.match(csv, /M\. Reyes/);

  const promote = await admin.json('/api/leads/L-20260731-01/promote', { method: 'POST' });
  assert.equal(promote.body.data.status, 'promoted');
  const missing = await admin.json('/api/leads/L-NOPE/promote', { method: 'POST' });
  assert.equal(missing.resp.status, 404);
});

// ---------- 运行记录：过滤 / 分页 / 取消 / 重跑 ----------
test('运行记录列表支持状态过滤与搜索', async () => {
  const all = await admin.json('/api/agent-runs?limit=50');
  assert.ok(all.body.data.items.length >= 2, '指令执行应已产生运行记录');
  assert.equal(typeof all.body.data.total, 'number');
  const ok = await admin.json('/api/agent-runs?status=ok');
  assert.ok(ok.body.data.items.every(r => r.status === 'ok'));
  const s = await admin.json('/api/agent-runs?search=竞品');
  assert.ok(s.body.data.items.length >= 1);
  // 分页
  const page1 = await admin.json('/api/agent-runs?limit=1&offset=0');
  assert.equal(page1.body.data.items.length, 1);
});

test('取消进行中的运行（mock hold 模型响应）', async () => {
  mockModel.holdNext();
  const { body } = await admin.json('/api/command', { method: 'POST', body: { command: '调研竞品写 listing 再做合规审查' } });
  const cmd = await pollCommand(body.commandId, { timeout: 3000 }).catch(() => null);
  // 运行被 mock hold 住 → 命令应处于 running
  const start = Date.now();
  let run = null;
  while (Date.now() - start < 5000) {
    const r = await admin.json(`/api/commands/${body.commandId}/run`);
    if (r.body.data && r.body.data.status === 'running') { run = r.body.data; break; }
    await sleep(50);
  }
  assert.ok(run, '命令应处于 running（模型响应被挂起）');
  const cancel = await admin.json(`/api/agent-runs/${run.id}/cancel`, { method: 'POST' });
  assert.equal(cancel.resp.status, 200);
  assert.equal(cancel.body.data.status, 'cancelled');
  // 释放模型响应；修复后状态不应被后台结果覆盖回 ok
  mockModel.releaseHeld();
  await sleep(1500);
  const after = await admin.json(`/api/commands/${body.commandId}/run`);
  assert.equal(after.body.data.status, 'cancelled', '取消后的运行不能被后台完成覆盖回 ok');
  assert.ok('result' in after.body.data, 'cancelled 运行的结果字段应保留');
  ctx.cancelledRunId = run.id;
});

test('取消已完成/非 running 的运行 → 400', async () => {
  const { body } = await admin.json('/api/command', { method: 'POST', body: { command: '生成本周竞品周报' } });
  const cmd = await pollCommand(body.commandId);
  const cancel = await admin.json(`/api/agent-runs/${cmd.run.id}/cancel`, { method: 'POST' });
  assert.equal(cancel.resp.status, 400);
  assert.match(cancel.body.error, /仅 queued\/running 可取消/);
});

test('重跑历史运行 → 202 新命令', async () => {
  const list = await admin.json('/api/agent-runs?limit=1');
  const run = list.body.data.items[0];
  const rerun = await admin.json(`/api/agent-runs/${run.id}/rerun`, { method: 'POST' });
  assert.equal(rerun.resp.status, 202);
  assert.equal(rerun.body.status, 'queued');
  const cmd = await pollCommand(rerun.body.commandId);
  assert.equal(cmd.status, 'ok');
});

// ---------- 知识库（只读，避免污染真实 知识库/ 目录） ----------
test('知识库文件列表与检索端点', async () => {
  const files = await admin.json('/api/kb/files');
  assert.equal(files.body.ok, true);
  assert.ok(Array.isArray(files.body.files));
  assert.equal(typeof files.body.totalChunks, 'number');

  const emptyQ = await admin.json('/api/kb/retrieve');
  assert.equal(emptyQ.body.ok, true);
  assert.equal(typeof emptyQ.body.total, 'number');

  const q = await admin.json('/api/kb/retrieve?q=宠物&k=3');
  assert.equal(q.body.ok, true);
  assert.ok(Array.isArray(q.body.chunks));
});

// ---------- 设置 ----------
test('设置读取与更新（含非法 key）', async () => {
  const get = await admin.json('/api/settings');
  assert.equal(get.body.data.feishu_cmd, true);
  const patch = await admin.json('/api/settings', { method: 'PATCH', body: { key: 'roas_alert', value: false } });
  assert.equal(patch.body.data.roas_alert, false);
  const badKey = await admin.json('/api/settings', { method: 'PATCH', body: { key: 'not_a_key', value: 1 } });
  assert.equal(badKey.resp.status, 400);
});

// ---------- 报告 ----------
test('报告列表可读，且指令执行已自动生成报告', async () => {
  const reports = await admin.json('/api/reports');
  assert.ok(reports.body.data.length >= 1, '非对外动作指令应自动沉淀为报告');
});

// ---------- 权限与 CSRF 守卫 ----------
test('跨站写入守卫：恶意 Origin → 403，同源 Origin → 放行', async () => {
  const evil = await admin.json('/api/command', { method: 'POST', headers: { Origin: 'http://evil.example' }, body: { command: '生成本周竞品周报' } });
  assert.equal(evil.resp.status, 403);
  assert.match(evil.body.error, /跨站请求被拒绝/);

  const same = await admin.json('/api/command', { method: 'POST', headers: { Origin: `http://127.0.0.1:${process.env.PORT}` }, body: { command: '生成本周竞品周报' } });
  assert.equal(same.resp.status, 202);
  await pollCommand(same.body.commandId);
});

test('未知 API → 404；前端页面可访问', async () => {
  const { resp, body } = await admin.json('/api/does-not-exist');
  assert.equal(resp.status, 404);
  assert.match(body.error, /API 不存在/);

  const page = await fetch(`${BASE}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<html/i);
  const js = await fetch(`${BASE}/app.js`);
  assert.equal(js.status, 200);
});

// ---------- 清理 ----------
test.after(async () => {
  await sleep(200); // 让后台命令收尾
  if (appServer) await new Promise(r => appServer.close(r));
  try { await mockModel.close(); } catch (_) {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
});

const mockModel = createMockModelServer();
const ctx = {};
let appServer = null;
