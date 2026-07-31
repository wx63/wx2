/**
 * bridge.js — OpenClaw 桥接层
 *
 * 作用：把前端的指令转发给 OpenClaw Gateway 的 HTTP API（/v1/chat/completions），
 *       拿回真实执行结果。审批闸门的数据也在这里持久化。
 *
 * Gateway 地址/Token 从环境变量读取，未设置时自动从 openclaw.json 读取。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- 配置 ----------
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || readGatewayToken();

function readGatewayToken() {
  try {
    const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    return cfg.gateway?.auth?.token || '';
  } catch (e) {
    return '';
  }
}

// ---------- 对外动作规则（审批闸门判定） ----------
// 与前端 app.js 的 ACTION_RULES 保持一致：命中即需要人工审批
const ACTION_RULES = [
  { keywords: ['发帖', '发推', '发布', '发消息', '回复客户', '回复买家', '推广帖', '推文', '发一条', '发个', '发一个', '发新品', '发广告'], action: 'social_post', label: '社媒发帖/回复' },
  { keywords: ['上架', '上新产品', '提交 listing', '提交listing', '上传产品', '上架产品'], action: 'listing_submit', label: '商品上架' },
  { keywords: ['下单', '购买', '采购', '进货'], action: 'purchase', label: '采购/下单' },
  { keywords: ['退款', '退钱', '赔偿', '补偿'], action: 'refund', label: '退款/赔偿' },
];

/** 判断一条指令是否属于"对外动作"（需要审批） */
function detectAction(cmd) {
  const lower = (cmd || '').toLowerCase();
  for (const rule of ACTION_RULES) {
    if (rule.keywords.some(k => lower.includes(k.toLowerCase()))) {
      return rule;
    }
  }
  return null;
}

/**
 * 调用 OpenClaw Gateway 执行指令（真实执行）
 * @param {string} prompt  用户的指令
 * @param {object} opts    { sessionId?, agentId? }
 * @returns {Promise<{ok: boolean, content: string, raw: object}>}
 */
async function runAgent(prompt, opts = {}) {
  const agentId = opts.agentId || 'main';
  const body = {
    model: `openclaw/${agentId}`,
    messages: [
      {
        role: 'system',
        content:
          '你是OpenClaw跨境运营平台的核心执行引擎（运营总监）。' +
          '用户通过平台前端给你下达运营指令。请真实执行：分析、搜索、生成内容。' +
          '重要：这是外部系统调用，不要输出任何解释性的开场白或"好的，我来帮你"之类的废话，' +
          '直接给出任务结果。如果指令是"对外动作"（发帖/回复/上架/下单/退款），' +
          '不要真的执行，而是输出一份执行方案（含内容草稿、目标平台、风险提示），等待人工审批。',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2000,
    stream: false,
  };

  if (opts.sessionId) body.session_id = opts.sessionId;

  const resp = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await resp.json();
  if (!resp.ok) {
    return { ok: false, error: raw.error?.message || `HTTP ${resp.status}`, raw };
  }
  const content = raw.choices?.[0]?.message?.content || '';
  return { ok: true, content, raw };
}

module.exports = { runAgent, detectAction, GATEWAY_URL };
