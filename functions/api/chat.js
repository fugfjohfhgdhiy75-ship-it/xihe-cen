import { json } from '../../lib/db.js';
import { streamChat } from '../../lib/claude.js';

export async function onRequestPost({ env, request, waitUntil }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: '还没有设置 ANTHROPIC_API_KEY。' }, 500);
  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: '消息是空的' }, 400);
  const stream = await streamChat({ env, db: env.DB, userText: text, waitUntil });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });
}
