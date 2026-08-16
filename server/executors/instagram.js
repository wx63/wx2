// instagram.js — Instagram 执行器占位
module.exports = {
  name: 'instagram',
  capability: 'social_post',
  configured: false,
  matches(approval) {
    return approval && approval.action === 'social_post';
  },
  async execute(approval) {
    return { executed: false, reason: 'Instagram 官方 API 尚未配置，仅完成审批归档，不真实发布' };
  },
};
