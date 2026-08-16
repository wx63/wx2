// telegram.js - Telegram Bot executor via Bot API (built-in fetch, no deps)
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// NOTE: api.telegram.org is blocked in mainland China; works on overseas servers / local dev.
const API = 'https://api.telegram.org';

function cfg() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  };
}

function configured() {
  const c = cfg();
  return !!(c.token && c.chatId);
}

module.exports = {
  name: 'telegram',
  capability: 'notify|social_post|reply',
  get configured() { return configured(); },
  matches(approval) {
    if (!approval) return false;
    return ['notify', 'social_post', 'reply', 'listing_submit'].includes(approval.action);
  },
  async execute(approval) {
    const c = cfg();
    if (!configured()) {
      return { executed: false, reason: 'Telegram 未配置（需 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID）' };
    }
    const text = [
      `【跨境智能体】${approval.title || approval.action || '审批执行'}`,
      `审批单 ${approval.id || '-'} | 动作: ${approval.action || '-'}`,
      '',
      (approval.content || approval.summary || JSON.stringify(approval, null, 2)).slice(0, 3500),
    ].join('\n');
    try {
      const res = await fetch(`${API}/bot${c.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: c.chatId, text }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        return { executed: false, reason: `Telegram 发送失败: ${data.description || res.status}` };
      }
      return { executed: true, detail: `Telegram 已发送 (message_id: ${data.result.message_id})` };
    } catch (e) {
      return { executed: false, reason: `Telegram 发送异常: ${e.message}` };
    }
  },
};
