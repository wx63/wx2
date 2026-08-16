// events.js — 进程内事件总线 + SSE 长连接出口
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(event, payload) {
  for (const listener of [...listeners]) {
    try {
      listener({ event, payload });
    } catch (e) {
      console.warn('[events] publish error:', e.message);
    }
  }
}

function handleSse(req, res, { filter } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const send = (event, payload) => {
    if (res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (_) {}
  };
  const unsubscribe = subscribe(({ event, payload }) => {
    if (filter && !filter({ event, payload })) return;
    send(event, payload);
  });
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);

  send('hello', { ok: true, time: new Date().toISOString() });
  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  res.on('error', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

module.exports = { subscribe, publish, handleSse };
