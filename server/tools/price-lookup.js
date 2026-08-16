const { lookupPrice } = require('../price-lookup');

module.exports = {
  name: 'price_lookup',
  label: '实时查价',
  description: '查询任意商品当前全网折扣价/实时最低价，支持手机/数码/家电/日用等商品关键词',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '商品关键词，例如 iPhone 17 256GB、戴森吹风机、SONY WH-1000XM5' },
      max_results: { type: 'integer', description: '最多返回条数' },
    },
    required: ['query'],
  },
  prompt: 'price_lookup',
  async handler(args, meta) {
    const res = await lookupPrice(args.query || meta.command);
    if (!res.ok) return { output: res.error || '实时查价失败' };
    return { output: res.output };
  },
};
