// wechat.js — 微信/企微执行器占位
module.exports = {
  name: 'wechat',
  capability: 'reply',
  configured: false,
  matches(approval) {
    return approval && approval.action === 'reply';
  },
  async execute(approval) {
    return { executed: false, reason: '微信官方 API 尚未配置，仅完成审批归档，不真实发送' };
  },
};
