/**
 * bridge.js — OpenClaw 桥接层
 *
 * 作用：把前端的指令转发给模型 provider 执行，拿回真实结果。审批闸门的数据也在这里持久化。
 *
 * 调用策略（2026-08-03 优化）：
 *   快路径 = 直连模型 provider（shuyanai/qwen3.6-flash），绕过 OpenClaw Gateway。
 *     实测 11-17s 出结果、5/5 成功；Gateway 路径要 26-56s 且 ~40% 失败
 *     （main agent 16k 上下文开销 + 偶发 non_deliverable_terminal_turn）。
 *   慢路径兜底 = 直连网络/HTTP 错误时，退回 OpenClaw Gateway（保留 agent 能力）。
 *
 * 配置从 ~/.openclaw/agents/main/agent/models.json 读，环境变量可覆盖。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- 配置 ----------
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || readGatewayToken();

// 快路径默认模型：非 reasoning、响应快、稳定。可用 env 覆盖。
// 形如 "deepseek/deepseek-chat"：前缀 = models.json 里的 provider 名，后缀 = model id。
// deepseek 官方 deepseek-chat（reasoning:false）实测 7-17s、5/5 稳定，比走 Gateway 快 2-5 倍。
const DIRECT_MODEL = process.env.OPENCLAW_DIRECT_MODEL || 'deepseek/deepseek-chat';
const DIRECT_TIMEOUT_MS = +process.env.OPENCLAW_DIRECT_TIMEOUT_MS || 30000;
const GATEWAY_TIMEOUT_MS = +process.env.OPENCLAW_GATEWAY_TIMEOUT_MS || 60000;

function readGatewayToken() {
  try {
    const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    return cfg.gateway?.auth?.token || '';
  } catch (e) {
    return '';
  }
}

/**
 * 按 DIRECT_MODEL 前缀（provider 名）从 models.json 读 baseUrl + apiKey。
 * env 可覆盖：OPENCLAW_PROVIDER_BASE_URL / OPENCLAW_PROVIDER_API_KEY
 */
function pickProviderValue(obj, keys) {
  for (const k of keys) {
    if (obj && typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
  }
  return '';
}

function defaultProviderBaseUrl(providerName) {
  if (providerName === 'deepseek') return 'https://api.deepseek.com/v1';
  return '';
}

function readProviderConfig() {
  const providerName = DIRECT_MODEL.split('/')[0]; // deepseek / shuyanai
  const cfg = {
    baseUrl: process.env.OPENCLAW_PROVIDER_BASE_URL || '',
    apiKey: process.env.OPENCLAW_PROVIDER_API_KEY || (providerName === 'deepseek' ? process.env.DEEPSEEK_API_KEY : '') || '',
  };
  if (cfg.baseUrl && cfg.apiKey) return cfg;
  try {
    const p = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'models.json');
    const m = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const prov = m.providers?.[providerName] || {};
    return {
      baseUrl: cfg.baseUrl || pickProviderValue(prov, ['baseUrl', 'baseURL', 'base_url', 'url', 'apiBase', 'api_base']) || defaultProviderBaseUrl(providerName),
      apiKey: cfg.apiKey || pickProviderValue(prov, ['apiKey', 'api_key', 'key', 'token']),
    };
  } catch (e) {
    return { ...cfg, baseUrl: cfg.baseUrl || defaultProviderBaseUrl(providerName) };
  }
}

const PROVIDER = readProviderConfig();

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

const SYSTEM_PROMPT =
  '你是OpenClaw跨境运营平台的核心执行引擎（运营总监）。' +
  '用户通过平台前端给你下达运营指令。请直接基于你已有的行业知识与平台数据真实执行：分析、生成内容。' +
  '重要规则：\n' +
  '1. 这是外部系统调用，不要输出任何解释性的开场白或"好的，我来帮你"之类的废话，直接给出任务结果。\n' +
  '2. 不要调用 web_search/web_fetch；实时价格/公开信息查询应使用平台提供的 price_lookup 内部工具；未提供该工具时不得假装联网，直接说明没有实时数据。\n' +
  '3. 如果指令是"对外动作"（发帖/回复/上架/下单/退款），不要真的执行，而是输出一份执行方案（含内容草稿、目标平台、风险提示），等待人工审批。';

