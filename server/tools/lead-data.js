const { listLeads } = require('../db');

module.exports = {
  name: 'lead_data',
  label: '读取线索',
  description: '读取当前线索库记录',
  schema: { type: 'object', properties: {} },
  prompt: 'lead_data',
  async handler(args, meta) {
    const leads = listLeads('all');
    return { output: leads.map(l => `${l.id}|${l.channel}|${l.name}|${l.msg}`).join('\n') || '暂无线索数据。' };
  },
};
