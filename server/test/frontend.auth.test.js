'use strict';

// 登录 / 注册 / 忘记密码 / 重置密码 前端测试：覆盖 public/login.js 与 public/reset.js。
// 采用「有状态 URL 解析 fetch mock」+「源码级导航捕获」（见 frontend.helpers.js）。
// 运行：npm run test:frontend（node --test --test-concurrency=1）

const test = require('node:test');
const assert = require('node:assert');
const {
  loginHtml,
  loginJs,
  resetHtml,
  resetJs,
  jsonResponse,
  bootJSDOM,
  waitFor,
} = require('./frontend.helpers');

// ---------------------------------------------------------------------------
//  认证相关 fetch mock
// ---------------------------------------------------------------------------
function authHandler(calls, opts = {}) {
  const enabled = opts.registerEnabled !== false;
  const role = opts.registerRole || 'operator';
  return async function handler(url, options = {}) {
    const u = new URL(String(url), 'http://localhost:3001/');
    const method = (options.method || 'GET').toUpperCase();
    const path = u.pathname;
    const query = Object.fromEntries(u.searchParams.entries());
    calls.push({ method, pathname: path, query, body: options.body });
    const body = () => { try { return JSON.parse(options.body || '{}'); } catch { return {}; } };

    if (path === '/api/auth/register-status' && method === 'GET') {
      return jsonResponse({ ok: true, data: { enabled, defaultRole: role } });
    }
    if (path === '/api/auth/login' && method === 'POST') {
      if (opts.loginFail) return jsonResponse({ ok: false, error: '邮箱或密码错误' }, 401);
      return jsonResponse({ ok: true, data: { user: { name: '运营' } } });
    }
    if (path === '/api/auth/forgot-password' && method === 'POST') {
      return jsonResponse({ ok: true, message: '如果该邮箱已注册，重置邮件已发送' });
    }
    if (path === '/api/auth/register' && method === 'POST') {
      if (opts.registerFail) return jsonResponse({ ok: false, error: '该邮箱已被注册' }, 409);
      return jsonResponse({ ok: true, data: { user: { name: body().name } } });
    }
    if (path === '/api/auth/reset-password' && method === 'POST') {
      if (opts.resetFail) return jsonResponse({ ok: false, error: '重置链接无效或已过期' }, 400);
      return jsonResponse({ ok: true, message: '密码已重置' });
    }
    throw new Error('unhandled auth request: ' + method + ' ' + path);
  };
}

// jsdom 24 不支持 HTMLFormElement 具名访问（form.email），而 app 代码依赖它。
// 这里按 app 实际用到的控件名在原型上补 setter，保证测试走真实 handler 逻辑。
const FORM_NAMED = ['email', 'password', 'remember', 'name', 'confirmPassword', 'terms'];
function patchFormNamedAccess(window) {
  const proto = window.HTMLFormElement.prototype;
  for (const n of FORM_NAMED) {
    try {
      Object.defineProperty(proto, n, {
        configurable: true,
        get() { return this.elements ? this.elements.namedItem(n) : undefined; },
      });
    } catch { /* 原生只读属性冲突时跳过 */ }
  }
}

function bootLogin(calls, opts = {}, t) {
  const dom = bootJSDOM({
    html: loginHtml(),
    js: loginJs(),
    url: 'http://localhost:3001/login.html',
    fetchHandler: authHandler(calls, opts),
    setup: (window) => patchFormNamedAccess(window),
  });
  if (t) t.after(() => dom.window.close());
  return dom;
}

function bootReset(calls, opts = {}, t) {
  const dom = bootJSDOM({
    html: resetHtml(),
    js: resetJs(),
    url: 'http://localhost:3001/reset.html' + (opts.token ? '?token=' + opts.token : ''),
    fetchHandler: authHandler(calls, opts),
    setup: (window) => patchFormNamedAccess(window),
  });
  if (t) t.after(() => dom.window.close());
  return dom;
}

function toastText(window) {
  return window.document.getElementById('toast').textContent;
}

function waitForToast(window, re, timeout = 4000) {
  return waitFor(() => re.test(toastText(window)), timeout);
}

function findCall(calls, method, pathname) {
  return calls.find((c) => c.method === method && c.pathname === pathname);
}

function bodyOf(call) {
  return call && call.body ? JSON.parse(call.body) : {};
}

function fieldError(window, formId, inputName) {
  const form = window.document.getElementById(formId);
  const field = form.querySelector(`[name=${inputName}]`).closest('.field');
  return field.querySelector('.field-error').textContent;
}