/**
 * 快路径：直连模型 provider（绕过 OpenClaw Gateway）。
 * 用非 reasoning 模型，无 agent 16k 上下文开销，实测 11-17s 稳定。
 */
async function runDirect(prompt, opts = {}) {
  if (!PROVIDER.baseUrl || !PROVIDER.apiKey) {
    return { ok: false, error: `直连 provider 配置不完整：缺少 ${!PROVIDER.baseUrl ? 'baseUrl' : 'apiKey'}`, _fallbackable: true };
  }
  // DIRECT_MODEL 形如 "deepseek/deepseek-chat" → modelId=deepseek-chat
  const slash = DIRECT_MODEL.indexOf('/');
  const modelId = slash >= 0 ? DIRECT_MODEL.slice(slash + 1) : DIRECT_MODEL;
  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2000,
    stream: false,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DIRECT_TIMEOUT_MS);
  try {
    const resp = await fetch(`${PROVIDER.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${PROVIDER.apiKey}`,
      },
      body: Buffer.from(JSON.stringify(body), 'utf8'),
      signal: ctrl.signal,
    });
    const raw = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: raw.error?.message || raw.error || `HTTP ${resp.status}`, _fallbackable: resp.status >= 500 || resp.status === 429 };
    }
    const content = raw.choices?.[0]?.message?.content || '';
    if (!content.trim()) {
      return { ok: false, error: '模型未返回内容', _fallbackable: true };
    }
    const u = raw.usage || {};
    return {
      ok: true, content, raw,
      _meta: { path: 'direct', model: DIRECT_MODEL, baseUrl: PROVIDER.baseUrl, promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens },
    };
  } catch (e) {
    const aborted = e.name === 'AbortError' || e.code === 'UND_ERR_HEADERS_TIMEOUT';
    return { ok: false, error: aborted ? `直连超时（${DIRECT_TIMEOUT_MS / 1000}s）` : e.message, _fallbackable: aborted || e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 慢路径兜底：经 OpenClaw Gateway（保留 agent 能力，但慢且偶发 non_deliverable）。
 */
async function runViaGateway(prompt, opts = {}) {
  const agentId = opts.agentId || 'main';
  const body = {
    model: `openclaw/${agentId}`,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2000,
    reasoning_effort: 'low',
    tool_choice: 'none',
    stream: false,
  };
  if (opts.sessionId) body.session_id = opts.sessionId;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const resp = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      // Buffer UTF-8：Node fetch 对 string body 默认 latin1，中文会乱码
      // → 模型 thinking 卡在解码乱码 → non_deliverable_terminal_turn
      body: Buffer.from(JSON.stringify(body), 'utf8'),
      signal: ctrl.signal,
    });
    const raw = await resp.json();
    if (!resp.ok) {
      return { ok: false, error: raw.error?.message || `HTTP ${resp.status}`, raw };
    }
    const content = raw.choices?.[0]?.message?.content || '';
    const PLACEHOLDER = '⚠️ Agent couldn\'t generate a response';
    if (content.trim().startsWith(PLACEHOLDER)) {
      const used = opts._retry || 0;
      if (used < 1) {
        return runViaGateway(prompt, { ...opts, _retry: used + 1 });
      }
      return { ok: false, error: 'Agent 暂时无法生成响应，请稍后重试或换种问法', raw };
    }
    const u = raw.usage || {};
    return {
      ok: true, content, raw,
      _meta: { path: 'gateway', model: `openclaw/${agentId}`, promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens },
    };
  } catch (e) {
    const aborted = e.name === 'AbortError' || e.code === 'UND_ERR_HEADERS_TIMEOUT';
    return { ok: false, error: aborted ? `Gateway 响应超时（${GATEWAY_TIMEOUT_MS / 1000}s）` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 执行指令：快路径直连 → 失败兜底 Gateway。
 * @param {string} prompt  用户的指令
 * @param {object} opts    { sessionId?, agentId? }
 * @returns {Promise<{ok: boolean, content: string, raw?: object, error?: string}>}
 */
async function runAgent(prompt, opts = {}) {
  const direct = await runDirect(prompt, opts);
  if (direct.ok) return direct;
  // 直连失败且可兜底（网络/5xx/超时）→ 退回 Gateway
  if (direct._fallbackable) {
    const gw = await runViaGateway(prompt, opts);
    if (gw.ok) return gw;
    return { ok: false, error: `直连：${direct.error}；Gateway：${gw.error}` };
  }
  return direct;
}

/**
 * runAgentTools - OpenAI-style tool-calling loop over the direct provider.
 */
async function runAgentTools(prompt, tools, opts = {}) {
  const maxRounds = Math.max(1, Math.min(12, opts.maxRounds || 8));
  const maxTokens = Number(process.env.OPENCLAW_DIRECT_MAX_TOKENS || 4000);
  const timeoutPerRound = +process.env.DIRECT_TIMEOUT_MS || DIRECT_TIMEOUT_MS;
  if (!PROVIDER.baseUrl || !PROVIDER.apiKey) return { ok: false, error: 'tool provider not configured', _fallbackable: true };
  const slash = DIRECT_MODEL.indexOf('/');
  const modelId = slash >= 0 ? DIRECT_MODEL.slice(slash + 1) : DIRECT_MODEL;
  let messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  const steps = [];
  const maxToolOutput = Number(opts.maxToolOutput || 4000);

  async function callOnce(currentMessages) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutPerRound);
    const body = { model: modelId, messages: currentMessages, tools, tool_choice: 'auto', max_tokens: maxTokens, stream: false };
    try {
      const resp = await fetch(`${PROVIDER.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${PROVIDER.apiKey}` },
        body: Buffer.from(JSON.stringify(body), 'utf8'),
        signal: ctrl.signal,
      });
      const raw = await resp.json();
      if (!resp.ok) return { ok: false, error: raw.error?.message || `HTTP ${resp.status}`, _fallbackable: resp.status >= 500 || resp.status === 429 };
      return { ok: true, raw };
    } catch (e) {
      const aborted = e.name === 'AbortError' || e.code === 'UND_ERR_HEADERS_TIMEOUT';
      return { ok: false, error: aborted ? 'tool call timeout' : e.message, _fallbackable: aborted || e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' };
    } finally { clearTimeout(timer); }
  }

  function compactMessages() {
    const keepRecent = 4;
    const messagesCopy = [...messages];
    for (let i = 2; i < messagesCopy.length - 2; i++) {
      const age = messagesCopy.length - i;
      if (age > keepRecent && messagesCopy[i].role === 'tool' && messagesCopy[i].content && messagesCopy[i].content.length > 500) {
        messagesCopy[i] = { ...messagesCopy[i], content: messagesCopy[i].content.slice(0, 500) + '...[truncated]' };
      }
    }
    return messagesCopy;
  }

  for (let round = 0; round < maxRounds; round++) {
    const once = await callOnce(messages);
    if (!once.ok) return once;
    const message = once.raw.choices?.[0]?.message || {};
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!toolCalls.length) {
      const content = message.content || '';
      return { ok: true, content, steps, raw: once.raw, model: DIRECT_MODEL, path: 'agentic' };
    }
    messages.push({ role: 'assistant', content: message.content || '', tool_calls: toolCalls });
    for (const call of toolCalls) {
      const name = call.function?.name || '';
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch (_) { args = {}; }
      let output = '';
      let error = '';
      if (typeof opts.executor === 'function') {
        try {
          const res = await opts.executor(name, args);
          output = String(res?.output ?? res ?? '').slice(0, maxToolOutput);
          error = res?.error ? String(res.error).slice(0, 1000) : '';
        } catch (e) { error = e.message; }
      } else {
        error = 'executor not configured';
      }
      const toolResult = error ? `ERROR: ${error}` : output;
      messages.push({ role: 'tool', tool_call_id: call.id || '', content: toolResult.slice(0, maxToolOutput) });
      messages = compactMessages();
      steps.push({ tool: name, args, output: toolResult.slice(0, maxToolOutput), error });
      if (typeof opts.onStep === 'function') opts.onStep({ tool: name, args, output: toolResult, error });
    }
  }
  return { ok: false, error: 'max rounds reached', _fallbackable: true };
}

module.exports = { runAgent, runAgentTools, detectAction, GATEWAY_URL, DIRECT_MODEL, PROVIDER };
