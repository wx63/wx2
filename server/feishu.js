/**
 * feishu.js - Feishu enterprise bot adapter.
 * Uses long connection events so it works on localhost without a public callback URL.
 */
const lark = require('@larksuiteoapi/node-sdk');

const APP_ID = process.env.FEISHU_APP_ID || '';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const ALLOWED_CHAT_IDS = String(process.env.FEISHU_ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_SENDER_IDS = String(process.env.FEISHU_ALLOWED_SENDER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

let client = null;
let wsClient = null;
let started = false;
const handledMessageIds = new Set();
const recentMessages = [];
const rateBuckets = new Map();

function isRateLimited(chatId, max = 5, windowMs = 60000) {
  const now = Date.now();
  const bucket = (rateBuckets.get(chatId) || []).filter(t => now - t < windowMs);
  if (bucket.length >= max) {
    rateBuckets.set(chatId, bucket);
    return true;
  }
  bucket.push(now);
  rateBuckets.set(chatId, bucket);
  return false;
}
function logMessage(entry) {
  recentMessages.unshift({ ...entry, at: new Date().toISOString() });
  if (recentMessages.length > 100) recentMessages.pop();
}

function configured() {
  return Boolean(APP_ID && APP_SECRET);
}

function getClient() {
  if (!configured()) throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET \u672a\u914d\u7f6e');
  if (!client) client = new lark.Client({ appId: APP_ID, appSecret: APP_SECRET });
  return client;
}

function getStatus() {
  return {
    configured: configured(),
    started,
    appId: APP_ID ? String(APP_ID).slice(0, 8) + '...' : '',
    recentCount: recentMessages.length,
  };
}

async function sendText(chatId, text) {
  const c = getClient();
  try {
    const res = await c.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: String(text || '').slice(0, 3500) }),
    },
  });
    if (res && res.code && res.code !== 0) {
      logMessage({ type: 'send_error', chatId, text: String(text).slice(0, 200), error: JSON.stringify(res) });
      throw new Error(JSON.stringify(res));
    }
    logMessage({ type: 'sent', chatId, text: String(text).slice(0, 200), messageId: res && res.data && res.data.message_id });
    return res;
  } catch (e) {
    logMessage({ type: 'send_error', chatId, text: String(text).slice(0, 200), error: e.message });
    throw e;
  }
}

function parseTextContent(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return String(parsed.text || parsed.content || '').trim();
  } catch (e) {
    return String(raw || '').trim();
  }
}

async function startFeishuLongConnection({ onMessage } = {}) {
  if (started) return { started: true };
  if (!configured()) throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET \u672a\u914d\u7f6e');
  getClient();

  const dispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const message = (data && data.message) || {};
      const sender = (data && data.sender) || {};
      const messageId = message.message_id || '';
      const chatId = message.chat_id || '';
      const text = parseTextContent(message.content);
      const senderId = (sender.sender_id && (sender.sender_id.open_id || sender.sender_id.user_id)) || '';

      if (!messageId || !chatId || !text) return {};
      if (message.message_type && message.message_type !== 'text') return {};
      if (sender.sender_type && sender.sender_type !== 'user') return {};
      if (ALLOWED_CHAT_IDS.length && !ALLOWED_CHAT_IDS.includes(chatId)) return {};
      if (ALLOWED_SENDER_IDS.length && !ALLOWED_SENDER_IDS.includes(senderId)) return {};
      if (handledMessageIds.has(messageId)) return {};
      handledMessageIds.add(messageId);
      if (handledMessageIds.size > 500) {
        const first = handledMessageIds.values().next().value;
        handledMessageIds.delete(first);
      }

      logMessage({ type: 'received', messageId, chatId, senderId, text: String(text).slice(0, 200) });
      if (typeof onMessage === 'function') {
        setImmediate(() => {
          onMessage({ messageId, chatId, sender, text }).catch((err) => {
            console.error('[feishu] onMessage error:', err);
            logMessage({ type: 'process_error', messageId, chatId, error: err.message });
          });
        });
      }
      return {};
    },
  });

  wsClient = new lark.WSClient({
    appId: APP_ID,
    appSecret: APP_SECRET,
    loggerLevel: lark.LoggerLevel.info,
  });

  wsClient.start({ eventDispatcher: dispatcher });
  started = true;
  console.log('[feishu] long connection started');
  return { started: true };
}

module.exports = { getClient, getStatus, sendText, startFeishuLongConnection, configured, isRateLimited };
