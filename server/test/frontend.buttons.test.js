'use strict';

// 前端按钮与交互逻辑测试：覆盖 public/app.js 的每一个可点击按钮 / 表单 / 导航。
// 采用「有状态 URL 解析 fetch mock」+「源码级导航捕获」（见 frontend.helpers.js）。
// 运行：npm run test:frontend（node --test --test-concurrency=1）

const test = require('node:test');
const assert = require('node:assert');
const {
  appHtml,
  appJs,
  jsonResponse,
  sseChunk,
  bootJSDOM,
  waitFor,
} = require('./frontend.helpers');

// ---------------------------------------------------------------------------
//  测试夹具：有状态后端
// ---------------------------------------------------------------------------
function makeState() {
  const agents = [
    { id: 0, name: '调研', role: '市场与竞品研究', emoji: '🔍', color: '#60a5fa', status: 'online',
      task: '生成本周竞品周报', metrics: { 今日任务: 3, 完成率: '100%' },
      skills: [{ name: '竞品扫描', on: true }, { name: '舆情监控', on: false }],
      templates: [{ title: '周报', icon: '📊', prompt: '生成本周竞品周报' }, { title: '选品调研', icon: '🛒', prompt: '调研东南亚宠物用品' }] },
    { id: 1, name: '内容', role: '多语种内容创作', emoji: '✍️', color: '#a855f7', status: 'online',
      task: '生成三语 Listing', metrics: { 今日任务: 2, 完成率: '80%' },
      skills: [{ name: 'Listing 优化', on: true }, { name: 'SEO 写作', on: true }],
      templates: [{ title: 'Listing', icon: '📝', prompt: '生成三语 Listing' }] },
    { id: 2, name: '获客', role: '社媒增长与获客', emoji: '📣', color: '#fb7185', status: 'busy',
      task: '排期今日发帖', metrics: { 今日任务: 5, 完成率: '60%' },
      skills: [{ name: '社媒排期', on: true }, { name: '红人触达', on: false }],
      templates: [{ title: '发帖排期', icon: '🗓️', prompt: '为 3 个 X 账号排期今日发帖内容' }] },
    { id: 3, name: '客服', role: '客户服务与售后', emoji: '💬', color: '#34d399', status: 'online',
      task: '处理售后咨询', metrics: { 今日任务: 8, 完成率: '90%' },
      skills: [{ name: 'FAQ 应答', on: true }, { name: '物流查单', on: true }],
      templates: [{ title: '查物流', icon: '🚚', prompt: '客户询订单物流，调用 ERP 查单并回复客户' }] },
    { id: 4, name: '合规', role: '合规审查', emoji: '🛡️', color: '#fbbf24', status: 'offline',
      task: '审查上架商品', metrics: { 今日任务: 0, 完成率: '-' },
      skills: [{ name: '敏感词审查', on: true }],
      templates: [{ title: '上架审查', icon: '🔍', prompt: '对 23 条待上架 Listing 做敏感词与 FDA 审查' }] },
  ];

  const kpis = [
    { key: 'leads', label: '今日线索', value: '3', trend: '+20%', up: true, color: '#6366f1', icon: '<path d="M0 0"/>', spark: [1, 2, 3] },
    { key: 'agents', label: '在线员工', value: '5', trend: '稳定', up: false, color: '#34d399', icon: '<path d="M0 0"/>', spark: [4, 3, 5] },
    { key: 'orders', label: '今日订单', value: '12', trend: '+8%', up: true, color: '#60a5fa', icon: '<path d="M0 0"/>', spark: [2, 4, 3] },
    { key: 'reports', label: '产出报告', value: '8', trend: '持续', up: false, color: '#a855f7', icon: '<path d="M0 0"/>', spark: [1, 1, 2] },
  ];

  const leads = [
    { id: 'L-001', channel: 'WhatsApp', name: 'Alex', country: 'US', msg: '想批量采购饮水器', intent: 'B 端采购', grade: 'hot', score: 92, time: '10:20' },
    { id: 'L-002', channel: 'Email', name: 'Maria', country: 'MX', msg: '请问有现货吗', intent: '咨询', grade: 'warm', score: 64, time: '09:15' },
    { id: 'L-003', channel: 'TikTok', name: 'Spam', country: '--', msg: 'http://spam', intent: '外链', grade: 'cold', score: 5, time: '08:00' },
  ];

  const reports = [
    { id: 'R-001', title: '上周竞品周报', tag: '调研', color: '#60a5fa', time: '09:30', content: '竞品价格平均下降 3%。' },
  ];

  const runStatuses = ['ok', 'running', 'error', 'queued', 'cancelled'];
  const runs = Array.from({ length: 25 }, (_, i) => {
    const id = i + 1;
    const status = i < 5 ? runStatuses[i] : (i % 3 === 0 ? 'ok' : (i % 3 === 1 ? 'ok' : 'error'));
    const command = id === 6 ? '生成本周竞品周报' : `示例指令 ${id}`;
    const hour = String(9 + (id % 8)).padStart(2, '0');
    return {
      id, status, agentId: 'main', command, summary: command,
      steps: [{ label: '路由', kind: 'agent', tool: 'router', status: 'done', output: '路由完成' }],
      createdAt: `2026-08-16T${hour}:00:00`,
      finishedAt: status === 'ok' ? `2026-08-16T${hour}:10:00` : '',
    };
  });

  const approvals = [
    { id: 'AP-001', action: 'social_post', type: 'post', agentName: '运营总监', title: 'X 账号发布新品预热帖', summary: '发布 1 条帖子', risk: '对外动作，需人工确认后归档', created: '10:00', status: 'approved', draft: '新品发布帖草稿', command: '发一条新品预热帖' },
    { id: 'AP-002', action: 'social_post', type: 'post', agentName: '运营总监', title: 'X 发帖草稿', summary: '发布 1 条帖子', risk: '对外动作，需人工确认后归档', created: '10:30', status: 'pending', draft: '【预热】便携折叠水壶新品即将上架…', command: '发一条新品预热帖' },
    { id: 'AP-003', action: 'reply', type: 'reply', agentName: '客服', title: '回复买家物流咨询', summary: '回复 1 位买家', risk: '对外动作，需人工确认后归档', created: '11:00', status: 'pending', draft: '您的订单正在转运中…', command: '回复客户物流询问' },
  ];

  const kbFiles = [{ name: '产品手册.md', size: 20480, indexed: true, chunks: 12 }];

  const orders = [
    { id: 'O-001', orderNo: 'ORD-1001', customerName: 'Alice', product: '便携饮水壶', qty: 2, amount: 39.9, currency: 'USD', channel: 'Shopify', status: 'pending', trackingNo: '' },
    { id: 'O-002', orderNo: 'ORD-1002', customerName: 'Bob', product: '折叠碗', qty: 1, amount: 19.9, currency: 'USD', channel: 'Amazon', status: 'shipped', trackingNo: 'SF123456789' },
    { id: 'O-003', orderNo: 'ORD-1003', customerName: 'Carol', product: '牵引绳', qty: 3, amount: 45, currency: 'EUR', channel: 'TikTok Shop', status: 'completed', trackingNo: '' },
  ];

  return {
    agents, kpis, leads, reports, runs, approvals, kbFiles, orders,
    settings: { feishu_cmd: true, roas_alert: true, sandbox_backend: 'Docker（默认）' },
    activity: [{ tag: '系统', color: '#6366f1', text: '系统就绪' }],
  };
}