function submitForm(window, formId) {
  const form = window.document.getElementById(formId);
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

// ===========================================================================
//  登录页：login.html / login.js
// ===========================================================================

test('登录页：标签切换 active 状态', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, {}, t);
  const { window } = dom;
  const doc = window.document;

  const loginTab = doc.querySelector('[data-mode="login"]');
  const registerTab = doc.querySelector('[data-mode="register"]');
  assert.ok(loginTab.classList.contains('active'), '登录标签默认激活');
  assert.ok(doc.getElementById('loginForm').classList.contains('active'), '登录面板默认激活');
  assert.ok(!doc.getElementById('registerForm').classList.contains('active'));

  registerTab.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(registerTab.classList.contains('active'));
  assert.ok(doc.getElementById('registerForm').classList.contains('active'));
  assert.ok(!doc.getElementById('loginForm').classList.contains('active'));

  loginTab.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(loginTab.classList.contains('active'));
  assert.ok(doc.getElementById('loginForm').classList.contains('active'));
});

test('登录页：密码可见性切换', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, {}, t);
  const { window } = dom;
  const doc = window.document;

  const pwd = doc.querySelector('#loginForm input[name=password]');
  const toggle = doc.querySelector('#loginForm .toggle-pwd');
  assert.strictEqual(pwd.type, 'password');
  toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.strictEqual(pwd.type, 'text', '点击后密码应可见');
  toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.strictEqual(pwd.type, 'password', '再次点击应恢复隐藏');
});

test('登录页：表单校验（必填 / 邮箱格式 / 密码长度）', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, {}, t);
  const { window } = dom;
  const doc = window.document;

  // 空表单提交 → 全部必填
  submitForm(window, 'loginForm');
  assert.strictEqual(fieldError(window, 'loginForm', 'email'), '此项为必填');
  assert.strictEqual(fieldError(window, 'loginForm', 'password'), '此项为必填');
  assert.ok(!findCall(calls, 'POST', '/api/auth/login'), '校验失败不应提交');

  // 邮箱格式 + 密码长度
  doc.querySelector('#loginForm input[name=email]').value = 'bad-email';
  doc.querySelector('#loginForm input[name=password]').value = '123';
  submitForm(window, 'loginForm');
  assert.strictEqual(fieldError(window, 'loginForm', 'email'), '邮箱格式不正确');
  assert.strictEqual(fieldError(window, 'loginForm', 'password'), '密码至少 8 位');
  assert.ok(!findCall(calls, 'POST', '/api/auth/login'));
});

test('登录页：登录成功 → POST + 跳转首页', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, {}, t);
  const { window } = dom;
  const doc = window.document;

  doc.querySelector('#loginForm input[name=email]').value = 'admin@example.com';
  doc.querySelector('#loginForm input[name=password]').value = 'password123';
  doc.querySelector('#loginForm input[name=remember]').checked = true;
  submitForm(window, 'loginForm');
  await waitFor(() => window.__navigations.includes('/'));
  const call = findCall(calls, 'POST', '/api/auth/login');
  assert.strictEqual(bodyOf(call).email, 'admin@example.com');
  assert.strictEqual(bodyOf(call).password, 'password123');
  assert.strictEqual(bodyOf(call).remember, true);
});

test('登录页：登录失败 → 提示服务端错误 + 按钮恢复', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, { loginFail: true }, t);
  const { window } = dom;
  const doc = window.document;

  doc.querySelector('#loginForm input[name=email]').value = 'admin@example.com';
  doc.querySelector('#loginForm input[name=password]').value = 'wrong-pass';
  submitForm(window, 'loginForm');
  await waitForToast(window, /邮箱或密码错误/);
  assert.ok(!window.__navigations.includes('/'), '登录失败不应跳转');
  const btn = doc.querySelector('#loginForm button[type=submit]');
  assert.strictEqual(btn.disabled, false, '按钮应恢复可点击');
  assert.strictEqual(btn.textContent, '登录', '按钮文案应恢复');
});

test('登录页：忘记密码流程（打开/返回/校验/发送）', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, {}, t);
  const { window } = dom;
  const doc = window.document;

  const forgotLink = doc.getElementById('forgotLink');
  const tabs = doc.querySelector('.auth-tabs');
  assert.ok(forgotLink, '应有忘记密码链接');

  // 打开
  forgotLink.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  assert.strictEqual(tabs.style.display, 'none', '打开忘记密码后应隐藏标签栏');
  assert.ok(doc.getElementById('forgotForm').classList.contains('active'));
  assert.ok(!doc.getElementById('loginForm').classList.contains('active'));

  // 非法邮箱
  doc.querySelector('#forgotForm input[name=email]').value = 'bad';
  submitForm(window, 'forgotForm');
  assert.strictEqual(fieldError(window, 'forgotForm', 'email'), '邮箱格式不正确');
  assert.ok(!findCall(calls, 'POST', '/api/auth/forgot-password'));

  // 发送
  doc.querySelector('#forgotForm input[name=email]').value = 'admin@example.com';
  submitForm(window, 'forgotForm');
  await waitForToast(window, /如果该邮箱已注册，重置邮件已发送/);
  const call = findCall(calls, 'POST', '/api/auth/forgot-password');
  assert.strictEqual(bodyOf(call).email, 'admin@example.com');
  await waitFor(() => doc.getElementById('loginForm').classList.contains('active'), 2000);
  assert.ok(doc.getElementById('forgotForm') && !doc.getElementById('forgotForm').classList.contains('active'), '发送后应回到登录面板');

  // 返回按钮
  doc.getElementById('forgotLink').dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  const back = doc.getElementById('forgotBack');
  assert.ok(back, '应有返回登录按钮');
  back.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(doc.getElementById('loginForm').classList.contains('active'));
  assert.ok(!doc.getElementById('forgotForm').classList.contains('active'));
});

