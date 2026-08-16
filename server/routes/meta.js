// routes/meta.js — 规则、仪表盘、动作识别与 Agent 管理
const express = require('express');
const { detectAction, getPublicRules } = require('../rules');
const { listAgents, updateAgentStatus, updateAgentSkill, getDashboard } = require('../db');
const { requireRole, audit } = require('../middleware');

const router = express.Router();

router.get('/api/rules', (req, res) => res.json({ ok: true, data: getPublicRules() }));

router.get('/api/dashboard', (req, res) => {
  res.json({ ok: true, data: getDashboard(req.user.id, req.user.role) });
});

router.post('/api/actions/detect', (req, res) => {
  const command = req.body && req.body.command;
  if (!command || typeof command !== 'string' || command.length > 4000) return res.status(400).json({ ok: false, error: '缺少 command 字段或指令过长' });
  const action = detectAction(command);
  res.json({
    ok: true,
    data: {
      needsApproval: !!action,
      action: action ? action.action : null,
      label: action ? action.label : null,
      confidence: action ? action.confidence : null,
      needsReview: action ? !!action.needsReview : false,
      matched: action ? action.matched : null,
    },
  });
});

router.get('/api/agents', (req, res) => res.json({ ok: true, data: listAgents() }));

router.patch('/api/agents/:id', requireRole('operator', 'admin'), (req, res) => {
  const status = req.body && req.body.status;
  if (!['online', 'busy', 'offline'].includes(status)) return res.status(400).json({ ok: false, error: '非法 Agent 状态' });
  const row = updateAgentStatus(Number(req.params.id), status);
  if (!row) return res.status(404).json({ ok: false, error: 'Agent 不存在' });
  audit(req, 'agent_status_update', 'agent', String(req.params.id), { status });
  res.json({ ok: true, data: listAgents().find(a => a.id === Number(req.params.id)) });
});

router.patch('/api/agents/:id/skills/:skillIndex', requireRole('operator', 'admin'), (req, res) => {
  const enabled = !!(req.body && req.body.enabled);
  const agent = updateAgentSkill(Number(req.params.id), Number(req.params.skillIndex), enabled);
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent 或技能不存在' });
  audit(req, 'agent_skill_update', 'agent', String(req.params.id), { skillIndex: Number(req.params.skillIndex), enabled });
  res.json({ ok: true, data: agent });
});

module.exports = router;