// ---------------------------------------------------------------------------
//  有状态 fetch mock：按 method + pathname 路由，解析 query，可读 FormData
// ---------------------------------------------------------------------------
function createApiHandler(state, calls, opts = {}) {
  const encoder = new TextEncoder();

  const commandStream = () => {
    const approval = opts.withApproval === false ? null : {
      id: 'AP-099', action: 'social_post', type: 'post', agentName: '运营总监',
      title: 'X 发帖草稿（来自指令流）', summary: '发布 1 条帖子', risk: '对外动作',
      created: '11:30', status: 'pending', draft: '【预热】新草稿', command: '发一条新品预热帖',
    };
    const chunks = [
      sseChunk('accepted', { commandId: 'C-1001', run: { steps: [
        { label: '路由', kind: 'agent', tool: 'router', status: 'done', output: '已路由至对应 Agent' },
        { label: '执行', kind: 'tool', tool: 'web_search', status: 'done', output: '已检索 12 个来源' },
      ] } }),
      sseChunk('delta', { content: '正在生成最终方案…' }),
      sseChunk('delta', { content: ' 已完成 80%' }),
      sseChunk('complete', approval ? {
        status: 'ok', content: '最终方案：已完成分析并生成草稿。', approvalId: approval.id, approval,
      } : { status: 'ok', content: '最终方案：已完成分析。', approvalId: null, approval: null }),
      sseChunk('done', { status: 'ok' }),
    ];

    if (opts.holdStream) {
      state.__release = () => { state.__released = true; state.__holdGate({ done: true, value: undefined }); };
      state.__holdGate = null;
      state.__holdPromise = new Promise((r) => { state.__holdGate = r; });
      let idx = 0;
      const read = () => idx < chunks.length
        ? Promise.resolve({ done: false, value: encoder.encode(chunks[idx++]) })
        : state.__holdPromise;
      return { ok: true, status: 200, headers: { get: (n) => String(n).toLowerCase() === 'content-type' ? 'text/event-stream' : '' }, body: { getReader: () => ({ read }) } };
    }
    return { ok: true, status: 200, headers: { get: (n) => String(n).toLowerCase() === 'content-type' ? 'text/event-stream' : '' }, body: { getReader: () => { let i = 0; return { read: async () => i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true, value: undefined } }; } } };
  };

  return async function handler(url, options = {}) {
    const u = new URL(String(url), 'http://localhost:3001/');
    const method = (options.method || 'GET').toUpperCase();
    const path = u.pathname;
    const query = Object.fromEntries(u.searchParams.entries());
    calls.push({ method, pathname: path, query, body: options.body });

    if (path === '/api/auth/me' && method === 'GET') return jsonResponse({ ok: true, user: { name: '运营', email: 'admin@example.com' } });
    if (path === '/api/auth/logout' && method === 'POST') return jsonResponse({ ok: true });

    if (path === '/api/rules') return jsonResponse({ ok: true, data: { routeRules: [], actionRules: [] } });
    if (path === '/api/health') return jsonResponse({ ok: true, model: 'gpt-4o', providerBaseUrl: 'https://openai.example.com', gatewayUrl: 'https://gateway.example.com', directConfigured: true });

    if (path === '/api/command' && method === 'POST') return commandStream();

    if (path === '/api/dashboard') {
      if (opts.failDashboard) return jsonResponse({ ok: false, error: '未登录' }, 401);
      return jsonResponse({ ok: true, data: { agents: state.agents, kpis: state.kpis, leads: state.leads, reports: state.reports, runs: state.runs, settings: state.settings, activity: state.activity } });
    }

    if (path === '/api/agent-runs' && method === 'GET') {
      let items = state.runs;
      const status = query.status;
      if (status && status !== 'all') items = items.filter((r) => r.status === status);
      const search = query.search;
      if (search) items = items.filter((r) => String(r.command).includes(search) || String(r.summary).includes(search));
      const offset = Number(query.offset || 0);
      const limit = Number(query.limit || 20);
      return jsonResponse({ ok: true, data: { items: items.slice(offset, offset + limit), total: items.length } });
    }
    const runsCancel = path.match(/^\/api\/agent-runs\/(\d+)\/cancel$/);
    if (runsCancel && method === 'POST') return jsonResponse({ ok: true });
    const runsRerun = path.match(/^\/api\/agent-runs\/(\d+)\/rerun$/);
    if (runsRerun && method === 'POST') return jsonResponse({ ok: true, commandId: 'C-2001' });

    if (path === '/api/orders/stats') {
      return jsonResponse({ ok: true, data: { total: state.orders.length, today: 1, pending: state.orders.filter((o) => o.status === 'pending').length, shipped: state.orders.filter((o) => o.status === 'shipped').length } });
    }
    if (path === '/api/orders' && method === 'GET') {
      let items = state.orders;
      if (query.status && query.status !== 'all') items = items.filter((o) => o.status === query.status);
      if (query.search) items = items.filter((o) => (o.orderNo || '').includes(query.search) || (o.customerName || '').includes(query.search) || (o.product || '').includes(query.search));
      const offset = Number(query.offset || 0);
      const limit = Number(query.limit || 50);
      return jsonResponse({ ok: true, data: { items: items.slice(offset, offset + limit), total: items.length } });
    }
    if (path === '/api/orders' && method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const order = { id: 'O-' + String(state.orders.length + 1).padStart(3, '0'), ...body };
      state.orders.unshift(order);
      return jsonResponse({ ok: true, data: order });
    }
    const orderOne = path.match(/^\/api\/orders\/([^/]+)$/);
    if (orderOne && method === 'PATCH') {
      const order = state.orders.find((o) => o.id === orderOne[1]);
      const body = JSON.parse(options.body || '{}');
      Object.assign(order, body);
      return jsonResponse({ ok: true, data: order });
    }
    if (orderOne && method === 'DELETE') {
      state.orders = state.orders.filter((o) => o.id !== orderOne[1]);
      return jsonResponse({ ok: true });
    }

    if (path === '/api/approvals' && method === 'GET') return jsonResponse({ ok: true, data: state.approvals });
    const decide = path.match(/^\/api\/approvals\/([^/]+)\/decide$/);
    if (decide && method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const ap = state.approvals.find((a) => a.id === decide[1]);
      const status = body.decision === 'approve' ? 'approved' : 'rejected';
      if (ap) ap.status = status;
      return jsonResponse({ ok: true, data: { ...ap, status } });
    }

    if (path === '/api/kb/files' && method === 'GET') return jsonResponse({ ok: true, files: state.kbFiles, totalChunks: 0 });
    if (path === '/api/kb/upload' && method === 'POST') {
      const names = [];
      const fd = options.body;
      if (fd) {
        try { for (const [, v] of fd.entries()) names.push(v && v.name); }
        catch { try { (fd.getAll('files') || []).forEach((v) => names.push(v && v.name)); } catch {} }
      }
      names.forEach((n) => { if (n) state.kbFiles.unshift({ name: n, size: 4096, indexed: true, chunks: 3 }); });
      return jsonResponse({ ok: true, files: names.map((n) => ({ name: n })) });
    }
    const kbDel = path.match(/^\/api\/kb\/files\/(.+)$/);
    if (kbDel && method === 'DELETE') {
      const name = decodeURIComponent(kbDel[1]);
      state.kbFiles = state.kbFiles.filter((f) => f.name !== name);
      return jsonResponse({ ok: true });
    }

    if (path === '/api/settings' && method === 'PATCH') {
      const body = JSON.parse(options.body || '{}');
      state.settings = { ...state.settings, [body.key]: body.value };
      return jsonResponse({ ok: true, data: state.settings });
    }

    if (path === '/api/reports' && method === 'POST') return jsonResponse({ ok: true, data: { ok: true } });

    const promote = path.match(/^\/api\/leads\/([^/]+)\/promote$/);
    if (promote && method === 'POST') return jsonResponse({ ok: true });

    const agentSkills = path.match(/^\/api\/agents\/(\d+)\/skills\/(\d+)$/);
    if (agentSkills && method === 'PATCH') {
      const ai = Number(agentSkills[1]);
      const si = Number(agentSkills[2]);
      const body = JSON.parse(options.body || '{}');
      state.agents[ai].skills[si].on = !!body.enabled;
      return jsonResponse({ ok: true, data: state.agents[ai] });
    }
    const agentOne = path.match(/^\/api\/agents\/(\d+)$/);
    if (agentOne && method === 'PATCH') {
      const ai = Number(agentOne[1]);
      const body = JSON.parse(options.body || '{}');
      state.agents[ai].status = body.status;
      return jsonResponse({ ok: true, data: state.agents[ai] });
    }

    throw new Error('unhandled request: ' + method + ' ' + path);
  };
}

