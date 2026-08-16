// request-logger.js — 请求日志与慢请求观测
function createRequestLogger({ logAudit, slowMs = 20000 } = {}) {
  return (req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/events') return;
      const durationMs = Date.now() - startedAt;
      console.log(`[req] ${req.method} ${req.path} ${res.statusCode} ${durationMs}ms${req.user ? ' user=' + req.user.id : ''}`);
      if (durationMs >= slowMs) {
        try {
          logAudit({
            action: 'slow_request',
            userId: req.user && req.user.id,
            metadata: { method: req.method, path: req.path, status: res.statusCode, durationMs },
          });
        } catch (e) {
          console.warn('[request-logger] slow audit failed:', e.message);
        }
      }
    });
    next();
  };
}

module.exports = { createRequestLogger };
