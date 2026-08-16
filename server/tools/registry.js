// tools/registry.js — Agent 工具注册表（单一事实来源）
const tools = [
  require('./price-lookup'),
  require('./kb-search'),
  require('./research'),
  require('./listing'),
  require('./localize'),
  require('./compliance'),
  require('./lead-data'),
  require('./leads'),
  require('./order-stats'),
  require('./report'),
  require('./approval-draft'),
];

const AGENT_TOOL_DEFS = tools;
const TOOL_SCHEMAS = AGENT_TOOL_DEFS.map(d => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.schema } }));

module.exports = { AGENT_TOOL_DEFS, TOOL_SCHEMAS, tools };