test('注册页：校验（必填/邮箱/密码/一致/条款）', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, {}, t);
  const { window } = dom;
  const doc = window.document;

  const fill = {
    name: 'Alice', email: 'alice@example.com', password: '12345678', confirmPassword: '12345678', terms: true,
  };
  const set = (k, v) => {
    if (k === 'terms') { doc.querySelector('#registerForm input[name=terms]').checked = v; return; }
    doc.querySelector(`#registerForm input[name=${k}]`).value = v;
  };

  // 空表单 → 必填 + 条款
  submitForm(window, 'registerForm');
  assert.strictEqual(fieldError(window, 'registerForm', 'name'), '此项为必填');
  assert.strictEqual(fieldError(window, 'registerForm', 'terms'), '请先阅读并同意注册说明');
  assert.ok(!findCall(calls, 'POST', '/api/auth/register'));

  // 密码过短 + 不一致
  Object.entries(fill).forEach(([k, v]) => set(k, k === 'password' ? '123' : k === 'confirmPassword' ? '456789' : v));
  submitForm(window, 'registerForm');
  assert.strictEqual(fieldError(window, 'registerForm', 'password'), '密码至少 8 位');
  assert.strictEqual(fieldError(window, 'registerForm', 'confirmPassword'), '两次输入的密码不一致');
  assert.ok(!findCall(calls, 'POST', '/api/auth/register'));

  // 邮箱格式
  Object.entries(fill).forEach(([k, v]) => set(k, k === 'email' ? 'bad' : v));
  submitForm(window, 'registerForm');
  assert.strictEqual(fieldError(window, 'registerForm', 'email'), '邮箱格式不正确');
  assert.ok(!findCall(calls, 'POST', '/api/auth/register'));
});

test('注册页：注册成功 → POST + 跳转首页', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, {}, t);
  const { window } = dom;
  const doc = window.document;

  doc.querySelector('[data-mode="register"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  doc.querySelector('#registerForm input[name=name]').value = 'Alice';
  doc.querySelector('#registerForm input[name=email]').value = 'alice@example.com';
  doc.querySelector('#registerForm input[name=password]').value = '12345678';
  doc.querySelector('#registerForm input[name=confirmPassword]').value = '12345678';
  doc.querySelector('#registerForm input[name=terms]').checked = true;
  submitForm(window, 'registerForm');
  await waitFor(() => window.__navigations.includes('/'));
  const call = findCall(calls, 'POST', '/api/auth/register');
  assert.strictEqual(bodyOf(call).name, 'Alice');
  assert.strictEqual(bodyOf(call).email, 'alice@example.com');
  assert.strictEqual(bodyOf(call).confirmPassword, '12345678');
});

test('注册页：注册失败 → 提示服务端错误', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, { registerFail: true });
  const { window } = dom;
  const doc = window.document;

  doc.querySelector('#registerForm input[name=name]').value = 'Alice';
  doc.querySelector('#registerForm input[name=email]').value = 'alice@example.com';
  doc.querySelector('#registerForm input[name=password]').value = '12345678';
  doc.querySelector('#registerForm input[name=confirmPassword]').value = '12345678';
  doc.querySelector('#registerForm input[name=terms]').checked = true;
  submitForm(window, 'registerForm');
  await waitForToast(window, /该邮箱已被注册/);
  assert.ok(!window.__navigations.includes('/'), '注册失败不应跳转');
});

test('注册开关：开启（operator）→ 展示注册说明', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, { registerEnabled: true, registerRole: 'operator' }, t);
  const { window } = dom;
  const doc = window.document;
  await waitFor(() => doc.querySelector('[data-mode="register"]') !== null);
  await waitFor(() => {
    const note = doc.querySelector('#registerForm .auth-note');
    return note && note.textContent.includes('默认可执行运营指令');
  });
  assert.ok(doc.querySelector('[data-mode="register"]'), '注册开启时应保留注册标签');
});

