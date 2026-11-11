import { json } from '../../lib/db.js';

// GET /api/messages?before=<id>&limit=50  往上翻页
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
  const { results } = await env.DB
    .prepare('SELECT id, role, content, created_at FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?')
    .bind(before, limit)
    .all();
  return json({ messages: results.reverse(), hasMore: results.length === limit });
}
