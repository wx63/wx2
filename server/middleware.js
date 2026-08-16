// middleware.js — 路由共享中间件与校验工具
const rateLimit = require('express-rate-limit');
const { logAudit } = require('./db');

function requestMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') || '' };
}

function audit(req, action, entityType, entityId, metadata) {
  try {
    logAudit({ userId: req.user && req.user.id, action, entityType, entityId, metadata, ...requestMeta(req) });
  } catch (e) {
    console.warn('[audit] failed:', e.message);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: '请先登录' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ ok: false, error: '权限不足' });
    next();
  };
}

function makeLimiter({ windowMs, max, keyGenerator }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => res.status(429).json({ ok: false, error: '请求过于频繁，请稍后再试' }),
  });
}

const ipKey = (req) => rateLimit.ipKeyGenerator(req.ip);
const userOrIpKey = (req) => req.user ? `user:${req.user.id}` : `ip:${rateLimit.ipKeyGenerator(req.ip)}`;
const limitScale = process.env.NODE_ENV === 'test' ? 1000 : 1;
const loginLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 5 * limitScale, keyGenerator: ipKey });
const registerLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 20 * limitScale, keyGenerator: ipKey });
const commandLimiter = makeLimiter({ windowMs: 10 * 60 * 1000, max: 10 * limitScale, keyGenerator: userOrIpKey });
const kbQueryLimiter = makeLimiter({ windowMs: 10 * 60 * 1000, max: 30 * limitScale, keyGenerator: userOrIpKey });

function validateEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStringField(value, max = 4000) {
  return typeof value === 'string' && value.length <= max;
}

function rejectInvalid(req, res, field, error = '字段类型或长度不正确') {
  audit(req, 'invalid_payload', 'request', null, { field });
  return res.status(400).json({ ok: false, error });
}

module.exports = {
  requestMeta,
  audit,
  requireAuth,
  requireRole,
  makeLimiter,
  loginLimiter,
  registerLimiter,
  commandLimiter,
  kbQueryLimiter,
  validateEmail,
  isStringField,
  rejectInvalid,
  ipKey,
  userOrIpKey,
};
