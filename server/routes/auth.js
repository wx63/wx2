// routes/auth.js — 认证、注册与会话
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
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
  createPasswordReset,
  findPasswordResetByTokenHash,
  markPasswordResetUsed,
  updateUserPassword,
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

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function sendPasswordResetEmail(to, token, baseUrl) {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE !== 'false';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass) {
    return { ok: false, error: 'SMTP 未配置' };
  }
  const link = `${String(baseUrl || '').replace(/\/$/, '')}/reset.html?token=${encodeURIComponent(token)}`;
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  await transporter.sendMail({
    from,
    to,
    subject: '【跨境智能体】重置密码',
    text: [
      '你好：',
      '',
      '请点击以下链接重置你的登录密码（30 分钟内有效）：',
      link,
      '',
      '如果不是你本人操作，请忽略此邮件。',
      '（本邮件由跨境智能体自动发送）',
    ].join('\n'),
  });
  return { ok: true };
}

function createAuthRouter({ allowPublicRegister, defaultRegisterRole = 'viewer' }) {
  const router = express.Router();
  const registerRole = ['viewer', 'operator', 'admin'].includes(defaultRegisterRole) ? defaultRegisterRole : 'viewer';

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
    res.json({ ok: true, data: { enabled: allowPublicRegister, defaultRole: registerRole } });
  });

  router.post('/api/auth/forgot-password', registerLimiter, async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const user = validateEmail(email) ? findUserByEmail(email) : null;
    if (!user || user.status !== 'active') {
      logAudit({ action: 'forgot_password_request', metadata: { email, reason: 'not_found' }, ...requestMeta(req) });
      return res.json({ ok: true, message: '如果该邮箱已注册，重置邮件已发送' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    createPasswordReset({ email: user.email, tokenHash: tokenHash(token), expiresAt: Date.now() + 30 * 60 * 1000 });
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    try {
      const sent = await sendPasswordResetEmail(user.email, token, baseUrl);
      if (!sent.ok) return res.status(502).json({ ok: false, error: sent.error || '邮件发送失败' });
      logAudit({ userId: user.id, action: 'forgot_password_email', entityType: 'user', entityId: String(user.id), metadata: { email: user.email }, ...requestMeta(req) });
      return res.json({ ok: true, message: '如果该邮箱已注册，重置邮件已发送' });
    } catch (e) {
      console.error('[auth] forgot password email error:', e.message);
      return res.status(502).json({ ok: false, error: '邮件发送失败，请稍后重试或联系管理员' });
    }
  });

  router.post('/api/auth/reset-password', async (req, res) => {
    const { token, password, confirmPassword } = req.body || {};
    if (!token || typeof token !== 'string' || token.length > 500) {
      return res.status(400).json({ ok: false, error: '重置链接无效' });
    }
    const passwordString = typeof password === 'string' ? password : '';
    if (passwordString.length < 8 || passwordString.length > 128) {
      return res.status(400).json({ ok: false, error: '密码至少 8 位，最长 128 位' });
    }
    if (passwordString !== confirmPassword) {
      return res.status(400).json({ ok: false, error: '两次输入的密码不一致' });
    }
    const row = findPasswordResetByTokenHash(tokenHash(token));
    if (!row) return res.status(400).json({ ok: false, error: '重置链接无效或已过期' });
    const user = findUserByEmail(row.email);
    if (!user || user.status !== 'active') return res.status(400).json({ ok: false, error: '账号不存在或已停用' });
    updateUserPassword(user.id, bcrypt.hashSync(passwordString, 12));
    markPasswordResetUsed(row.id);
    logAudit({ userId: user.id, action: 'password_reset', entityType: 'user', entityId: String(user.id), metadata: { email: user.email }, ...requestMeta(req) });
    res.json({ ok: true, message: '密码已重置，请重新登录' });
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
        role: registerRole,
      });
    } catch (e) {
      if (String(e && e.message || '').includes('UNIQUE')) {
        logAudit({ action: 'register_failed', metadata: { reason: 'email_exists' }, ...requestMeta(req) });
        return res.status(409).json({ ok: false, error: '该邮箱已注册，请直接登录' });
      }
      throw e;
    }

    audit(req, 'register', 'user', String(user.id), { role: registerRole });
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
