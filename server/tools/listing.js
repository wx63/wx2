const { safeToolOutput, runAgentModel, buildToolPrompt } = require('./runtime');

module.exports = {
  name: 'listing',
  label: 'Listing 生成',
  description: '生成中英双语 Listing 草稿（SEO标题/五点描述/合规提示）',
  schema: { type: 'object', properties: { product: { type: 'string' }, context: { type: 'string', description: '可选：调研/知识库结论' } } },
  prompt: 'listing',
  async handler(args, meta) {
    const product = args.product || meta.command;
    const contextText = args.context ? `调研/上下文：\n${args.context}\n\n` : '';
    return safeToolOutput(await runAgentModel(buildToolPrompt('listing', { product: contextText ? `${contextText}\n产品：${product}` : product }), meta));
  },
};
