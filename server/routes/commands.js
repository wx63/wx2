// routes/commands.js — 异步指令提交、状态查询与流式输出
const express = require('express');
const { getCommand, recentCommands, getApproval, getAgentRun, createCommandJob } = require('../db');
const { detectAction } = require('../rules');
const { commandLimiter, requireRole, audit } = require('../middleware');
const events = require('../events');

function commandResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    command: row.command,
    content: row.content,
    error: row.error,
    needsApproval: row.needsApproval,
    approvalId: row.approvalId,
    approval: row.approvalId ? getApproval(row.approvalId) : null,
    run: row.runId ? getAgentRun(row.runId) : null,
    durationMs: row.durationMs,
    promptCacheHitTokens: row.promptCacheHitTokens,
    promptCacheMissTokens: row.promptCacheMissTokens,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function createCommandsRouter({ enqueueCommand }) {
  const router = express.Router();

  router.post('/api/command', commandLimiter, requireRole('operator', 'admin'), (req, res) => {
    const { command, agentId } = req.body || {};
    if (!command || typeof command !== 'string' || command.length > 4000) {
      return res.status(400).json({ ok: false, error: '缺少 command 字段或指令过长' });
    }

    const action = detectAction(command);
    const meta = {
      command,
      agentId: agentId || 'main',
      sessionId: `user-${req.user.id}`,
      userId: req.user.id,
      needsApproval: !!action,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    };
    const commandId = createCommandJob(meta);
    const wantsStream = (req.body && req.body.stream === true) || req.query.stream === '1';
    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      let finished = false;
      const writeEvent = (event, payload) => {
        if (finished || res.writableEnded) return;
        try {
          res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        } catch (_) {}
      };
      writeEvent('accepted', { ok: true, commandId, status: 'queued' });
      const streamMeta = {
        ...meta,
        onDelta: (delta) => writeEvent('delta', { content: String(delta || '') }),
        onComplete: (payload) => {
          if (finished) return;
          writeEvent('complete', payload);
          writeEvent('done', {});
          finished = true;
          res.end();
        },
      };
      enqueueCommand(commandId, streamMeta);
      req.on('close', () => { finished = true; });
      audit(req, 'command_queued', 'command', String(commandId), { needsApproval: !!action, stream: true });
      return;
    }

    enqueueCommand(commandId, meta);
    events.publish('command', { commandId, status: 'queued' });
    audit(req, 'command_queued', 'command', String(commandId), { needsApproval: !!action });
    res.status(202).json({ ok: true, commandId, status: 'queued' });
  });

  router.get('/api/commands/:id', requireRole('operator', 'admin'), (req, res) => {
    const row = getCommand(Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: '命令不存在' });
    if (req.user.role !== 'admin' && row.userId !== req.user.id) return res.status(403).json({ ok: false, error: '权限不足' });
    res.json({ ok: true, data: commandResponse(row) });
  });

  router.get('/api/commands', requireRole('admin'), (req, res) => {
    const limit = Math.min(200, Math.max(1, +req.query.limit || 50));
    res.json({ ok: true, data: recentCommands(limit).map(commandResponse) });
  });

  router.get('/api/commands/:id/run', requireRole('operator', 'admin'), (req, res) => {
    const row = getCommand(Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: '命令不存在' });
    if (req.user.role !== 'admin' && row.userId !== req.user.id) return res.status(403).json({ ok: false, error: '权限不足' });
    res.json({ ok: true, data: row.runId ? getAgentRun(row.runId) : null });
  });

  return router;
}

module.exports = { createCommandsRouter, commandResponse };
