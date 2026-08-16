// scheduler.js — 精确日调度器：用 setTimeout 排到下一个执行点，避免 setInterval 分钟漂移
const { runDatabaseBackup } = require('./backup');
const { addActivity, orderStats, logAudit } = require('./db');
const feishu = require('./feishu');

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function msUntilMinute(minuteOfDay, now) {
  const target = new Date(now);
  target.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  const delta = target.getTime() - now.getTime();
  if (delta <= 0 && delta > -2 * 60 * 1000) return 0;
  if (delta <= 0) target.setDate(target.getDate() + 1);
  return Math.max(1000, target.getTime() - now.getTime());
}

function startScheduler({ now = () => new Date(), onSchedule } = {}) {
  const digestMinute = Number(process.env.DAILY_DIGEST_MINUTE ?? 9 * 60);
  const backupMinute = Number(process.env.DAILY_BACKUP_MINUTE ?? 3 * 60);
  const alertChatId = process.env.FEISHU_ALERT_CHAT_ID || '';
  const targetMinutes = [digestMinute, backupMinute].filter(v => Number.isFinite(v));
  let timer = null;
  let running = false;
  let lastDigestKey = null;
  let lastBackupKey = null;
  let failures = 0;
  const reminderEnabled = process.env.APPROVAL_REMINDER_ENABLED !== 'false';
  const reminderInterval = Math.max(60 * 1000, Number(process.env.APPROVAL_REMINDER_INTERVAL_MS) || 5 * 60 * 1000);
  let reminderTimer = null;

  async function runApprovalReminder() {
    const { listPendingApprovalsUnnotified, markApprovalNotified } = require('./db');
    const { executeApproval } = require('./executors');
    const pending = listPendingApprovalsUnnotified(20);
    if (!pending.length) return;

    let notified = 0;
    let failed = 0;
    const nowIso = new Date().toISOString();

    for (const ap of pending) {
      const text = [
        `【审批提醒】${ap.title || '未命名审批'}`,
        `单号: ${ap.id}`,
        `动作: ${ap.action || '-'}`,
        `提交时间: ${ap.created_at || '-'}`,
        '请到控制台处理：http://106.55.18.244:3001',
      ].join('\n');

      let feishuOk = false;
      let emailOk = false;

      if (alertChatId) {
        try {
          await feishu.sendText(alertChatId, text);
          feishuOk = true;
        } catch (e) {
          console.error('[reminder] feishu fail:', e.message);
        }
      }

      try {
        const r = await executeApproval({ id: ap.id, action: 'notify', title: `审批待处理：${ap.title}`, content: text });
        if (r.executed) emailOk = true;
        else console.error('[reminder] email fail:', r.reason);
      } catch (e) {
        console.error('[reminder] email err:', e.message);
      }

      if (feishuOk || emailOk) {
        markApprovalNotified(ap.id, nowIso);
        notified += 1;
      } else {
        failed += 1;
      }
    }

    console.log(`[reminder] scanned ${pending.length}, notified ${notified}, failed ${failed}`);
  }

  function startReminderLoop() {
    if (!reminderEnabled) return;
    reminderTimer = setInterval(() => runApprovalReminder().catch(e => console.error('[reminder] loop error:', e)), reminderInterval);
    if (reminderTimer.unref) reminderTimer.unref();
    setTimeout(() => runApprovalReminder().catch(e => console.error('[reminder] first run error:', e)), 30 * 1000);
  }

  function scheduleNext() {
    if (!targetMinutes.length) return;
    const current = now();
    const delay = Math.min(...targetMinutes.map(m => msUntilMinute(m, current)));
    if (onSchedule) onSchedule(delay);
    timer = setTimeout(tick, delay);
    timer.unref && timer.unref();
  }

  function tick() {
    if (running) return;
    running = true;
    try {
      const current = now();
      const todayKey = dateKey(current);
      const minutes = current.getHours() * 60 + current.getMinutes();

      if (lastDigestKey !== todayKey && Math.abs(minutes - digestMinute) <= 1) {
        lastDigestKey = todayKey;
        const orders = orderStats();
        addActivity({ tag: 'daily', color: '#6366f1', text: 'scheduled digest: orders=' + orders.total + ', pending=' + orders.pending + ', shipped=' + orders.shipped, userId: null });
      }

      if (lastBackupKey !== todayKey && Math.abs(minutes - backupMinute) <= 1) {
        lastBackupKey = todayKey;
        const backup = runDatabaseBackup();
        addActivity({ tag: 'daily', color: '#34d399', text: '数据库已备份：' + backup.file, userId: null });
        console.log('[scheduler] database backup:', backup.file, backup.size + ' bytes');
      }
      failures = 0;
    } catch (e) {
      failures += 1;
      console.error('[scheduler] tick error:', e);
      try {
        logAudit({ action: 'scheduler_error', metadata: { failures, error: e.message || String(e) } });
      } catch (_) {}
      if (failures >= 3 && alertChatId) {
        feishu.sendText(alertChatId, `[调度器告警] 连续 ${failures} 次执行失败：${e.message || e}`)
          .catch(err => console.error('[scheduler] alert send failed:', err.message));
      }
    } finally {
      running = false;
      scheduleNext();
    }
  }

  scheduleNext();
  startReminderLoop();
  console.log('[scheduler] started, next run scheduled');
  return {
    stop() {
      clearTimeout(timer);
      clearInterval(reminderTimer);
    },
  };
}

module.exports = { startScheduler, msUntilMinute };
