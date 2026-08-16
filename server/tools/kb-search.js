const { retrieve } = require('../kb');
const { truncateText } = require('./runtime');

module.exports = {
  name: 'kb_search',
  label: '知识库检索',
  description: '检索本地知识库（尺码表/退换货/FAQ），返回带来源片段',
  schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  prompt: 'kb',
  async handler(args, meta) {
    const q = args.question || meta.command;
    const chunks = retrieve(q, 4);
    return { output: chunks.length ? chunks.map((c, i) => `片段${i + 1}【${c.file}·${c.heading}】\n${truncateText(c.content, 1600)}`).join('\n\n') : '未命中本地知识库。' };
  },
};
