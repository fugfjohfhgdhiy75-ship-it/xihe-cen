import { json, listMemories } from '../../lib/db.js';

export async function onRequestGet({ env }) {
  return json({ memories: await listMemories(env.DB) });
}

export async function onRequestPost({ env, request }) {
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return json({ error: '内容是空的' }, 400);
  const now = Date.now();
  const row = await env.DB
    .prepare('INSERT INTO memories (content, source, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING *')
    .bind(content, 'manual', now, now)
    .first();
  return json({ memory: row });
}
