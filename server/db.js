/**
 * db.js — SQLite 数据层（node:sqlite，Node 内置，无需 npm install）
 *
 * 当前只承载命令执行日志（P8 雏形：调优复盘用）。
 * approvals 仍在 approvals.json（迁移留待后续）。
 *
 * 表：
 *   commands — 每次 /api/command 的执行记录（command/路径/耗时/token/status/审批）
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS commands (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    command      TEXT NOT NULL,
    agent_id     TEXT,
    session_id   TEXT,
    model        TEXT,
    path         TEXT,        -- 'direct' | 'gateway'
    duration_ms  INTEGER,
    status       TEXT,        -- 'ok' | 'error'
    content_len  INTEGER,
    error        TEXT,
    needs_approval INTEGER,
    approval_id  TEXT,
    prompt_tokens   INTEGER,
    completion_tokens INTEGER,
    created_at   TEXT DEFAULT (datetime('now'))
  );
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_commands_created ON commands(created_at);`);

/**
 * 记录一次命令执行。
 * @param {object} r {command, agentId, sessionId, model, path, durationMs, status, contentLen, error, needsApproval, approvalId, promptTokens, completionTokens}
 * @returns {number} 自增 id
 */
function logCommand(r) {
  const stmt = db.prepare(`
    INSERT INTO commands (command, agent_id, session_id, model, path, duration_ms, status, content_len, error, needs_approval, approval_id, prompt_tokens, completion_tokens)
    VALUES (@command, @agentId, @sessionId, @model, @path, @durationMs, @status, @contentLen, @error, @needsApproval, @approvalId, @promptTokens, @completionTokens)
  `);
  stmt.run({
    command: String(r.command || '').slice(0, 4000),
    agentId: r.agentId || null,
    sessionId: r.sessionId || null,
    model: r.model || null,
    path: r.path || null,
    durationMs: r.durationMs != null ? r.durationMs : null,
    status: r.status || null,
    contentLen: r.contentLen != null ? r.contentLen : null,
    error: r.error ? String(r.error).slice(0, 1000) : null,
    needsApproval: r.needsApproval ? 1 : 0,
    approvalId: r.approvalId || null,
    promptTokens: r.promptTokens != null ? r.promptTokens : null,
    completionTokens: r.completionTokens != null ? r.completionTokens : null,
  });
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

/** 最近 N 条命令记录 */
function recentCommands(limit = 50) {
  return db.prepare('SELECT * FROM commands ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { db, logCommand, recentCommands };
