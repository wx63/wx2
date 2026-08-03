/**
 * index.js — OpenClaw AI跨境运营员工平台 · 后端主服务
 *
 * 端口：3001（已确认空闲）
 *
 * API：
 *   POST /api/command    执行指令（真实调用 OpenClaw，含审批检测）
 *   GET  /api/approvals  待审批列表（内存持久化）
 *   POST /api/approvals/:id/decide   批准/驳回
 *   GET  /api/health     健康检查
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { runAgent, detectAction } = require('./bridge');
const { loadKnowledgeBase, retrieve, answer, fileStats } = require('./kb');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------- 知识库上传（multer） ----------
const KB_DIR = path.join(__dirname, '..', '知识库');
const KB_ALLOWED_EXT = new Set(['.md', '.txt', '.pdf', '.docx', '.xlsx', '.csv']);
const KB_INDEXED_EXT = new Set(['.md', '.txt']); // 仅这两类进 RAG 索引

const kbUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });
      cb(null, KB_DIR);
    },
    // 用 时间戳-原名 防重名，保留原扩展名
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      // multer 2.x 的 file.originalname 是 latin1（未按 UTF-8 解码），需先转回 UTF-8
      let orig = file.originalname;
      try { orig = Buffer.from(orig, 'latin1').toString('utf8'); } catch {}
      const base = path.basename(orig, ext).replace(/[^\w一-龥.-]/g, '_');
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (KB_ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error(`不支持的文件类型：${ext}`));
  },
});

// ---------- 数据存储（内存 + 本地 JSON 文件持久化） ----------
const DATA_DIR = path.join(__dirname, '..', 'data');
const APPROVALS_FILE = path.join(DATA_DIR, 'approvals.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadApprovals() {
  try {
    return JSON.parse(fs.readFileSync(APPROVALS_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function saveApprovals(list) {
  ensureDataDir();
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

// ---------- API ----------

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'ecommerce-agent-server', time: new Date().toISOString() });
});

// 知识库检索（kb-query skill）
app.post('/api/kb-query', async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ ok: false, error: '缺少 question 字段' });
  }
  try {
    const result = await answer(question);
    res.json(result);
  } catch (e) {
    console.error('[kb-query] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 知识库分块/检索调试（前端知识库页可调，不调 OpenClaw）
app.get('/api/kb/retrieve', (req, res) => {
  const q = String(req.query.q || '');
  const k = Math.min(10, Math.max(1, +req.query.k || 3));
  if (!q) {
    return res.json({ ok: true, chunks: [], total: retrieve.length });
  }
  const chunks = retrieve(q, k);
  res.json({ ok: true, chunks: chunks.map(c => ({ file: c.file, heading: c.heading, score: c.score, preview: c.content.slice(0, 120) })) });
});

// 知识库文件列表（供前端知识库页同步，含 indexed/chunks）
app.get('/api/kb/files', (req, res) => {
  const files = [];
  try {
    const stats = fileStats();
    for (const f of fs.readdirSync(KB_DIR)) {
      const ext = path.extname(f).toLowerCase();
      if (!KB_ALLOWED_EXT.has(ext)) continue;
      const stat = fs.statSync(path.join(KB_DIR, f));
      const indexed = KB_INDEXED_EXT.has(ext);
      files.push({
        name: f,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        indexed,
        chunks: indexed ? (stats[f]?.chunks || 0) : 0,
      });
    }
    // 按修改时间倒序
    files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  } catch (e) {}
  const totalChunks = Object.values(fileStats()).reduce((s, v) => s + v.chunks, 0);
  res.json({ ok: true, files, totalChunks });
});

// 知识库上传（multipart，落盘进 知识库/，md/txt 立即进索引）
app.post('/api/kb/upload', (req, res) => {
  kbUpload.array('files', 20)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || '上传失败' });
    }
    const saved = (req.files || []).map(f => {
      const ext = path.extname(f.originalname).toLowerCase();
      const indexed = KB_INDEXED_EXT.has(ext);
      return {
        name: f.filename,
        originalName: f.originalname,
        size: f.size,
        mtime: new Date().toISOString(),
        indexed,
      };
    });
    if (saved.some(f => f.indexed)) loadKnowledgeBase(); // 有 md/txt 上传则重载索引
    res.json({ ok: true, files: saved });
  });
});

// 知识库删除（路径参数做安全校验，防目录穿越）
app.delete('/api/kb/files/:name', (req, res) => {
  let name;
  try {
    name = decodeURIComponent(req.params.name);
  } catch {
    return res.status(400).json({ ok: false, error: '非法文件名' });
  }
  // basename 后必须与原名一致（拒绝 a/b、../x）
  const safe = path.basename(name);
  if (!safe || safe !== name || safe.includes('\\') || safe.includes('/')) {
    return res.status(400).json({ ok: false, error: '非法文件名' });
  }
  const ext = path.extname(safe).toLowerCase();
  if (!KB_ALLOWED_EXT.has(ext)) {
    return res.status(400).json({ ok: false, error: '不支持的文件类型' });
  }
  const full = path.join(KB_DIR, safe);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ ok: false, error: '文件不存在' });
  }
  try {
    fs.unlinkSync(full);
    loadKnowledgeBase();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 执行指令（核心）
app.post('/api/command', async (req, res) => {
  const { command, agentId, sessionId } = req.body || {};
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ ok: false, error: '缺少 command 字段' });
  }

  try {
    // 1. 检测是否对外动作（需要审批）
    const action = detectAction(command);

    // 2. 调用 OpenClaw 真实执行
    const result = await runAgent(command, { agentId, sessionId });

    if (!result.ok) {
      return res.status(502).json({ ok: false, error: result.error });
    }

    // 3. 若是对外动作 → 生成审批条目，不直接执行
    let approval = null;
    if (action) {
      const approvals = loadApprovals();
      const id = 'AP-' + String(approvals.length + 1).padStart(3, '0');
      approval = {
        id,
        title: `${action.label}：${command.slice(0, 30)}`,
        command,
        action: action.action,
        draft: result.content,       // AI 草稿 = 执行方案
        status: 'pending',
        createdAt: new Date().toISOString(),
        risk: '对外动作，需人工确认后执行',
      };
      approvals.unshift(approval);
      saveApprovals(approvals);
    }

    res.json({
      ok: true,
      content: result.content,
      approval,          // 非空 = 生成了审批条目
      needsApproval: !!action,
    });
  } catch (e) {
    console.error('[command] error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 审批列表
app.get('/api/approvals', (req, res) => {
  res.json({ ok: true, data: loadApprovals() });
});

// 审批处理
app.post('/api/approvals/:id/decide', (req, res) => {
  const { id } = req.params;
  const { decision } = req.body || {}; // 'approve' | 'reject'
  const approvals = loadApprovals();
  const item = approvals.find(a => a.id === id);
  if (!item) return res.status(404).json({ ok: false, error: '审批条目不存在' });

  item.status = decision === 'approve' ? 'approved' : 'rejected';
  item.decidedAt = new Date().toISOString();
  saveApprovals(approvals);
  res.json({ ok: true, data: item });
});

// ---------- 启动 ----------
loadKnowledgeBase(); // 预加载知识库分块
app.listen(PORT, () => {
  console.log(`✅ AI跨境运营平台后端已启动: http://localhost:${PORT}`);
  console.log(`   Gateway: ${require('./bridge').GATEWAY_URL}`);
  console.log(`   审批数据: ${APPROVALS_FILE}`);
  console.log(`   知识库分块: ${loadKnowledgeBase().length} 块`);
});
