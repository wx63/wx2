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
 * @param {object} opts    { sessionId?, agentId?, noTools? }
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
          '用户通过平台前端给你下达运营指令。请直接基于你已有的行业知识与平台数据真实执行：分析、生成内容。' +
          '重要规则：\n' +
          '1. 这是外部系统调用，不要输出任何解释性的开场白或"好的，我来帮你"之类的废话，直接给出任务结果。\n' +
          '2. 不要调用搜索或网页抓取工具（web_search/web_fetch），这些通道不稳定会拖慢响应；用你已有的知识回答即可。\n' +
          '3. 如果指令是"对外动作"（发帖/回复/上架/下单/退款），不要真的执行，而是输出一份执行方案（含内容草稿、目标平台、风险提示），等待人工审批。',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2000,
    // 降低推理强度：运营指令多为执行/生成类，不需要深度推理，可大幅降速
    reasoning_effort: 'low',
    // 禁用工具调用：避免 agent 自行触发 web_search/web_fetch 导致长时间挂起
    tool_choice: 'none',
    stream: false,
  };

  if (opts.sessionId) body.session_id = opts.sessionId;

  // 90s 超时：业务题（市场分析等）经 OpenClaw main agent 常需 25-40s，
  // 偶发慢请求 50-80s；60s 太紧会误杀正常的长任务。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const resp = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      // 关键修复：用 Buffer 显式按 UTF-8 编码 body。
      // Node fetch 对 string body 默认按 latin1 处理，中文会被损坏成乱码，
      // 模型收到乱码后 thinking 卡在"解码乱码"上耗尽 token 仍不产出正文，
      // 触发 OpenClaw 的 non_deliverable_terminal_turn（约 60% 失败率）。
      // 改用 Buffer 后中文正常到达，失败率从 ~60% 降到 0（连测 5/5 + 业务题成功）。
      body: Buffer.from(JSON.stringify(body), 'utf8'),
      signal: ctrl.signal,
    });

    const raw = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: raw.error?.message || `HTTP ${resp.status}`, raw };
    }
    const content = raw.choices?.[0]?.message?.content || '';
    // OpenClaw 在 agent 无法产出时会返回固定占位文，识别后自动重试（最多 2 次）。
    // 业务题偶发 non_deliverable_terminal_turn（模型 thinking 跑飞不产正文），
    // 重试常能过；且占位文有时 50-80s 才返回，重试虽然慢但能拿到结果。
    const PLACEHOLDER = '⚠️ Agent couldn\'t generate a response';
    if (content.trim().startsWith(PLACEHOLDER)) {
      const used = opts._retry || 0;
      if (used < 2) {
        return runAgent(prompt, { ...opts, _retry: used + 1 });
      }
      return { ok: false, error: 'Agent 暂时无法生成响应，请稍后重试或换种问法', raw };
    }
    return { ok: true, content, raw };
  } catch (e) {
    const aborted = e.name === 'AbortError' || e.code === 'UND_ERR_HEADERS_TIMEOUT';
    return { ok: false, error: aborted ? 'Gateway 响应超时（90s），请稍后重试或简化指令' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { runAgent, detectAction, GATEWAY_URL };
