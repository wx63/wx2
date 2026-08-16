// routes/health.js — 健康检查
const express = require('express');
const bridge = require('../bridge');

const router = express.Router();

router.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'ecommerce-agent-server',
    time: new Date().toISOString(),
    model: bridge.DIRECT_MODEL,
    directConfigured: !!(bridge.PROVIDER.baseUrl && bridge.PROVIDER.apiKey),
    gatewayConfigured: !!bridge.GATEWAY_URL,
  });
});

module.exports = router;