// ---------------------------------------------------------------------------
//  工具函数
// ---------------------------------------------------------------------------
function bootApp(state, calls, opts = {}, t) {
  const fetchHandler = createApiHandler(state, calls, opts);
  const dom = bootJSDOM({ html: appHtml(), js: appJs(), url: 'http://localhost:3001/', fetchHandler });
  // app.js 有 setInterval（30s 审批轮询），必须关闭窗口否则 node --test 无法退出。
  // close 前先让已入队的微任务链（loadX → renderX 的 .then）跑完，
  // 避免窗口关闭后 document 变为 undefined 触发 unhandledRejection。
  if (t) t.after(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    dom.window.close();
  });
  return dom;
}

function ready(window) {
  return waitFor(() => window.document.querySelectorAll('.agent-card').length === 5);
}

function toastText(window) {
  return window.document.getElementById('toast').textContent;
}

function waitForToast(window, re, timeout = 4000) {
  return waitFor(() => re.test(toastText(window)), timeout);
}

function findCall(calls, method, pathname) {
  // 返回最后一次匹配：后续断言都验证「最新一次请求」的 body
  return calls.filter((c) => c.method === method && c.pathname === pathname).pop();
}

function bodyOf(call) {
  return call && call.body ? JSON.parse(call.body) : {};
}

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true }));

