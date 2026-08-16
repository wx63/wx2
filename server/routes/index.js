// routes/index.js — API 路由聚合：公开认证 → 登录保护 → 各业务域
const express = require('express');
const { requireAuth } = require('../middleware');
const { createAuthRouter } = require('./auth');
const healthRouter = require('./health');
const metaRouter = require('./meta');
const businessRouter = require('./business');
const kbRouter = require('./kb');
const { createCommandsRouter } = require('./commands');
const integrationsRouter = require('./integrations');
const { createAgentRunsRouter } = require('./agent-runs');
const approvalsRouter = require('./approvals');

function createApiRouter({ allowPublicRegister, defaultRegisterRole = 'viewer', enqueueCommand }) {
  const router = express.Router();
  router.use(createAuthRouter({ allowPublicRegister, defaultRegisterRole }));
  router.use('/api', requireAuth);
  router.use(healthRouter);
  router.use(metaRouter);
  router.use(businessRouter);
  router.use(kbRouter);
  router.use(createCommandsRouter({ enqueueCommand }));
  router.use(integrationsRouter);
  router.use(createAgentRunsRouter({ enqueueCommand }));
  router.use(approvalsRouter);
  return router;
}

module.exports = { createApiRouter };
