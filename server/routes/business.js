// routes/business.js — 订单、活动、线索、报告、设置
const express = require('express');
const {
  listOrders,
  addOrder,
  updateOrder,
  deleteOrder,
  orderStats,
  listActivity,
  listLeads,
  promoteLead,
  listReports,
  addReport,
  getSettings,
  setSetting,
  addActivity,
  clearDemoData,
} = require('../db');
const { requireRole, isStringField, rejectInvalid, audit } = require('../middleware');
const events = require('../events');

const router = express.Router();

router.get('/api/orders', requireRole('operator', 'admin'), (req, res) => {
  const limit = Math.min(500, Math.max(1, +req.query.limit || 100));
  const offset = Math.max(0, +req.query.offset || 0);
  const status = String(req.query.status || 'all');
  const search = String(req.query.search || '').trim();
  res.json({ ok: true, data: listOrders({ limit, offset, status, search }) });
});

router.get('/api/orders/stats', requireRole('operator', 'admin'), (req, res) => {
  res.json({ ok: true, data: orderStats() });
});

router.post('/api/orders', requireRole('operator', 'admin'), (req, res) => {
  const data = req.body || {};
  if (!isStringField(data.orderNo, 80) || !data.orderNo.trim()) return rejectInvalid(req, res, 'orderNo', 'orderNo 必须为非空字符串且不超过 80 字符');
  if (data.status != null && !['pending','paid','shipped','delivered','cancelled'].includes(data.status)) return rejectInvalid(req, res, 'status', '非法订单状态');
  for (const field of ['customerName', 'channel', 'country', 'product', 'sku', 'trackingNo', 'carrier', 'note']) {
    if (data[field] != null && !isStringField(data[field], field === 'note' ? 500 : 200)) return rejectInvalid(req, res, field);
  }
  if (data.qty != null && (!Number.isFinite(Number(data.qty)) || Number(data.qty) < 1)) return rejectInvalid(req, res, 'qty', 'qty 必须为正数');
  if (data.amount != null && !Number.isFinite(Number(data.amount))) return rejectInvalid(req, res, 'amount', 'amount 必须为数字');
  try {
    const order = addOrder(data);
    addActivity({ tag: '订单', color: '#60a5fa', text: '订单变更 ' + order.orderNo, userId: req.user.id });
    audit(req, 'order_create', 'order', order.id);
    res.status(201).json({ ok: true, data: order });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.patch('/api/orders/:id', requireRole('operator', 'admin'), (req, res) => {
  const body = req.body || {};
  if (body.status != null && !['pending','paid','shipped','delivered','cancelled'].includes(body.status)) return rejectInvalid(req, res, 'status', '非法订单状态');
  for (const field of ['orderNo', 'customerName', 'channel', 'country', 'product', 'sku', 'trackingNo', 'carrier', 'note']) {
    if (body[field] != null && !isStringField(body[field], field === 'note' ? 500 : field === 'orderNo' ? 80 : 200)) return rejectInvalid(req, res, field);
  }
  if (body.qty != null && (!Number.isFinite(Number(body.qty)) || Number(body.qty) < 1)) return rejectInvalid(req, res, 'qty', 'qty 必须为正数');
  if (body.amount != null && !Number.isFinite(Number(body.amount))) return rejectInvalid(req, res, 'amount', 'amount 必须为数字');
  const order = updateOrder(req.params.id, body);
  if (!order) return res.status(404).json({ ok: false, error: '订单不存在' });
  addActivity({ tag: '订单', color: '#60a5fa', text: '订单更新 ' + order.orderNo, userId: req.user.id });
  audit(req, 'order_update', 'order', order.id);
  res.json({ ok: true, data: order });
});

router.delete('/api/orders/:id', requireRole('operator', 'admin'), (req, res) => {
  const ok = deleteOrder(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: '订单不存在' });
  audit(req, 'order_delete', 'order', req.params.id);
  res.json({ ok: true });
});

router.get('/api/activity', (req, res) => {
  const limit = Math.min(100, Math.max(1, +req.query.limit || 30));
  res.json({ ok: true, data: listActivity(limit) });
});

router.get('/api/events', (req, res) => {
  const canSeeBusiness = ['operator', 'admin'].includes(req.user.role);
  events.handleSse(req, res, {
    filter({ event }) {
      if (!canSeeBusiness && ['approval', 'command'].includes(event)) return false;
      return true;
    },
  });
});

router.get('/api/leads', requireRole('operator', 'admin'), (req, res) => {
  const grade = String(req.query.grade || 'all');
  if (!['all', 'hot', 'warm', 'cold'].includes(grade)) return res.status(400).json({ ok: false, error: '非法线索分级' });
  res.json({ ok: true, data: listLeads(grade, { role: req.user.role }) });
});

router.get('/api/leads/export.csv', requireRole('operator', 'admin'), (req, res) => {
  const leads = listLeads('all');
  const header = ['线索ID', '渠道', '客户', '地区', '原话', '意向', '分级', '得分', '时间', '状态'];
  const rows = leads.map(l => [l.id, l.channel, l.name, l.country, l.msg, l.intent, l.grade, l.score, l.time, l.status]);
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send('\ufeff' + csv);
});

router.post('/api/leads/:id/promote', requireRole('operator', 'admin'), (req, res) => {
  const row = promoteLead(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ ok: false, error: '线索不存在' });
  addActivity({ tag: '客服', color: '#34d399', text: `线索 ${row.id}「${row.name}」转入 CRM 跟进池`, userId: req.user.id });
  audit(req, 'lead_promote', 'lead', row.id);
  res.json({ ok: true, data: row });
});

router.get('/api/reports', (req, res) => {
  const limit = Math.min(100, Math.max(1, +req.query.limit || 20));
  res.json({ ok: true, data: listReports(limit) });
});

router.post('/api/reports', requireRole('operator', 'admin'), (req, res) => {
  const { agent, title, tag, color, content } = req.body || {};
  if (!isStringField(title, 300) || !title.trim()) return rejectInvalid(req, res, 'title', 'title 必须为非空字符串且不超过 300 字符');
  if (content != null && !isStringField(content, 8000)) return rejectInvalid(req, res, 'content', 'content 必须为字符串且不超过 8000 字符');
  if (agent != null && (!Number.isFinite(Number(agent)) || Number(agent) < 0)) return rejectInvalid(req, res, 'agent', 'agent 必须为非负数字');
  const report = addReport({ agent, title, tag, color, content, userId: req.user.id });
  res.status(201).json({ ok: true, data: report });
});

router.get('/api/settings', (req, res) => res.json({ ok: true, data: getSettings(req.user.id) }));

router.patch('/api/settings', requireRole('operator', 'admin'), (req, res) => {
  const { key, value } = req.body || {};
  if (!isStringField(key, 100) || !key.trim()) return rejectInvalid(req, res, 'key', 'key 必须为非空字符串且不超过 100 字符');
  let valueSize = 0;
  try { valueSize = JSON.stringify(value).length; } catch { return rejectInvalid(req, res, 'value', 'value 不是合法 JSON 值'); }
  if (valueSize > 10000) return rejectInvalid(req, res, 'value', 'value 序列化后不能超过 10000 字符');
  try {
    const settings = setSetting(req.user.id, key, value);
    audit(req, 'settings_update', 'setting', key);
    res.json({ ok: true, data: settings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/api/demo/clear', requireRole('admin'), (req, res) => {
  const result = clearDemoData();
  audit(req, 'clear_demo_data', 'system', null, result);
  res.json({ ok: true, data: result });
});

module.exports = router;
