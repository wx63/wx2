const { safeToolOutput, runAgentModel, buildToolPrompt } = require('./runtime');

module.exports = {
  name: 'research',
  label: '市场调研',
  description: '竞品/市场调研，输出结构化报告（用已有知识，不联网）',
  schema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
  prompt: 'research',
  async handler(args, meta) {
    return safeToolOutput(await runAgentModel(buildToolPrompt('research', { topic: args.topic || meta.command }), meta));
  },
};
