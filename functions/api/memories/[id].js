import { json } from '../../../lib/db.js';

export async function onRequestPut({ env, params, request }) {
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return json({ error: '内容是空的' }, 400);
  const row = await env.DB
    .prepare('UPDATE memories SET content = ?, updated_at = ? WHERE id = ? RETURNING *')
    .bind(content, Date.now(), Number(params.id))
    .first();
  return json({ memory: row });
}

export async function onRequestDelete({ env, params }) {
  await env.DB.prepare('DELETE FROM memories WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
}
