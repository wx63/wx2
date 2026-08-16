const { safeToolOutput, runAgentModel, buildToolPrompt } = require('./runtime');

module.exports = {
  name: 'report',
  label: '运营报告',
  description: '生成运营报告（结论/数据洞察/建议）',
  schema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
  prompt: 'report',
  async handler(args, meta) {
    return safeToolOutput(await runAgentModel(buildToolPrompt('report', { topic: args.topic || meta.command }), meta));
  },
};
