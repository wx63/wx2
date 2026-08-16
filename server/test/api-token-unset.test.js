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
delete process.env.API_TOKEN;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-no-api-token-test-'));
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

test('without API_TOKEN configured, bearer headers do not grant access', async () => {
  const resp = await fetch(base + '/api/health', {
    headers: { Authorization: 'Bearer any-token-should-not-work' },
  });
  assert.equal(resp.status, 401);
});