// ---------------------------------------------------------------------------
//  1. 引导初始化
// ---------------------------------------------------------------------------
test('bootstrap 渲染：5 员工卡 / 4 KPI / 快捷指令 / 用户信息 / 无导航跳转', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  await ready(window);
  const doc = window.document;

  assert.strictEqual(doc.querySelectorAll('.agent-card').length, 5, '应渲染 5 张员工卡');
  assert.strictEqual(doc.querySelectorAll('#kpiRow .kpi').length, 4, '应渲染 4 个 KPI');
  assert.strictEqual(doc.querySelectorAll('#quickCmds .quick-cmd').length, 5, '应渲染 5 个快捷指令');
  assert.strictEqual(doc.getElementById('userName').textContent, '运营');
  assert.strictEqual(doc.getElementById('userAvatar').textContent, '运');
  assert.strictEqual(doc.getElementById('pageTitle').textContent, '运营总览');
  assert.strictEqual(doc.getElementById('onlineAgents').textContent, '4', '应显示 4 名在线（agent 4 离线）');
  assert.strictEqual(doc.getElementById('healthStatusText').textContent, '后端已连接');
  assert.strictEqual(doc.getElementById('modelChip').textContent, 'gpt-4o');
  assert.deepStrictEqual(window.__navigations, [], '正常引导不应触发任何页面跳转');
  assert.ok(findCall(calls, 'GET', '/api/auth/me'), '应拉取当前用户');
  assert.ok(findCall(calls, 'GET', '/api/dashboard'), '应拉取仪表盘');
  assert.ok(findCall(calls, 'GET', '/api/approvals'), '应拉取审批');
});

// ---------------------------------------------------------------------------
//  2. 导航与视图切换
// ---------------------------------------------------------------------------
test('导航切换：每个视图标题 / active 态 / agent 详情', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  const clickNav = (sel) => click(doc.querySelector(sel));
  const cases = [
    ['overview', '运营总览'],
    ['approval', '审批中心'],
    ['leads', '线索管理'],
    ['orders', '订单管理'],
    ['knowledge', '知识库'],
    ['settings', '设置'],
  ];
  for (const [view, title] of cases) {
    clickNav(`.nav-item[data-view="${view}"]`);
    assert.strictEqual(doc.getElementById('pageTitle').textContent, title, `视图 ${view} 标题`);
    assert.ok(doc.getElementById(`view-${view}`).classList.contains('view-active'), `视图 ${view} 激活`);
  }

  clickNav('.nav-item[data-agent="1"]');
  assert.strictEqual(doc.getElementById('pageTitle').textContent, '数字员工');
  assert.ok(doc.getElementById('agentDetail').textContent.includes('内容'), '应渲染 agent 1 详情');
  assert.ok(doc.querySelector('.nav-item[data-agent="1"]').classList.contains('active'));
});

// ---------------------------------------------------------------------------
//  3. Agent 卡片 → 详情
// ---------------------------------------------------------------------------
test('点击员工卡进入详情页', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.agent-card[data-id="2"]'));
  assert.strictEqual(doc.getElementById('pageTitle').textContent, '数字员工');
  assert.ok(doc.getElementById('agentDetail').textContent.includes('获客'));
  assert.ok(doc.getElementById('agentDetail').textContent.includes('社媒增长与获客'));
});

// ---------------------------------------------------------------------------
//  4. Agent 状态切换（上线/下线）
// ---------------------------------------------------------------------------
test('toggleStatus：下线/上线 + PATCH + toast', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.nav-item[data-agent="0"]'));
  click(doc.getElementById('toggleStatus'));
  await waitForToast(window, /「调研」已下线/);
  const patch = findCall(calls, 'PATCH', '/api/agents/0');
  assert.strictEqual(bodyOf(patch).status, 'offline');
  assert.strictEqual(state.agents[0].status, 'offline');
  assert.strictEqual(doc.getElementById('toggleStatus').textContent.trim(), '上线', '下线后按钮应显示「上线」');

  click(doc.getElementById('toggleStatus'));
  await waitForToast(window, /「调研」已上线/);
  assert.strictEqual(bodyOf(findCall(calls, 'PATCH', '/api/agents/0')).status, 'online');
});

// ---------------------------------------------------------------------------
//  5. Agent 技能开关
// ---------------------------------------------------------------------------
test('技能开关：停用/启用 + PATCH /skills/:i + toast', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.nav-item[data-agent="0"]'));
  click(doc.querySelector('.skill-toggle[data-i="0"]'));
  await waitForToast(window, /技能「竞品扫描」已停用/);
  let patch = findCall(calls, 'PATCH', '/api/agents/0/skills/0');
  assert.strictEqual(bodyOf(patch).enabled, false);

  click(doc.querySelector('.skill-toggle[data-i="0"]'));
  await waitForToast(window, /技能「竞品扫描」已启用/);
  patch = findCall(calls, 'PATCH', '/api/agents/0/skills/0');
  assert.strictEqual(bodyOf(patch).enabled, true);
});

// ---------------------------------------------------------------------------
//  6. Agent 详情 → 快捷任务模板（派发指令）
// ---------------------------------------------------------------------------
test('详情页 tpl-card 点击执行模板指令', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, { withApproval: false }, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.nav-item[data-agent="0"]'));
  click(doc.querySelector('#agentDetail .tpl-card[data-i="0"]'));
  await waitFor(() => doc.getElementById('commandDrawerStatus').textContent === '已完成');
  const cmd = findCall(calls, 'POST', '/api/command');
  assert.strictEqual(bodyOf(cmd).command, '生成本周竞品周报');
  await waitForToast(window, /指令已开始执行，结果会显示在右下角抽屉/);
});

