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
  console.log('[scheduler] started, next run scheduled');
  return {
    stop() {
      clearTimeout(timer);
    },
  };
}

module.exports = { startScheduler, msUntilMinute };
