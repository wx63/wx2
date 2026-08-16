// tools/runtime.js — 工具执行运行时与通用提示词
const { runAgent } = require('../bridge');
const { retrieve, answer } = require('../kb');
const { listLeads, orderStats } = require('../db');
const { lookupPrice } = require('../price-lookup');

function truncateText(value, max = 12000) {
  return String(value == null ? '' : value).slice(0, max);
}

function safeToolOutput(result) {
  if (!result) return { ok: false, error: '工具未返回结果' };
  if (result.ok === false) return result;
  return { ok: true, output: result.content || result.answer || JSON.stringify(result) };
}

async function runAgentModel(prompt, meta) {
  return runAgent(prompt, { agentId: meta.agentId || 'main', sessionId: meta.sessionId || 'agent-run' });
}

function buildToolPrompt(toolName, args, command) {
  const common = 'You are a cross-border ecommerce operations agent. Do not output opening remarks. Output the task result directly.\n';
  if (toolName === 'kb') return common + 'Answer the customer question using the knowledge base: ' + (args.question || command);
  if (toolName === 'research') return common + 'Execute a competitor/market research task and output a structured report.\nTask: ' + (args.topic || command);
  if (toolName === 'listing') return common + '请先用中文输出完整 Listing 草稿，包含 SEO 标题、五点描述、卖点总结、合规提示。每个标题先给中文解释，再给英文上架版。五点描述同样中英双语。最后附一份全英文可上架版。\n产品：' + (args.product || command);
  if (toolName === 'localize') return common + 'Localize the text into ' + (args.targetLanguage || 'target language') + ' and keep cultural/currency/size conventions.\nText:\n' + (args.text || command);
  if (toolName === 'compliance') return common + 'Audit the content for sensitive words, FDA claims, and infringement risk. Output a violation list and fixes.\nContent:\n' + (args.items || command);
  if (toolName === 'leads') return common + 'Grade the leads as hot/warm/cold and output a CSV-ready table.\nLeads:\n' + (args.messages || command);
  if (toolName === 'report') return common + 'Generate an operations report with conclusions, insights, and recommendations.\nTopic: ' + (args.topic || command);
  return common + 'Complete the task and output a deliverable.\nTask: ' + command;
}

async function runPlannedStep(step, meta) {
  const command = meta.command;
  if (step.tool === 'route') {
    return { ok: true, output: 'Routed to ' + (step.agentName || 'agent') + ', plan has ' + step.childCount + ' steps.', meta: { agentName: step.agentName, childCount: step.childCount } };
  }
  if (step.tool === 'context') {
    const q = step.args && step.args.question ? step.args.question : command;
    const chunks = retrieve(q, 4);
    if (!chunks.length) return { ok: true, output: 'No knowledge base match.', meta: { hits: 0 } };
    return { ok: true, output: chunks.map((c, i) => 'Fragment ' + (i + 1) + ' [' + c.file + ' - ' + c.heading + ']\n' + truncateText(c.content, 1600)).join('\n\n'), meta: { hits: chunks.length } };
  }
  if (step.tool === 'kb_answer') {
    const q = step.args && step.args.question ? step.args.question : command;
    return safeToolOutput(await answer(q));
  }
  if (step.tool === 'lead_data') {
    const leads = listLeads('all');
    const text = leads.map(l => `${l.id}|${l.channel}|${l.name}|${l.msg}`).join('\n');
    return { ok: true, output: text || 'No lead data.', meta: { count: leads.length } };
  }
  if (step.tool === 'order_stats') {
    try {
      const s = orderStats();
      return { ok: true, output: 'Orders total ' + s.total + ', today ' + s.today + ', pending ' + s.pending + ', shipped ' + s.shipped };
    } catch (_) { return { ok: true, output: 'No order source.' }; }
  }
  if (step.tool === 'greeting') {
    return { ok: true, output: 'Hello! I am your cross-border ecommerce assistant. Ask about sizing, returns, logistics, research, listings, or compliance.', meta: { type: 'greeting' } };
  }
  if (step.tool === 'price_lookup') {
    const query = step.args && step.args.query ? step.args.query : command;
    const price = await lookupPrice(query);
    if (!price.ok) return { ok: false, error: price.error || '实时查价失败' };
    return { ok: true, output: price.output, meta: { source: 'price_lookup', fetchedAt: price.data && price.data.fetchedAt } };
  }
  if (step.tool === 'approval_draft') {
    const prompt = `You are a cross-border ecommerce approval assistant. This task is an external action, do not execute it.\nOutput an approval-ready plan:\n- Target platform/object\n- Content draft\n- Risk notes\n- Items requiring manual confirmation\n\nTask: ${command}`;
    return safeToolOutput(await runAgentModel(prompt, meta));
  }
  const args = step.args || {};
  const prompt = buildToolPrompt(step.tool, args, command);
  return safeToolOutput(await runAgentModel(prompt, meta));
}

module.exports = { truncateText, safeToolOutput, runAgentModel, buildToolPrompt, runPlannedStep };
