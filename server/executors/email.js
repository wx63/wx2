// email.js - Email executor via SMTP (QQ/163/Outlook), nodemailer
// Env: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS(授权码), SMTP_TO, SMTP_FROM(可选)
const nodemailer = require('nodemailer');

function cfg() {
  return {
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: +(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    to: process.env.SMTP_TO || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  };
}

function configured() {
  const c = cfg();
  return !!(c.user && c.pass && c.to);
}

module.exports = {
  name: 'email',
  capability: 'notify|listing_submit|purchase|refund|report',
  get configured() { return configured(); },
  matches(approval) {
    if (!approval) return false;
    return ['listing_submit', 'purchase', 'refund', 'report', 'notify'].includes(approval.action);
  },
  async execute(approval) {
    const c = cfg();
    if (!configured()) {
      return { executed: false, reason: 'SMTP 未配置（需 SMTP_USER / SMTP_PASS 授权码 / SMTP_TO）' };
    }
    const subject = `[跨境智能体] ${approval.title || approval.action || '审批执行'}`;
    const body = [
      `审批单: ${approval.id || '-'}`,
      `动作: ${approval.action || '-'}`,
      `标题: ${approval.title || '-'}`,
      '',
      '--- 执行方案 ---',
      approval.content || approval.summary || JSON.stringify(approval, null, 2),
      '',
      `时间: ${new Date().toISOString()}`,
      '（本邮件由跨境智能体审批闸门自动发送）',
    ].join('\n');
    const transporter = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.secure,
      auth: { user: c.user, pass: c.pass },
    });
    try {
      const info = await transporter.sendMail({
        from: c.from, to: c.to, subject, text: body,
      });
      return { executed: true, detail: `邮件已发送至 ${c.to} (messageId: ${info.messageId})` };
    } catch (e) {
      return { executed: false, reason: `邮件发送失败: ${e.message}` };
    }
  },
};
