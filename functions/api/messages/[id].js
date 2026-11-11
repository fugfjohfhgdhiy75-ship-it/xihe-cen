import { json } from '../../../lib/db.js';

export async function onRequestDelete({ env, params }) {
  await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
}