// ---------------------------------------------------------------------------
//  7. 任务下达弹窗
// ---------------------------------------------------------------------------
test('下达任务弹窗：空指令拦截 / 自由指令派发 / 模板派发 / 关闭', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, { withApproval: false }, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.nav-item[data-agent="1"]'));
  click(doc.getElementById('assignTask'));
  assert.ok(doc.getElementById('modalOverlay').classList.contains('show'), '弹窗应打开');
  assert.ok(doc.getElementById('taskFreeInput'), '应有自由指令输入框');

  // 空指令 → 拦截
  click(doc.getElementById('taskDispatch'));
  await waitForToast(window, /请输入指令或选择一个模板/);
  assert.ok(!findCall(calls, 'POST', '/api/command'), '空指令不应提交');

  // 自由指令派发
  doc.getElementById('taskFreeInput').value = '调研东南亚宠物用品';
  click(doc.getElementById('taskDispatch'));
  await waitFor(() => doc.getElementById('commandDrawerStatus').textContent === '已完成');
  assert.strictEqual(bodyOf(findCall(calls, 'POST', '/api/command')).command, '调研东南亚宠物用品');
  assert.ok(!doc.getElementById('modalOverlay').classList.contains('show'), '派发后应关闭弹窗');

  // 模板派发
  click(doc.getElementById('assignTask'));
  click(doc.querySelector('#modalBody .tpl-card[data-i="0"]'));
  await waitFor(() => doc.getElementById('commandDrawerStatus').textContent === '已完成');
  assert.strictEqual(bodyOf(findCall(calls, 'POST', '/api/command')).command, '生成三语 Listing');

  // 关闭按钮
  click(doc.getElementById('assignTask'));
  click(doc.getElementById('modalClose'));
  assert.ok(!doc.getElementById('modalOverlay').classList.contains('show'), 'modalClose 应关闭弹窗');
});

// ---------------------------------------------------------------------------
//  8. 指令执行流程（无对外动作）
// ---------------------------------------------------------------------------
test('指令执行：发送按钮 / Enter / 空输入 / 抽屉状态 / 去总览', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, { withApproval: false }, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  // 空输入不提交
  click(doc.getElementById('commandSend'));
  assert.ok(!findCall(calls, 'POST', '/api/command'), '空输入不应提交');

  // 发送按钮
  doc.getElementById('commandInput').value = '生成本周亚马逊竞品周报';
  click(doc.getElementById('commandSend'));
  await waitFor(() => doc.getElementById('commandDrawerStatus').textContent === '已完成');
  const cmd = findCall(calls, 'POST', '/api/command');
  assert.strictEqual(bodyOf(cmd).command, '生成本周亚马逊竞品周报');
  assert.strictEqual(bodyOf(cmd).agentId, 'main');
  assert.strictEqual(bodyOf(cmd).stream, true);
  assert.ok(doc.getElementById('commandDrawer').classList.contains('show'), '指令执行应展开抽屉');
  assert.ok(doc.getElementById('consoleBody').textContent.includes('最终方案：已完成分析。'), '控制台应显示最终产出');
  assert.ok(doc.getElementById('activityFeed').textContent.includes('提交异步指令'), '活动流应记录提交');

  // 无对外动作时不应出现审批相关步骤
  assert.ok(!doc.getElementById('consoleBody').textContent.includes('已生成审批条目'), '无对外动作不应生成审批');

  // Enter 触发
  doc.getElementById('commandInput').value = '生成本周竞品周报';
  doc.getElementById('commandInput').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => doc.getElementById('commandDrawerStatus').textContent === '已完成');
  assert.ok(findCall(calls, 'POST', '/api/command'));

  // 抽屉收起 / 展开
  click(doc.getElementById('commandDrawerToggle'));
  assert.ok(doc.getElementById('commandDrawer').classList.contains('collapsed'), '收起态应有 collapsed');
  assert.strictEqual(doc.getElementById('commandDrawerToggle').textContent, '展开');
  click(doc.getElementById('commandDrawerToggle'));
  assert.strictEqual(doc.getElementById('commandDrawerToggle').textContent, '收起');

  // 去总览：切回 overview 并收起
  click(doc.querySelector('.nav-item[data-view="orders"]'));
  click(doc.getElementById('commandDrawerOverview'));
  assert.strictEqual(doc.getElementById('pageTitle').textContent, '运营总览');
  assert.ok(doc.getElementById('commandDrawer').classList.contains('collapsed'), '去总览后抽屉应收起');
});

// ---------------------------------------------------------------------------
//  9. 指令执行流程（含对外动作 → 审批闸门）
// ---------------------------------------------------------------------------
test('指令执行：检测到对外动作生成审批条目 + 徽标更新', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t); // withApproval 默认 true
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  doc.getElementById('commandInput').value = '为 3 个 X 账号排期今日发帖内容';
  click(doc.getElementById('commandSend'));
  await waitFor(() => doc.getElementById('commandDrawerStatus').textContent === '已完成');
  await waitForToast(window, /检测到对外动作，已生成审批条目 AP-099/);
  assert.ok(doc.getElementById('consoleBody').textContent.includes('已生成审批条目 AP-099'), '控制台应出现审批步骤');
  assert.strictEqual(doc.querySelector('.nav-badge').textContent, '3', '待审批徽标应为 3（2 已有 + AP-099）');
});

