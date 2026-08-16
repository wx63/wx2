// routes/agent-runs.js — Agent 运行记录、取消与重跑
const express = require('express');
const {
  getAgentRun,
  listAgentRuns,
  markAgentRunCancelled,
  updateAgentStatus,
  createCommandJob,
} = require('../db');
const { detectAction } = require('../rules');
const { requireRole, audit } = require('../middleware');

function createAgentRunsRouter({ enqueueCommand }) {
  const router = express.Router();

  router.get('/api/agent-runs', requireRole('operator', 'admin'), (req, res) => {
    const limit = Math.min(200, Math.max(1, +req.query.limit || 50));
    const offset = Math.max(0, +req.query.offset || 0);
    const status = String(req.query.status || 'all');
    const search = String(req.query.search || '').trim();
    res.json({ ok: true, data: listAgentRuns({ limit, offset, status, search, userId: req.user.id, role: req.user.role }) });
  });

  router.post('/api/agent-runs/:id/cancel', requireRole('operator', 'admin'), (req, res) => {
    const run = getAgentRun(Number(req.params.id));
    if (!run) return res.status(404).json({ ok: false, error: '运行不存在' });
    if (req.user.role !== 'admin' && run.userId != null && run.userId !== req.user.id) return res.status(403).json({ ok: false, error: '权限不足' });
    if (!['queued', 'running'].includes(run.status)) return res.status(400).json({ ok: false, error: '仅 queued/running 可取消' });
    const cancelled = markAgentRunCancelled(run.id, req.user.id, '已由用户取消');
    if (run.context && run.context.agentId != null) updateAgentStatus(run.context.agentId, 'online', '待命');
    audit(req, 'agent_run_cancel', 'agent_run', String(run.id));
    res.json({ ok: true, data: cancelled });
  });

  router.post('/api/agent-runs/:id/rerun', requireRole('operator', 'admin'), (req, res) => {
    const run = getAgentRun(Number(req.params.id));
    if (!run) return res.status(404).json({ ok: false, error: 'Agent 运行记录不存在' });
    if (req.user.role !== 'admin' && run.userId != null && run.userId !== req.user.id) return res.status(403).json({ ok: false, error: '权限不足' });
    const sessionId = run.context && run.context.sessionId ? run.context.sessionId : 'user-' + req.user.id;
    const needsApproval = !!detectAction(run.command);
    const meta = { userId: req.user.id, command: run.command, agentId: run.agentId || 'main', sessionId, needsApproval, ip: req.ip, userAgent: req.get('user-agent') || '' };
    const commandId = createCommandJob(meta);
    enqueueCommand(commandId, meta);
    audit(req, 'agent_run_rerun', 'agent_run', String(run.id), { commandId });
    res.status(202).json({ ok: true, commandId, status: 'queued' });
  });

  return router;
}

module.exports = { createAgentRunsRouter };
