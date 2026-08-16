const { safeToolOutput, runAgentModel, buildToolPrompt } = require('./runtime');

module.exports = {
  name: 'localize',
  label: '本地化',
  description: '多语种本地化改写（注意文化禁忌/货币/尺寸表达）',
  schema: { type: 'object', properties: { text: { type: 'string' }, target_language: { type: 'string' } }, required: ['text'] },
  prompt: 'localize',
  async handler(args, meta) {
    return safeToolOutput(await runAgentModel(buildToolPrompt('localize', { text: args.text || meta.command, targetLanguage: args.target_language || '目标语言' }), meta));
  },
};