// ---------------------------------------------------------------------------
//  10. 指令执行：running 防重入
// ---------------------------------------------------------------------------
test('指令执行中再次提交被拦截（running 防重入）', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, { withApproval: false, holdStream: true }, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  doc.getElementById('commandInput').value = '第一条指令';
  click(doc.getElementById('commandSend'));
  await waitFor(() => doc.getElementById('commandSend').disabled === true, 2000);

  doc.getElementById('commandInput').value = '第二条指令';
  click(doc.getElementById('commandSend'));
  await waitForToast(window, /上条指令仍在执行，请稍候/);
  const posts = calls.filter((c) => c.method === 'POST' && c.pathname === '/api/command');
  assert.strictEqual(posts.length, 1, 'running 期间只允许一条指令');

  // 释放流，验证最终能正常完成
  state.__release();
  await waitFor(() => doc.getElementById('commandDrawerStatus').textContent === '已完成');
  assert.strictEqual(doc.getElementById('commandSend').disabled, false, '执行完成后按钮恢复');
});

// ---------------------------------------------------------------------------
//  11. 通知铃铛 → 审批中心
// ---------------------------------------------------------------------------
test('通知铃铛跳转审批中心', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.icon-btn'));
  assert.strictEqual(doc.getElementById('pageTitle').textContent, '审批中心');
  assert.ok(doc.getElementById('view-approval').classList.contains('view-active'));
});

// ---------------------------------------------------------------------------
//  12. 登出
// ---------------------------------------------------------------------------
test('userChip 登出：POST /api/auth/logout + 跳转 /login.html', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.getElementById('userChip'));
  await waitFor(() => window.__navigations.includes('/login.html'));
  assert.ok(findCall(calls, 'POST', '/api/auth/logout'), '应调用登出接口');
});

// ---------------------------------------------------------------------------
//  13. 审批中心：查看草稿 / 批准 / 驳回 / 徽标
// ---------------------------------------------------------------------------
test('审批中心：列表/统计渲染 + 批准归档 + 驳回 + 徽标变化', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.nav-item[data-view="approval"]'));
  assert.strictEqual(doc.querySelector('.nav-badge').textContent, '2', '初始待审批 2 条');
  assert.ok(doc.getElementById('approvalStats').textContent.includes('待审批'), '应有待审批统计');
  assert.ok(doc.getElementById('approvalPending').textContent.includes('AP-002'));
  assert.ok(doc.getElementById('approvalHistory').textContent.includes('AP-001'));

  // 查看草稿 → 批准并归档
  click(doc.querySelector('#approvalPending [data-act="view"][data-id="AP-002"]'));
  assert.ok(doc.getElementById('modalOverlay').classList.contains('show'), '草稿弹窗应打开');
  assert.ok(doc.getElementById('modalBody').textContent.includes('【预热】便携折叠水壶新品即将上架'), '弹窗应显示草稿内容');
  click(doc.getElementById('draftApprove'));
  await waitForToast(window, /已批准并归档「X 发帖草稿」/);
  assert.match(toastText(window), /未真实执行/, '批准提示必须明确「未真实执行」');
  const decide = findCall(calls, 'POST', '/api/approvals/AP-002/decide');
  assert.strictEqual(bodyOf(decide).decision, 'approve');
  await waitFor(() => !doc.getElementById('approvalPending').textContent.includes('AP-002'), 2000);
  assert.ok(doc.getElementById('approvalHistory').textContent.includes('AP-002'), '批准后应移入历史');

  // 驳回
  click(doc.querySelector('#approvalPending [data-act="reject"][data-id="AP-003"]'));
  await waitForToast(window, /已驳回「回复买家物流咨询」，退回修改/);
  assert.strictEqual(bodyOf(findCall(calls, 'POST', '/api/approvals/AP-003/decide')).decision, 'reject');

  // 徽标：全部处理完 → 隐藏
  await waitFor(() => doc.querySelector('.nav-badge').style.display === 'none', 2000);
});

// ---------------------------------------------------------------------------
//  14. 线索管理：筛选 / 转客户 / 导出 CSV
// ---------------------------------------------------------------------------
test('线索管理：统计/表格/筛选/转客户/导出', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.nav-item[data-view="leads"]'));
  assert.strictEqual(doc.getElementById('leadCount').textContent, '3', '线索总数应为 3');
  assert.strictEqual(doc.querySelectorAll('#leadTable tbody tr').length, 3);

  // 筛选「高意向」
  click(doc.querySelector('.lead-filter[data-grade="hot"]'));
  assert.strictEqual(doc.querySelectorAll('#leadTable tbody tr').length, 1, 'hot 筛选只剩 1 条');
  assert.ok(doc.getElementById('leadTable').textContent.includes('Alex'));
  assert.ok(!doc.getElementById('leadTable').textContent.includes('Maria'));
  click(doc.querySelector('.lead-filter[data-grade="all"]'));
  assert.strictEqual(doc.querySelectorAll('#leadTable tbody tr').length, 3);

  // 转客户
  click(doc.querySelector('[data-promote="L-001"]'));
  await waitForToast(window, /已将「Alex」转入 CRM 待跟进/);
  assert.ok(findCall(calls, 'POST', '/api/leads/L-001/promote'), '应调用 promote');

  // 导出 CSV → 导航捕获
  click(doc.getElementById('exportLeads'));
  assert.ok(window.__navigations.includes('/api/leads/export.csv'), '应导航到导出地址');
});

