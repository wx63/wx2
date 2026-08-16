const { safeToolOutput, runAgentModel, buildToolPrompt } = require('./runtime');

module.exports = {
  name: 'compliance',
  label: '合规审查',
  description: '敏感词/FDA禁用表述/侵权风险审查，输出违规点清单',
  schema: { type: 'object', properties: { items: { type: 'string' } }, required: ['items'] },
  prompt: 'compliance',
  async handler(args, meta) {
    return safeToolOutput(await runAgentModel(buildToolPrompt('compliance', { items: args.items || meta.command }), meta));
  },
};
