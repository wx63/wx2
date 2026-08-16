const { orderStats } = require('../db');

module.exports = {
  name: 'order_stats',
  label: '订单统计',
  description: '统计当前订单数据',
  schema: { type: 'object', properties: {} },
  prompt: 'order_stats',
  async handler(args, meta) {
    try {
      const s = orderStats();
      return { output: `订单总数 ${s.total}，今日 ${s.today}，待处理 ${s.pending}，已发货 ${s.shipped}` };
    } catch (_) {
      return { output: '未接入订单数据源。' };
    }
  },
};