test('注册开关：开启（viewer）→ 只读说明', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, { registerEnabled: true, registerRole: 'viewer' }, t);
  const { window } = dom;
  const doc = window.document;
  await waitFor(() => {
    const note = doc.querySelector('#registerForm .auth-note');
    return note && note.textContent.includes('默认只读权限');
  });
});

test('注册开关：关闭 → 移除注册入口并提示', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, { registerEnabled: false }, t);
  const { window } = dom;
  const doc = window.document;
  await waitFor(() => !doc.querySelector('[data-mode="register"]'));
  assert.strictEqual(doc.querySelector('[data-mode="register"]'), null, '关闭后应移除注册标签');
  assert.strictEqual(doc.getElementById('registerForm'), null, '关闭后应移除注册表单');
  await waitFor(() => doc.querySelector('#loginForm .auth-note').textContent.includes('公开注册已关闭'));
  assert.ok(doc.querySelector('#loginForm .auth-note').textContent.includes('配置 ADMIN_EMAIL / ADMIN_PASSWORD'));
});

test('登录页：OAuth 按钮已隐藏（未接入不展示死按钮）', async (t) => {
  const calls = [];
  const dom = bootLogin(calls, {}, t);
  const { window } = dom;
  const doc = window.document;
  assert.strictEqual(doc.querySelector('.oauth-btn'), null, 'OAuth 按钮不应再显示');
});

// ===========================================================================
//  重置密码页：reset.html / reset.js
// ===========================================================================

test('重置页：无 token → 提示链接无效且不提交', async (t) => {
  const calls = [];
  const dom = bootReset(calls, { token: '' }, t);
  const { window } = dom;
  const doc = window.document;

  doc.querySelector('#resetForm input[name=password]').value = '12345678';
  doc.querySelector('#resetForm input[name=confirmPassword]').value = '12345678';
  submitForm(window, 'resetForm');
  await waitForToast(window, /重置链接无效，请重新申请/);
  assert.ok(!findCall(calls, 'POST', '/api/auth/reset-password'), '无 token 不应提交');
});

test('重置页：校验（密码长度 / 两次一致）', async (t) => {
  const calls = [];
  const dom = bootReset(calls, { token: 'abc' }, t);
  const { window } = dom;
  const doc = window.document;

  // 密码过短
  doc.querySelector('#resetForm input[name=password]').value = '123';
  doc.querySelector('#resetForm input[name=confirmPassword]').value = '123';
  submitForm(window, 'resetForm');
  assert.strictEqual(fieldError(window, 'resetForm', 'password'), '密码至少 8 位');
  assert.ok(!findCall(calls, 'POST', '/api/auth/reset-password'));

  // 不一致
  doc.querySelector('#resetForm input[name=password]').value = '12345678';
  doc.querySelector('#resetForm input[name=confirmPassword]').value = '87654321';
  submitForm(window, 'resetForm');
  assert.strictEqual(fieldError(window, 'resetForm', 'confirmPassword'), '两次输入的密码不一致');
  assert.ok(!findCall(calls, 'POST', '/api/auth/reset-password'));
});

test('重置页：成功 → POST + toast + 1.2s 后跳转登录页', async (t) => {
  const calls = [];
  const dom = bootReset(calls, { token: 'abc' }, t);
  const { window } = dom;
  const doc = window.document;

  doc.querySelector('#resetForm input[name=password]').value = '12345678';
  doc.querySelector('#resetForm input[name=confirmPassword]').value = '12345678';
  submitForm(window, 'resetForm');
  await waitForToast(window, /密码已重置，正在跳转登录/);
  const call = findCall(calls, 'POST', '/api/auth/reset-password');
  assert.strictEqual(bodyOf(call).token, 'abc');
  assert.strictEqual(bodyOf(call).password, '12345678');
  await waitFor(() => window.__navigations.includes('/login.html'), 4000);
});

test('重置页：失败 → 错误 toast + 按钮恢复', async (t) => {
  const calls = [];
  const dom = bootReset(calls, { token: 'expired', resetFail: true }, t);
  const { window } = dom;
  const doc = window.document;

  doc.querySelector('#resetForm input[name=password]').value = '12345678';
  doc.querySelector('#resetForm input[name=confirmPassword]').value = '12345678';
  submitForm(window, 'resetForm');
  await waitForToast(window, /重置链接无效或已过期/);
  const btn = doc.querySelector('#resetForm button[type=submit]');
  assert.strictEqual(btn.disabled, false, '失败后按钮应恢复');
  assert.strictEqual(btn.textContent, '重置密码', '失败后文案应恢复');
  assert.ok(!window.__navigations.includes('/login.html'), '失败不应跳转');
});
