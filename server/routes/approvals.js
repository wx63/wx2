// routes/approvals.js — 审批中心与执行器适配器
const express = require('express');
const { getApproval, listApprovals, decideApproval } = require('../db');
const { requireRole, audit } = require('../middleware');
const { executeApproval, listExecutors } = require('../executors');

const router = express.Router();

router.get('/api/approvals', requireRole('operator', 'admin'), (req, res) => {
  res.json({ ok: true, data: listApprovals({ userId: req.user.id, role: req.user.role }) });
});

router.post('/api/approvals/:id/decide', requireRole('operator', 'admin'), (req, res) => {
  const { id } = req.params;
  const { decision } = req.body || {};
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ ok: false, error: 'decision 必须是 approve 或 reject' });
  const item = getApproval(id);
  if (!item) return res.status(404).json({ ok: false, error: '审批条目不存在' });
  if (item.status !== 'pending') return res.status(400).json({ ok: false, error: '该审批条目已处理，请刷新审批中心' });
  const updated = decideApproval({ id, decision, userId: req.user.id });
  const { addActivity } = require('../db');
  addActivity({ tag: '审批', color: decision === 'approve' ? '#34d399' : '#fb7185', text: `${decision === 'approve' ? '批准并归档' : '驳回'} #${id}`, userId: req.user.id });
  audit(req, 'approval_decide', 'approval', id, { decision });
  res.json({ ok: true, data: updated });
});

router.post('/api/approvals/:id/execute', requireRole('operator', 'admin'), async (req, res) => {
  const { id } = req.params;
  const item = getApproval(id);
  if (!item) return res.status(404).json({ ok: false, error: '审批条目不存在' });
  if (item.status !== 'approved') return res.status(400).json({ ok: false, error: '仅已批准并归档可执行' });
  const result = await executeApproval(item);
  res.json({ ok: false, executed: false, error: result.reason, data: item, adapter: result.adapter, adapters: listExecutors() });
});

module.exports = router;
