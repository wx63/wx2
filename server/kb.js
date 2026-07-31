/**
 * kb.js — 知识库 RAG 检索
 *
 * 1. 启动时加载 知识库/*.md，按二级标题分块
 * 2. 关键词检索 Top-K 块
 * 3. 调 OpenClaw 生成带来源引用的答复草稿
 */
const fs = require('fs');
const path = require('path');
const { runAgent } = require('./bridge');

const KB_DIR = path.join(__dirname, '..', '知识库');

// ---------- 分块 ----------
let CHUNKS = []; // { file, heading, content }

function loadKnowledgeBase() {
  CHUNKS = [];
  if (!fs.existsSync(KB_DIR)) return CHUNKS;
  for (const file of fs.readdirSync(KB_DIR)) {
    if (!file.endsWith('.md')) continue;
    const full = path.join(KB_DIR, file);
    const text = fs.readFileSync(full, 'utf-8');
    splitByHeading(file, text);
  }
  return CHUNKS;
}

function splitByHeading(file, text) {
  // 按二级标题 ## 切块；标题前的内容归到「概述」块
  const lines = text.split('\n');
  let curHeading = '概述';
  let buf = [];
  const flush = () => {
    const content = buf.join('\n').trim();
    if (content) CHUNKS.push({ file, heading: curHeading, content });
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/);
    if (m) { flush(); curHeading = m[1].trim(); }
    else buf.push(line);
  }
  flush();
}

// ---------- 关键词检索 ----------
// 中文停用词
const STOP = new Set(['的','了','吗','呢','啊','我','你','他','她','有','是','在','这','那','个','件','款','和','与','及','或','能','可以','吗','多','少','多大','几','请问','咨询','一下','需要','想要','知道','看看','麻烦']);

// 尺码/数字同义词扩展：让"衣服/鞋"类问题也能命中"女装/男装/鞋类"块
const SYNONYMS = {
  '衣': ['女装', '男装', '服装', '上衣'],
  '衣服': ['女装', '男装', '服装', '上衣'],
  '鞋': ['男鞋', '女鞋', '鞋类'],
  '尺码': ['女装', '男装', '鞋类', '宠物'],
  '欧盟': ['欧盟', '跨境', '冷静期', '14天', '十四天'],
  '退货': ['退货', '退换', '无理由', '冷静期', '14天'],
  '退': ['退货', '退换'],
  '物流': ['跨境', '物流', 'USPS', 'DHL', 'ePacket'],
  '到货': ['物流', '跨境', '时效'],
  '多久': ['时效', '物流', '跨境'],
};

function tokenize(q) {
  const tokens = [];
  // 英文/数字 token：对每个连续字母数字段，再拆出纯数字、纯字母子串
  for (const m of q.match(/[A-Za-z0-9]+/g) || []) {
    const t = m.toLowerCase();
    if (t.length > 1) tokens.push(t);
    for (const d of m.match(/\d+/g) || []) if (d.length >= 2) tokens.push(d.toLowerCase());
    for (const w of m.match(/[A-Za-z]+/g) || []) if (w.length > 1) tokens.push(w.toLowerCase());
  }
  // 中文：连成串后做 2-3 gram + 单字
  const cn = q.replace(/[^一-龥]/g, ' ').split(/\s+/).filter(Boolean).join('');
  for (let i = 0; i < cn.length; i++) {
    const c = cn[i];
    if (!STOP.has(c)) tokens.push(c);
    if (i + 1 < cn.length) {
      const bi = cn.slice(i, i + 2);
      tokens.push(bi);
      // 2-gram 同义词扩展（如"衣服"→女装/男装）
      if (SYNONYMS[bi]) tokens.push(...SYNONYMS[bi]);
    }
    if (i + 2 < cn.length) tokens.push(cn.slice(i, i + 3));
  }
  return [...new Set(tokens)];
}

function scoreChunk(chunk, tokens) {
  let score = 0;
  const headLower = chunk.heading.toLowerCase();
  const bodyLower = chunk.content.toLowerCase();
  for (const t of tokens) {
    if (headLower.includes(t)) score += 3;       // 标题命中权重最高
    if (bodyLower.includes(t)) score += 1;
  }
  // 表格行命中加权：question 含数字/尺码 token，正文按「行」命中也加权
  return score;
}

function retrieve(question, k = 3) {
  loadKnowledgeBase(); // 每次检索前重载，确保文档更新即时生效（文件小，成本可忽略）
  const tokens = tokenize(question);
  if (!tokens.length) return [];
  return CHUNKS
    .map(c => ({ ...c, score: scoreChunk(c, tokens) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ---------- 生成答复 ----------
async function answer(question) {
  const sources = retrieve(question, 3);
  if (!sources.length) {
    return {
      ok: true,
      answer: '知识库中未检索到相关内容，建议转人工客服核实。',
      sources: [],
    };
  }
  const context = sources.map((s, i) =>
    `【片段${i + 1}】来源：${s.file}·${s.heading}\n${s.content}`
  ).join('\n\n---\n\n');

  const prompt =
    `你是跨境电商客服。根据下方知识库片段回答客户问题。\n` +
    `要求：\n1. 先给结论，直接回答\n2. 关键信息后标注来源，格式「（来源：<文件名>·<章节>）」\n` +
    `3. 知识库片段中已有的内容必须直接引用，特别是专项条款（如欧盟冷静期、跨境特别说明）优先于通用条款\n` +
    `4. 只有知识库完全没有相关信息时才说「建议转人工客服核实」，不得遗漏已提供的片段内容\n` +
    `5. 只出答复草稿，不代替客户下单退货\n\n` +
    `=== 知识库片段 ===\n${context}\n\n=== 客户问题 ===\n${question}`;

  const result = await runAgent(prompt, { agentId: 'main' });
  if (!result.ok) {
    return { ok: false, error: result.error, sources };
  }
  return {
    ok: true,
    answer: result.content,
    sources: sources.map(s => ({ file: s.file, heading: s.heading, score: s.score })),
  };
}

module.exports = { loadKnowledgeBase, retrieve, answer, tokenize };
