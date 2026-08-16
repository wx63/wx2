const { safeToolOutput, runAgentModel } = require('./runtime');

module.exports = {
  name: 'approval_draft',
  label: '审批草稿',
  description: '对外动作（发帖/上架/下单/退款）只出执行方案草稿，绝不真实执行',
  schema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
  prompt: 'approval_draft',
  async handler(args, meta) {
    const prompt = `你是跨境电商运营审批助手。以下任务属于对外动作，不得真实执行。\n请输出可直接人工审批的执行方案：\n- 目标平台/对象\n- 内容草稿\n- 风险提示\n- 需要人工确认的事项\n\n任务：${args.task || meta.command}`;
    return safeToolOutput(await runAgentModel(prompt, meta));
  },
};
