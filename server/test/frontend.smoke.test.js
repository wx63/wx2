'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

const agents = Array.from({ length: 5 }, (_, i) => ({
  id: i,
  emoji: 'A',
  name: 'Agent ' + i,
  role: 'Role ' + i,
  color: '#60a5fa',
  status: 'online',
  task: 'Ready',
  metrics: { reports: 1 },
  skills: [
    { name: 'skill-a', on: true },
    { name: 'skill-b', on: true },
    { name: 'skill-c', on: false },
    { name: 'skill-d', on: false },
  ],
  templates: [{ title: 'Template', icon: 'T', prompt: 'run template' }],
}));

const kpis = [
  { key: 'orders', label: 'Orders', value: '1', trend: 'flat', up: false, icon: '<path/>', color: '#60a5fa', spark: [1] },
  { key: 'leads', label: 'Leads', value: '3', trend: 'flat', up: false, icon: '<path/>', color: '#fb7185', spark: [3] },
  { key: 'agents', label: 'Agents', value: '5 / 5', trend: 'flat', up: false, icon: '<path/>', color: '#34d399', spark: [5] },
  { key: 'risk', label: 'Risk', value: '1', trend: 'flat', up: false, icon: '<path/>', color: '#fbbf24', spark: [1] },
];

const leads = [
  { id: 'L1', channel: 'WA', name: 'Hot Buyer', country: 'US', msg: 'I want 100 units', grade: 'hot', intent: 'B2B', score: 90, time: '10:00', status: 'new' },
  { id: 'L2', channel: 'X', name: 'Warm User', country: 'US', msg: 'What size?', grade: 'warm', intent: 'C2C', score: 50, time: '10:01', status: 'new' },
  { id: 'L3', channel: 'R', name: 'Cold User', country: 'US', msg: 'Nice post', grade: 'cold', intent: 'No intent', score: 10, time: '10:02', status: 'new' },
];

const pendingApproval = {
  id: 'AP-001',
  action: 'social_post',
  title: 'Post draft',
  command: 'Post a draft',
  risk: 'Needs review',
  status: 'pending',
  draft: 'Draft body',
  createdAt: '2026-08-15T00:00:00.000Z',
};

const rules = {
  ok: true,
  data: {
    routeRules: [
      { agent: 0, kw: ['竞品'], tag: '调研', color: '#60a5fa' },
      { agent: 1, kw: ['listing'], tag: '内容', color: '#a855f7' },
      { agent: 2, kw: ['发帖'], tag: '获客', color: '#fb7185' },
      { agent: 3, kw: ['客户'], tag: '客服', color: '#34d399' },
      { agent: 4, kw: ['审查'], tag: '合规', color: '#fbbf24' },
    ],
    actionRules: [
      { action: 'social_post', label: 'Social', weakKw: [], patterns: ['发(?:一条|个|帖)'], kw: ['发帖', '发一条'] },
      { action: 'listing_submit', label: 'Listing', weakKw: [], patterns: ['上架'], kw: ['上架'] },
      { action: 'purchase', label: 'Purchase', weakKw: [], patterns: ['采购'], kw: ['采购'] },
      { action: 'refund', label: 'Refund', weakKw: [], patterns: ['退款'], kw: ['退款'] },
    ],
  },
};

const dashboard = {
  ok: true,
  data: {
    agents,
    kpis,
    activity: [],
    leads,
    reports: [],
    runs: [],
    settings: {},
  },
};

const routes = {
  '/api/auth/me': { ok: true, user: { id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin' } },
  '/api/rules': rules,
  '/api/health': { ok: true, model: 'deepseek/deepseek-chat', directConfigured: true, providerBaseUrl: 'https://example.test/v1', gatewayUrl: 'http://127.0.0.1:18789' },
  '/api/dashboard': dashboard,
  '/api/agent-runs': { ok: true, data: { total: 0, limit: 20, offset: 0, items: [] } },
  '/api/orders': { ok: true, data: { total: 0, limit: 50, offset: 0, items: [] } },
  '/api/orders/stats': { ok: true, data: { total: 0, today: 0, pending: 0, shipped: 0 } },
  '/api/kb/files': { ok: true, files: [], totalChunks: 0 },
  '/api/approvals': { ok: true, data: [pendingApproval] },
  '/api/reports': { ok: true, data: { id: 'R-1' } },
};

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function sseChunk(event, payload) {
  return 'event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n';
}

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/event-stream' : '') },
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { done: false, value: encoder.encode(chunks[index++]) }
          : { done: true, value: undefined },
      }),
    },
  };
}

