// planner.js — 本地 Agent 路由与任务规划
const { ROUTE_RULES, detectAction } = require('./rules');
const { retrieve } = require('./kb');
const { truncateText } = require('./tools/runtime');

function routeCommand(command) {
  const lower = String(command || '').toLowerCase();
  const greeting = ['你好', '嗨', 'hello', 'hi', '早', '晚上好', '上午好', '下午好', '在吗', '在不在', '感谢', 'thanks', 'thank you', '谢谢', '再见', 'bye', '帮忙'];
  for (const g of greeting) {
    if (lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + '，') || lower.startsWith(g + ',')) {
      return { agent: 3, name: '客服与订单 Agent', color: '#34d399', greeting: true };
    }
  }
  for (const rule of ROUTE_RULES) {
    if (rule.kw.some(k => lower.includes(k))) return rule;
  }
  return { agent: 3, name: '客服与订单 Agent', color: '#34d399' };
}

const PRICE_QUERY_RE = /最低价|价格|多少钱|什么价|什么价格|报价|现价|售价|卖多少|降价|查价|行情|价位|cheap|lowest|price/i;
const NON_PRICE_LOOKUP_RE = /价格政策|价格体系|定价策略|价格表|price policy|价格区间策略/i;

function isPriceLookupCommand(command) {
  const text = String(command || '').trim();
  if (!text || text.length > 200) return false;
  if (NON_PRICE_LOOKUP_RE.test(text)) return false;
  return PRICE_QUERY_RE.test(text);
}

function summarizePlan(plan) {
  return plan.map((s, i) => ({ seq: i + 1, kind: s.kind, label: s.label, tool: s.tool || null }));
}

function buildAgentPlan(command, route) {
  const lower = String(command || '').toLowerCase();
  const plan = [];
  if (isPriceLookupCommand(command)) {
    plan.push({ kind: 'tool', label: '实时查价', tool: 'price_lookup', args: { query: command }, color: '#f59e0b' });
    plan.push({ kind: 'output', label: 'Output', tool: null, args: {}, color: route.color });
    return plan;
  }
  plan.push({ kind: 'plan', label: 'Route', tool: 'route', agentName: route.name, childCount: 3, color: route.color });
  if (route.greeting) {
    plan.push({ kind: 'tool', label: 'Greeting', tool: 'greeting', args: { text: command }, color: '#34d399' });
    plan.push({ kind: 'output', label: 'Output', tool: null, args: {}, color: route.color });
    return plan;
  }
  const wantsOrders = ['order', 'orders', 'today'].some(k => lower.includes(k));
  if (wantsOrders) {
    plan.push({ kind: 'tool', label: 'Order stats', tool: 'order_stats', args: { text: command }, color: '#60a5fa' });
    plan.push({ kind: 'output', label: 'Output', tool: null, args: {}, color: route.color });
    return plan;
  }
  const wantsKb = ['size', 'return', 'logistics', 'faq', 'policy'].some(k => lower.includes(k));
  if (wantsKb) plan.push({ kind: 'tool', label: 'KB context', tool: 'context', args: { question: command }, color: '#34d399' });
  if (route.agent === 0) plan.push({ kind: 'tool', label: 'Research', tool: 'research', args: { topic: command }, color: route.color });
  else if (route.agent === 1) plan.push({ kind: 'tool', label: 'Listing', tool: 'listing', args: { product: command }, color: route.color });
  else if (route.agent === 2) plan.push({ kind: 'tool', label: 'Report', tool: 'report', args: { topic: command }, color: route.color });
  else if (route.agent === 3) {
    if (lower.includes('lead') || lower.includes('clean')) {
      plan.push({ kind: 'tool', label: 'Lead data', tool: 'lead_data', args: {}, color: route.color });
      plan.push({ kind: 'tool', label: 'Leads', tool: 'leads', args: { messages: command }, color: route.color });
    } else plan.push({ kind: 'tool', label: 'KB answer', tool: 'kb_answer', args: { question: command }, color: route.color });
  }
  else if (route.agent === 4) plan.push({ kind: 'tool', label: 'Compliance', tool: 'compliance', args: { items: command }, color: route.color });
  else plan.push({ kind: 'tool', label: 'Report', tool: 'report', args: { topic: command }, color: route.color });
  if (detectAction(command)) plan.push({ kind: 'gate', label: 'Approval', tool: 'approval_draft', args: { command }, color: '#fbbf24' });
  plan.push({ kind: 'output', label: 'Output', tool: null, args: {}, color: route.color });
  return plan;
}

function extractSummary(content, fallback) {
  const text = String(content || '');
  const firstLine = text.split('\n').map(s => s.trim()).find(Boolean) || '';
  return truncateText(firstLine.slice(0, 160) || fallback, 200);
}

function agenticPreloadContext(command) {
  const lower = String(command || '').toLowerCase();
  const wantsKb = ['尺码', '退换货', '物流', '客服', '回复', 'FAQ', '查单', '政策'].some(k => lower.includes(k));
  if (!wantsKb) return '';
  const chunks = retrieve(command, 4);
  if (!chunks.length) return '';
  return chunks.map((c, i) => '片段' + (i + 1) + '【' + c.file + '·' + c.heading + '】\n' + truncateText(c.content, 1600)).join('\n\n');
}

module.exports = { routeCommand, isPriceLookupCommand, buildAgentPlan, summarizePlan, extractSummary, agenticPreloadContext, PRICE_QUERY_RE, NON_PRICE_LOOKUP_RE };
