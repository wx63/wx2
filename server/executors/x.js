// x.js — X / Twitter 执行器占位
module.exports = {
  name: 'x',
  capability: 'social_post',
  configured: false,
  matches(approval) {
    return approval && approval.action === 'social_post';
  },
  async execute(approval) {
    return { executed: false, reason: 'X 官方 API 尚未配置，仅完成审批归档，不真实发布' };
  },
};