function makeDom() {
  const dom = new JSDOM(html, {
    url: 'http://localhost:3001/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.TextDecoder = TextDecoder;
  window.TextEncoder = TextEncoder;
  window.confirm = () => true;
  window.localStorage.setItem('oc_user', JSON.stringify({ name: 'Admin', role: 'admin' }));

  window.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target === '/api/command') {
      return sseResponse([
        sseChunk('accepted', { ok: true, commandId: 99, status: 'queued' }),
        sseChunk('delta', { content: '方案草稿' }),
        sseChunk('complete', {
          status: 'ok',
          content: '最终方案',
          approvalId: 'AP-002',
          approval: {
            id: 'AP-002',
            action: 'social_post',
            title: '发一条推广帖',
            command: '发一条推广帖',
            risk: '对外动作',
            status: 'pending',
            draft: '方案草稿',
            createdAt: '2026-08-15T00:00:00.000Z',
          },
        }),
        sseChunk('done', {}),
      ]);
    }
    if (target === '/api/approvals/AP-001/decide') {
      return jsonResponse({ ok: true, data: { ...pendingApproval, status: 'approved', decidedAt: '2026-08-15T00:00:00.000Z' } });
    }
    const route = routes[target];
    if (route) return jsonResponse(route);
    return jsonResponse({ ok: false, error: 'not mocked: ' + target }, 404);
  };

  const script = window.document.createElement('script');
  script.textContent = appJs;
  window.document.body.appendChild(script);
  return dom;
}

function makeUnauthDom() {
  const dom = new JSDOM(html, {
    url: 'http://localhost:3001/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.TextDecoder = TextDecoder;
  window.TextEncoder = TextEncoder;
  window.confirm = () => true;
  window.__redirectToLogin = () => {
    window.__redirectedTo = '/login.html';
  };
  window.fetch = async (url) => {
    if (String(url) === '/api/auth/me') {
      return jsonResponse({ ok: false, error: '请先登录' }, 401);
    }
    return jsonResponse({ ok: false, error: 'not mocked: ' + url }, 404);
  };
  const script = window.document.createElement('script');
  script.textContent = appJs;
  window.document.body.appendChild(script);
  return dom;
}

async function waitFor(fn, timeout = 4000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeout) {
    try {
      const value = fn();
      if (value) return value;
    } catch (e) {
      lastError = e;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw lastError || new Error('waitFor timeout');
}

test('frontend bootstrap renders KPI and five agent cards', async () => {
  const dom = makeDom();
  try {
    await waitFor(() => dom.window.document.querySelectorAll('.agent-card').length === 5);
    assert.equal(dom.window.document.querySelectorAll('.kpi').length, 4);
    assert.ok(dom.window.document.querySelector('#pageTitle').textContent.includes('运营总览'));
  } finally {
    dom.window.close();
  }
});

test('frontend unauthenticated root redirects to login', async () => {
  const dom = makeUnauthDom();
  try {
    await waitFor(() => dom.window.__redirectedTo === '/login.html');
  } finally {
    dom.window.close();
  }
});

test('frontend approval flow moves approved item to history', async () => {
  const dom = makeDom();
  try {
    await waitFor(() => dom.window.document.querySelectorAll('.agent-card').length === 5);
    dom.window.switchView('approval');
    await waitFor(() => dom.window.document.querySelectorAll('#approvalPending .ap-item').length === 1);
    const approve = dom.window.document.querySelector('#approvalPending [data-act=approve]');
    assert.ok(approve);
    approve.click();
    await waitFor(() => dom.window.document.querySelectorAll('#approvalPending .ap-item').length === 0);
    assert.ok(dom.window.document.querySelector('#approvalHistory').textContent.includes('AP-001'));
  } finally {
    dom.window.close();
  }
});

test('frontend lead filter shows only hot leads', async () => {
  const dom = makeDom();
  try {
    await waitFor(() => dom.window.document.querySelectorAll('.agent-card').length === 5);
    dom.window.switchView('leads');
    await waitFor(() => dom.window.document.querySelectorAll('#leadTable tbody tr').length === 3);
    dom.window.document.querySelector('.lead-filter[data-grade=hot]').click();
    assert.equal(dom.window.document.querySelectorAll('#leadTable tbody tr').length, 1);
    assert.match(dom.window.document.querySelector('#leadTable').textContent, /L1/);
  } finally {
    dom.window.close();
  }
});

test('frontend command stream updates output and creates approval item', async () => {
  const dom = makeDom();
  try {
    await waitFor(() => dom.window.document.querySelectorAll('.agent-card').length === 5);
    dom.window.runCommand('发一条推广帖');
    await waitFor(() => {
      const body = dom.window.document.querySelector('#consoleBody .console-output-content');
      return body && body.textContent.includes('最终方案');
    });
    assert.match(dom.window.document.querySelector('.nav-badge').textContent, /2/);
  } finally {
    dom.window.close();
  }
});