// ---------------------------------------------------------------------------
//  15. 运行记录：查看 / 取消 / 重跑 / 搜索 / 状态过滤 / 分页
// ---------------------------------------------------------------------------
test('运行记录：查看/取消/重跑/搜索/状态/分页', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  // 首屏 20 条 + 共 25 条
  assert.strictEqual(doc.querySelectorAll('#agentRunList [data-run]').length, 20);
  assert.ok(doc.getElementById('agentRunList').textContent.includes('共 25 条'));

  // 查看详情
  click(doc.querySelector('[data-run-action="view"][data-id="1"]'));
  assert.ok(doc.getElementById('modalOverlay').classList.contains('show'));
  assert.ok(doc.getElementById('modalBody').textContent.includes('Agent Run #1'));
  click(doc.getElementById('modalClose'));

  // 取消（running 指令）
  click(doc.querySelector('[data-run-action="cancel"][data-id="2"]'));
  await waitForToast(window, /操作成功/);
  assert.ok(findCall(calls, 'POST', '/api/agent-runs/2/cancel'));

  // 重跑（error 指令）
  click(doc.querySelector('[data-run-action="rerun"][data-id="3"]'));
  await waitForToast(window, /已重新提交命令 #C-2001/);
  assert.ok(findCall(calls, 'POST', '/api/agent-runs/3/rerun'));

  // 状态过滤
  const runStatus = doc.getElementById('runStatus');
  runStatus.value = 'running';
  runStatus.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => findCall(calls, 'GET', '/api/agent-runs') && findCall(calls, 'GET', '/api/agent-runs').query.status === 'running');
  await waitFor(() => doc.querySelectorAll('#agentRunList [data-run]').length === 1, 3000);
  assert.ok(doc.getElementById('agentRunList').textContent.includes('running'), '过滤后应只剩 running');

  // 重置状态过滤（状态与搜索为 AND 语义），再搜索
  runStatus.value = 'all';
  runStatus.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => doc.querySelectorAll('#agentRunList [data-run]').length === 20, 3000);

  // 搜索
  const runSearch = doc.getElementById('runSearch');
  runSearch.value = '竞品周报';
  runSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => findCall(calls, 'GET', '/api/agent-runs') && findCall(calls, 'GET', '/api/agent-runs').query.search === '竞品周报', 4000);
  await waitFor(() => doc.getElementById('agentRunList').textContent.includes('生成本周竞品周报'), 3000);

  // 清空搜索（防抖 300ms 后回到 20 条），再分页
  runSearch.value = '';
  runSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => doc.querySelectorAll('#agentRunList [data-run]').length === 20, 4000);

  // 分页
  click(doc.getElementById('runNext'));
  await waitFor(() => doc.getElementById('agentRunList').textContent.includes('共 25 条'), 3000);
  click(doc.getElementById('runPrev'));
  await waitFor(() => doc.querySelectorAll('#agentRunList [data-run]').length === 20, 3000);
});

// ---------------------------------------------------------------------------
//  16. 订单管理：新增 / 编辑 / 删除 / 搜索 / 状态过滤
// ---------------------------------------------------------------------------
test('订单管理：列表/新增/编辑/删除/搜索/状态', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.nav-item[data-view="orders"]'));
  await waitFor(() => doc.querySelectorAll('#orderTable tbody tr').length === 3, 2000);
  assert.ok(doc.getElementById('orderTable').textContent.includes('ORD-1001'));

  // 新增：空订单号拦截
  click(doc.getElementById('addOrderBtn'));
  click(doc.getElementById('orderSave'));
  await waitForToast(window, /订单号不能为空/);
  assert.ok(!findCall(calls, 'POST', '/api/orders'), '空订单号不应提交');

  // 新增：正常保存
  const setVal = (id, v) => { const el = doc.getElementById(id); el.value = v; };
  setVal('orderFormOrderNo', 'ORD-2001');
  setVal('orderFormCustomer', 'Dave');
  setVal('orderFormProduct', '宠物水壶');
  setVal('orderFormQty', '5');
  setVal('orderFormAmount', '99');
  setVal('orderFormChannel', 'Amazon');
  setVal('orderFormTracking', 'SF0001');
  click(doc.getElementById('orderSave'));
  await waitForToast(window, /订单已保存/);
  const created = findCall(calls, 'POST', '/api/orders');
  assert.strictEqual(bodyOf(created).orderNo, 'ORD-2001');
  assert.strictEqual(bodyOf(created).qty, 5);
  await waitFor(() => doc.getElementById('orderTable').textContent.includes('ORD-2001'), 2000);

  // 编辑：改状态
  click(doc.querySelector('[data-order-edit="O-001"]'));
  assert.ok(doc.getElementById('orderFormOrderNo').value === 'ORD-1001', '编辑弹窗应回填');
  doc.getElementById('orderFormStatus').value = 'shipped';
  click(doc.getElementById('orderSave'));
  await waitForToast(window, /订单已保存/);
  const patched = findCall(calls, 'PATCH', '/api/orders/O-001');
  assert.strictEqual(bodyOf(patched).status, 'shipped');
  await waitFor(() => doc.getElementById('orderTable').textContent.includes('已发货'), 2000);

  // 删除
  click(doc.querySelector('[data-order-delete="O-002"]'));
  await waitForToast(window, /订单已删除/);
  assert.ok(findCall(calls, 'DELETE', '/api/orders/O-002'));
  await waitFor(() => !doc.getElementById('orderTable').textContent.includes('ORD-1002'), 2000);

  // 状态过滤（删除 O-002 后，shipped 仅剩 O-001）
  const orderStatus = doc.getElementById('orderStatus');
  orderStatus.value = 'shipped';
  orderStatus.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => findCall(calls, 'GET', '/api/orders') && findCall(calls, 'GET', '/api/orders').query.status === 'shipped', 2000);
  await waitFor(() => doc.querySelectorAll('#orderTable tbody tr').length === 1, 2000);

  // 重置状态过滤（状态与搜索为 AND 语义），再搜索
  orderStatus.value = 'all';
  orderStatus.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => doc.querySelectorAll('#orderTable tbody tr').length === 3, 2000);

  // 搜索（Dave = 新增的 pending 订单 ORD-2001）
  const orderSearch = doc.getElementById('orderSearch');
  orderSearch.value = 'Dave';
  orderSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => findCall(calls, 'GET', '/api/orders') && findCall(calls, 'GET', '/api/orders').query.search === 'Dave', 2000);
  await waitFor(() => doc.querySelectorAll('#orderTable tbody tr').length === 1, 2000);
});

