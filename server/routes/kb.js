// routes/kb.js — 知识库 RAG 查询与文件管理
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { loadKnowledgeBase, retrieve, answer, fileStats } = require('../kb');
const { addActivity } = require('../db');
const { requireRole, kbQueryLimiter, audit } = require('../middleware');

const router = express.Router();
const KB_DIR = path.join(__dirname, '..', '..', '知识库');
const KB_ALLOWED_EXT = new Set(['.md', '.txt', '.pdf', '.docx', '.xlsx', '.csv']);
const KB_INDEXED_EXT = new Set(['.md', '.txt']);

const kbUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });
      cb(null, KB_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      let orig = file.originalname;
      try { orig = Buffer.from(orig, 'latin1').toString('utf8'); } catch {}
      const base = path.basename(orig, ext).replace(/[^\w一-龥.-]/g, '_');
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (KB_ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error(`不支持的文件类型：${ext}`));
  },
});

router.post('/api/kb-query', kbQueryLimiter, requireRole('viewer', 'operator', 'admin'), async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== 'string' || question.length > 4000) {
    return res.status(400).json({ ok: false, error: '缺少 question 字段或问题过长' });
  }
  try {
    const result = await answer(question);
    addActivity({ tag: '客服', color: '#34d399', text: `RAG 检索：${question.slice(0, 24)}`, userId: req.user.id });
    res.json(result);
  } catch (e) {
    console.error('[kb-query] error:', e);
    res.status(500).json({ ok: false, error: '知识库检索失败' });
  }
});

router.get('/api/kb/retrieve', requireRole('operator', 'admin'), (req, res) => {
  const q = String(req.query.q || '');
  const k = Math.min(10, Math.max(1, +req.query.k || 3));
  if (!q) {
    const total = Object.values(fileStats()).reduce((s, v) => s + v.chunks, 0);
    return res.json({ ok: true, chunks: [], total });
  }
  const chunks = retrieve(q, k);
  res.json({ ok: true, chunks: chunks.map(c => ({ file: c.file, heading: c.heading, score: c.score, preview: c.content.slice(0, 120) })) });
});

router.get('/api/kb/files', (req, res) => {
  const files = [];
  try {
    const stats = fileStats();
    for (const f of fs.readdirSync(KB_DIR)) {
      const ext = path.extname(f).toLowerCase();
      if (!KB_ALLOWED_EXT.has(ext)) continue;
      const stat = fs.statSync(path.join(KB_DIR, f));
      const indexed = KB_INDEXED_EXT.has(ext);
      files.push({ name: f, size: stat.size, mtime: stat.mtime.toISOString(), indexed, chunks: indexed ? (stats[f]?.chunks || 0) : 0 });
    }
    files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  } catch (e) {}
  const totalChunks = Object.values(fileStats()).reduce((s, v) => s + v.chunks, 0);
  res.json({ ok: true, files, totalChunks });
});

router.post('/api/kb/upload', requireRole('operator', 'admin'), (req, res) => {
  kbUpload.array('files', 20)(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message || '上传失败' });
    const saved = (req.files || []).map(f => {
      const ext = path.extname(f.originalname).toLowerCase();
      return { name: f.filename, originalName: f.originalname, size: f.size, mtime: new Date().toISOString(), indexed: KB_INDEXED_EXT.has(ext) };
    });
    if (saved.some(f => f.indexed)) loadKnowledgeBase();
    addActivity({ tag: '知识库', color: '#a855f7', text: `上传 ${saved.length} 个知识库文档`, userId: req.user.id });
    audit(req, 'kb_upload', 'kb_file', null, { files: saved.map(f => f.name) });
    res.json({ ok: true, files: saved });
  });
});

router.delete('/api/kb/files/:name', requireRole('operator', 'admin'), (req, res) => {
  let name;
  try { name = decodeURIComponent(req.params.name); }
  catch { return res.status(400).json({ ok: false, error: '非法文件名' }); }
  const safe = path.basename(name);
  if (!safe || safe !== name || safe.includes('\\') || safe.includes('/')) return res.status(400).json({ ok: false, error: '非法文件名' });
  const ext = path.extname(safe).toLowerCase();
  if (!KB_ALLOWED_EXT.has(ext)) return res.status(400).json({ ok: false, error: '不支持的文件类型' });
  const full = path.join(KB_DIR, safe);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: '文件不存在' });
  try {
    fs.unlinkSync(full);
    loadKnowledgeBase();
    addActivity({ tag: '知识库', color: '#fbbf24', text: `删除知识库文档：${safe}`, userId: req.user.id });
    audit(req, 'kb_delete', 'kb_file', safe);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: '删除失败' });
  }
});

module.exports = router;
