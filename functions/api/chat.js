import { json, getSettings } from '../../lib/db.js';
import { streamChat, apiConfig } from '../../lib/claude.js';

export async function onRequestPost({ env, request, waitUntil }) {
  if (!apiConfig(env, await getSettings(env.DB)).key) return json({ error: '还没有填 API key，去记忆页最下面的 API 里填一下。' }, 400);
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
