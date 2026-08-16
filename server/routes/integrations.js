// routes/integrations.js — 飞书通道
const express = require('express');
const feishu = require('../feishu');
const { requireRole, isStringField, rejectInvalid, audit } = require('../middleware');

const router = express.Router();

router.get('/api/integrations/feishu', requireRole('operator', 'admin'), (req, res) => {
  res.json({ ok: true, data: feishu.getStatus() });
});

router.post('/api/integrations/feishu/send', requireRole('operator', 'admin'), async (req, res) => {
  const { chatId, text } = req.body || {};
  if (!isStringField(chatId, 200) || !chatId.trim()) return rejectInvalid(req, res, 'chatId', 'chatId 必须为非空字符串且不超过 200 字符');
  if (!isStringField(text, 4000) || !text.trim()) return rejectInvalid(req, res, 'text', 'text 必须为非空字符串且不超过 4000 字符');
  try {
    const result = await feishu.sendText(String(chatId), String(text));
    audit(req, 'feishu_send', 'feishu_message', null, { chatId });
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(502).json({ ok: false, error: '飞书发送失败：' + e.message });
  }
});

module.exports = router;
