const { safeToolOutput, runAgentModel, buildToolPrompt } = require('./runtime');

module.exports = {
  name: 'leads',
  label: '线索打标',
  description: '对线索做意向分级（高意向/普通/垃圾），输出可导入 CSV 的表格',
  schema: { type: 'object', properties: { messages: { type: 'string' } }, required: ['messages'] },
  prompt: 'leads',
  async handler(args, meta) {
    return safeToolOutput(await runAgentModel(buildToolPrompt('leads', { messages: args.messages || meta.command }), meta));
  },
};
