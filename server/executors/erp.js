// erp.js — ERP/Shopee/独立站执行器占位
module.exports = {
  name: 'erp',
  capability: 'listing_submit|purchase|refund',
  configured: false,
  matches(approval) {
    return approval && ['listing_submit', 'purchase', 'refund'].includes(approval.action);
  },
  async execute(approval) {
    return { executed: false, reason: 'ERP/平台官方 API 尚未配置，仅完成审批归档，不真实执行' };
  },
};