// ---------------------------------------------------------------------------
//  17. 知识库：上传（按钮/拖拽）/ 删除
// ---------------------------------------------------------------------------
test('知识库：列表渲染 + 按钮上传 + 拖拽上传 + 删除', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.nav-item[data-view="knowledge"]'));
  await waitFor(() => doc.getElementById('kbList').textContent.includes('产品手册.md'), 2000);
  assert.ok(doc.getElementById('kbStats').textContent.includes('文档总数'));

  // 文件选择上传
  const file = new window.File(['hello'], '运营手册.md', { type: 'text/markdown' });
  const input = doc.getElementById('kbFileInput');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitForToast(window, /✅ 已上传 1 个文档，md\/txt 已进索引/);
  const upload = findCall(calls, 'POST', '/api/kb/upload');
  assert.ok(upload && upload.body, '应提交 FormData 上传');
  await waitFor(() => doc.getElementById('kbList').textContent.includes('运营手册.md'), 2000);

  // 拖拽上传
  const file2 = new window.File(['hello2'], '客服FAQ.pdf', { type: 'application/pdf' });
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file2] }, configurable: true });
  doc.getElementById('kbDropzone').dispatchEvent(ev);
  await waitForToast(window, /✅ 已上传 1 个文档，md\/txt 已进索引/);
  await waitFor(() => doc.getElementById('kbList').textContent.includes('客服FAQ.pdf'), 2000);

  // 删除（无 confirm 弹窗）
  click(doc.querySelector('.kb-item-del'));
  await waitForToast(window, /已删除「客服FAQ.pdf」/);
  assert.ok(findCall(calls, 'DELETE', '/api/kb/files/' + encodeURIComponent('客服FAQ.pdf')));
  await waitFor(() => !doc.getElementById('kbList').textContent.includes('客服FAQ.pdf'), 2000);
});

// ---------------------------------------------------------------------------
//  18. 设置：开关 / 下拉 / 输入 / 待接入按钮 / 运行自检
// ---------------------------------------------------------------------------
test('设置页：开关/下拉/输入/待接入/运行自检', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('.nav-item[data-view="settings"]'));
  assert.ok(doc.getElementById('settingsGrid').textContent.includes('模型路由'));
  assert.ok(doc.getElementById('settingsGrid').textContent.includes('当前后端模型'));

  // 开关
  click(doc.querySelector('.settings-toggle[data-key="feishu_cmd"]'));
  await waitForToast(window, /「渠道接入」已关闭/);
  let patch = findCall(calls, 'PATCH', '/api/settings');
  assert.deepStrictEqual({ key: bodyOf(patch).key, value: bodyOf(patch).value }, { key: 'feishu_cmd', value: false });

  // 下拉
  const sel = doc.querySelector('.settings-select[data-key="sandbox_backend"]');
  sel.value = 'SSH';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitForToast(window, /已保存：SSH/);
  patch = findCall(calls, 'PATCH', '/api/settings');
  assert.deepStrictEqual({ key: bodyOf(patch).key, value: bodyOf(patch).value }, { key: 'sandbox_backend', value: 'SSH' });

  // 输入
  const inp = doc.querySelector('.settings-input[data-key="feishu_webhook"]');
  inp.value = 'https://open.feishu.cn/webhook/123';
  inp.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitForToast(window, /已保存配置/);
  patch = findCall(calls, 'PATCH', '/api/settings');
  assert.deepStrictEqual({ key: bodyOf(patch).key, value: bodyOf(patch).value }, { key: 'feishu_webhook', value: 'https://open.feishu.cn/webhook/123' });

  // 待接入按钮（disabled，需手动 dispatch click）
  click(doc.querySelector('.settings-btn[data-btn="待接入"]'));
  await waitForToast(window, /memory\/ 自动清理待接入：当前不会修改长期记忆记录/);

  // 运行自检
  const beforeHealth = calls.filter((c) => c.method === 'GET' && c.pathname === '/api/health').length;
  click(doc.querySelector('.settings-btn[data-btn="运行自检"]'));
  await waitForToast(window, /✅ 后端 API 可达/);
  await waitFor(() => calls.filter((c) => c.method === 'GET' && c.pathname === '/api/health').length === beforeHealth + 1);
  assert.ok(doc.getElementById('activityFeed').textContent.includes('真实自检：后端 API 可达'), '自检结果应写入活动流');
});

// ---------------------------------------------------------------------------
//  19. 报告：点击产出报告打开详情
// ---------------------------------------------------------------------------
test('产出报告：点击打开详情弹窗', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  await ready(window);

  click(doc.querySelector('[data-report="R-001"]'));
  assert.ok(doc.getElementById('modalOverlay').classList.contains('show'));
  assert.ok(doc.getElementById('modalBody').textContent.includes('上周竞品周报'));
  assert.ok(doc.getElementById('modalBody').textContent.includes('竞品价格平均下降 3%'));
  click(doc.getElementById('modalClose'));
  assert.ok(!doc.getElementById('modalOverlay').classList.contains('show'));
});

// ---------------------------------------------------------------------------
//  20. 鉴权兜底：任意非 auth 接口 401 → 跳转登录页
// ---------------------------------------------------------------------------
test('apiJson 401 兜底：跳转 /login.html', async (t) => {
  const state = makeState();
  const calls = [];
  const dom = bootApp(state, calls, { failDashboard: true }, t);
  const { window } = dom;
  await waitFor(() => window.__navigations.includes('/login.html'));
  assert.ok(window.__navigations.includes('/login.html'), '仪表盘 401 应跳转登录页');
});
