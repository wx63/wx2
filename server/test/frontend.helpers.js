'use strict';

// 前端测试共享工具：jsdom 启动 + SSE 模拟 + 导航捕获
// 说明：
//  - jsdom 无法覆盖 window.location（不可配置），因此用「源码级导航捕获」：
//    把 `window.location.href = "X"` / `window.location.assign("X")` 改写为
//    `window.__navigations.push("X")`，从 Node 侧预置 `window.__navigations = []`。
//    读取（如 reset.js 的 `window.location.search`）不受影响。
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');

const readPublic = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const appHtml = () => readPublic('index.html');
const appJs = () => readPublic('app.js');
const loginHtml = () => readPublic('login.html');
const loginJs = () => readPublic('login.js');
const resetHtml = () => readPublic('reset.html');
const resetJs = () => readPublic('reset.js');

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

const NAV_CAPTURE_RE = /window\.location\.(?:href|assign)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

function injectNavCapture(js) {
  return js.replace(NAV_CAPTURE_RE, (m, url) => 'window.__navigations.push(' + url + ')');
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
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw lastError || new Error('waitFor timeout');
}

/**
 * 启动一个 jsdom 页面并注入前端脚本。
 * @param {object} opts
 *   html {string}          页面 HTML
 *   js {string}            页面 JS（注入前自动做导航捕获改写）
 *   url {string}           jsdom URL（影响 window.location.search 等）
 *   fetchHandler {function} window.fetch 实现
 *   setup {function}       在注入脚本前同步设置 window 的钩子
 * @returns {JSDOM}
 */
function bootJSDOM({ html, js, url, fetchHandler, setup }) {
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.TextDecoder = TextDecoder;
  window.TextEncoder = TextEncoder;
  window.confirm = () => true;
  window.__navigations = [];
  if (fetchHandler) window.fetch = fetchHandler;
  if (setup) setup(window);
  const script = window.document.createElement('script');
  script.textContent = injectNavCapture(js);
  window.document.body.appendChild(script);
  return dom;
}

module.exports = {
  ROOT,
  readPublic,
  appHtml,
  appJs,
  loginHtml,
  loginJs,
  resetHtml,
  resetJs,
  jsonResponse,
  sseChunk,
  sseResponse,
  injectNavCapture,
  waitFor,
  bootJSDOM,
};
