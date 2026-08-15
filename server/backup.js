const fs = require('fs');
const path = require('path');
const { db, DATA_DIR, DB_PATH, logAudit } = require('./db');

const BACKUP_ROOT = path.join(DATA_DIR, 'backup');
const RETAIN = 7;

function backupName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}.db`;
}

function pruneOldBackups() {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  const files = fs.readdirSync(BACKUP_ROOT)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort()
    .reverse();
  for (const old of files.slice(RETAIN)) {
    try { fs.unlinkSync(path.join(BACKUP_ROOT, old)); } catch (_) {}
  }
}

function runDatabaseBackup() {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  const dest = path.join(BACKUP_ROOT, backupName());
  const tmp = dest + '.tmp';

  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    fs.copyFileSync(DB_PATH, tmp);
  } catch (e) {
    const escaped = tmp.replace(/'/g, '');
    db.exec(`VACUUM INTO '${escaped}'`);
  }
  fs.rmSync(dest, { force: true });
  fs.renameSync(tmp, dest);
  pruneOldBackups();

  const stat = fs.statSync(dest);
  try {
    logAudit({ action: 'db_backup', entityType: 'database', entityId: dest, metadata: { bytes: stat.size } });
  } catch (e) {
    console.warn('[backup] audit failed:', e.message);
  }
  return { file: dest, size: stat.size, retained: RETAIN };
}

module.exports = { runDatabaseBackup, BACKUP_ROOT };
