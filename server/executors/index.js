// executors/index.js — 审批执行器适配器注册表
// 已接入：email（SMTP 发件）、telegram（Bot API）；其余平台待接入官方 API。
const email = require('./email');
const telegram = require('./telegram');
const instagram = require('./instagram');
const x = require('./x');
const wechat = require('./wechat');
const erp = require('./erp');

const adapters = [email, telegram, instagram, x, wechat, erp];

function findAdapter(approval) {
  return adapters.find(a => typeof a.matches === 'function' && a.matches(approval)) || null;
}

async function executeApproval(approval) {
  const adapter = findAdapter(approval);
  if (!adapter) {
    return { executed: false, reason: '没有匹配该动作的执行器；当前仅完成审批归档，不真实执行对外动作', adapter: null, approvalId: approval && approval.id };
  }
  const result = await adapter.execute(approval);
  return { ...result, adapter: adapter.name, approvalId: approval && approval.id };
}

function listExecutors() {
  return adapters.map(a => ({ name: a.name, capability: a.capability, configured: !!a.configured }));
}

module.exports = { adapters, executeApproval, listExecutors, findAdapter };
