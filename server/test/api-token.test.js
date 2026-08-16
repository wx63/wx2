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
process.env.API_TOKEN = 'test-api-token-0123456789abcdef';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-api-token-test-'));
process.env.OPENCLAW_DATA_DIR = path.join(tmp, 'data');
process.env.OPENCLAW_DB_PATH = path.join(tmp, 'data', 'app.db');
process.env.OPENCLAW_KB_DIR = path.join(tmp, 'kb');
fs.mkdirSync(process.env.OPENCLAW_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OPENCLAW_KB_DIR, { recursive: true });

const app = require('../index');

let server;
let base;

test.before(async () => {
  server = await new Promise((resolve, reject) => {
    const s = app.listen(0, () => resolve(s));
    s.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  try { server && server.close(); } catch (_) {}
});

test('API token bearer grants admin machine identity without session cookie', async () => {
  const resp = await fetch(base + '/api/health', {
    headers: { Authorization: 'Bearer test-api-token-0123456789abcdef' },
  });
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
  assert.equal(resp.headers.get('set-cookie'), null);
});

test('API token accepts X-API-Token header', async () => {
  const resp = await fetch(base + '/api/health', {
    headers: { 'X-API-Token': 'test-api-token-0123456789abcdef' },
  });
  assert.equal(resp.status, 200);
});

test('API token rejects missing and wrong tokens', async () => {
  const missing = await fetch(base + '/api/health');
  assert.equal(missing.status, 401);

  const wrong = await fetch(base + '/api/health', {
    headers: { Authorization: 'Bearer wrong-token' },
  });
  assert.equal(wrong.status, 401);
});

test('API token write requests bypass same-origin guard', async () => {
  const resp = await fetch(base + '/api/command', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-api-token-0123456789abcdef',
      Origin: 'http://evil.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command: '生成本周竞品周报' }),
  });
  assert.equal(resp.status, 202);
  const body = await resp.json();
  assert.equal(body.ok, true);
});

test('API token request reaches admin-only routes', async () => {
  const resp = await fetch(base + '/api/commands', {
    headers: { Authorization: 'Bearer test-api-token-0123456789abcdef' },
  });
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.ok, true);
});

