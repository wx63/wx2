// routes/auth.js — 认证、注册与会话
const express = require('express');
const bcrypt = require('bcryptjs');
const {
  toSafeUser,
  createUser,
  findUserByEmail,
  findUserById,
  updateLastLogin,
  logAudit,
  recordLoginFailure: recordLoginFailureDb,
  isLoginLocked: isLoginLockedDb,
  clearLoginFailures: clearLoginFailuresDb,
} = require('../db');
const { loginLimiter, registerLimiter, requireAuth, validateEmail, requestMeta, audit } = require('../middleware');

const FAKE_PASSWORD_HASH = bcrypt.hashSync('fake-password-for-timing', 12);
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

function isLoginLocked(key) {
  return isLoginLockedDb(key);
}

function recordLoginFailure(key) {
  return recordLoginFailureDb(key, { maxFailures: LOGIN_MAX_FAILURES, lockMs: LOGIN_LOCK_MS });
}

function clearLoginFailures(key) {
  return clearLoginFailuresDb(key);
}

function createAuthRouter({ allowPublicRegister }) {
  const router = express.Router();

  function safeUserResponse(req) {
    return req.user ? { ok: true, user: req.user } : { ok: false, error: '请先登录' };
  }

  function loginSession(req, user, cb) {
    req.session.regenerate(err => {
      if (err) return cb(err);
      req.session.userId = user.id;
      cb(null);
    });
  }

  router.get('/api/auth/register-status', (req, res) => {
    res.json({ ok: true, data: { enabled: allowPublicRegister, defaultRole: 'viewer' } });
  });

  router.post('/api/auth/register', registerLimiter, (req, res) => {
    if (!allowPublicRegister) {
      logAudit({ action: 'register_blocked', metadata: { reason: 'public_registration_disabled' }, ...requestMeta(req) });
      return res.status(403).json({ ok: false, error: '公开注册已关闭，请联系管理员创建账号' });
    }

    const { name, email, password, confirmPassword } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const passwordString = typeof password === 'string' ? password : '';
    const confirmString = typeof confirmPassword === 'string' ? confirmPassword : '';

    if (!validateEmail(normalizedEmail)) {
      logAudit({ action: 'register_failed', metadata: { reason: 'invalid_email' }, ...requestMeta(req) });
      return res.status(400).json({ ok: false, error: '邮箱格式不正确' });
    }
    if (passwordString.length < 8 || passwordString.length > 128) {
      logAudit({ action: 'register_failed', metadata: { reason: 'invalid_password' }, ...requestMeta(req) });
      return res.status(400).json({ ok: false, error: '密码至少 8 位，最长 128 位' });
    }
    if (passwordString !== confirmString) {
      logAudit({ action: 'register_failed', metadata: { reason: 'password_mismatch' }, ...requestMeta(req) });
      return res.status(400).json({ ok: false, error: '两次输入的密码不一致' });
    }
    if (findUserByEmail(normalizedEmail)) {
      logAudit({ action: 'register_failed', metadata: { reason: 'email_exists' }, ...requestMeta(req) });
      return res.status(409).json({ ok: false, error: '该邮箱已注册，请直接登录' });
    }

    let user;
    try {
      user = createUser({
        email: normalizedEmail,
        name: String(name || '').trim().slice(0, 80) || normalizedEmail.split('@')[0],
        passwordHash: bcrypt.hashSync(passwordString, 12),
        role: 'viewer',
      });
    } catch (e) {
      if (String(e && e.message || '').includes('UNIQUE')) {
        logAudit({ action: 'register_failed', metadata: { reason: 'email_exists' }, ...requestMeta(req) });
        return res.status(409).json({ ok: false, error: '该邮箱已注册，请直接登录' });
      }
      throw e;
    }

    audit(req, 'register', 'user', String(user.id), { role: 'viewer' });
    loginSession(req, user, (err) => {
      if (err) {
        return res.status(201).json({ ok: true, user: toSafeUser(user), message: '账号已创建，请登录' });
      }
      req.user = toSafeUser(findUserById(user.id));
      res.status(201).json({ ok: true, user: req.user });
    });
  });

  router.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const lockKey = `${req.ip}:${normalizedEmail}`;
    if (isLoginLocked(lockKey)) {
      logAudit({ action: 'login_locked', metadata: { email: normalizedEmail }, ...requestMeta(req) });
      return res.status(429).json({ ok: false, error: '尝试次数过多，请 15 分钟后再试' });
    }
    const user = validateEmail(normalizedEmail) ? findUserByEmail(normalizedEmail) : null;
    const passwordString = typeof password === 'string' ? password : '';
    if (!user || user.status !== 'active') {
      await bcrypt.compare(passwordString, FAKE_PASSWORD_HASH);
      recordLoginFailure(lockKey);
      logAudit({ action: 'login_failed', metadata: { email: normalizedEmail }, ...requestMeta(req) });
      return res.status(401).json({ ok: false, error: '邮箱或密码错误' });
    }
    if (!passwordString) {
      await bcrypt.compare(passwordString, FAKE_PASSWORD_HASH);
      recordLoginFailure(lockKey);
      logAudit({ userId: user.id, action: 'login_failed', entityType: 'user', entityId: String(user.id), ...requestMeta(req) });
      return res.status(401).json({ ok: false, error: '邮箱或密码错误' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      recordLoginFailure(lockKey);
      logAudit({ userId: user.id, action: 'login_failed', entityType: 'user', entityId: String(user.id), ...requestMeta(req) });
      return res.status(401).json({ ok: false, error: '邮箱或密码错误' });
    }
    clearLoginFailures(lockKey);
    loginSession(req, user, err => {
      if (err) return res.status(500).json({ ok: false, error: '登录失败，请稍后重试' });
      updateLastLogin(user.id);
      req.user = toSafeUser(findUserById(user.id));
      audit(req, 'login', 'user', String(user.id));
      res.json(safeUserResponse(req));
    });
  });

  router.post('/api/auth/logout', (req, res) => {
    const userId = req.session.userId;
    req.session.destroy(() => {
      res.clearCookie('oc.sid');
      logAudit({ userId, action: 'logout', entityType: 'user', entityId: userId ? String(userId) : null, ...requestMeta(req) });
      res.json({ ok: true });
    });
  });

  router.get('/api/auth/me', requireAuth, (req, res) => res.json(safeUserResponse(req)));

  return router;
}

module.exports = { createAuthRouter };
