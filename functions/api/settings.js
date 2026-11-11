import { json, getSettings, setSetting } from '../../lib/db.js';
import { loadRecent, maybeCompact } from '../../lib/claude.js';

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const EFFORTS = ['low', 'medium', 'high'];

export async function onRequestGet({ env }) {
  const db = env.DB;
  const s = await getSettings(db);
  const recent = await loadRecent(db, s.summary_upto);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const month = await db
    .prepare('SELECT COALESCE(SUM(cost),0) AS cost, COUNT(*) AS n FROM usage WHERE created_at >= ?')
    .bind(monthStart.getTime())
    .first();
  const total = await db.prepare('SELECT COALESCE(SUM(cost),0) AS cost FROM usage').first();
  const last = await db
    .prepare("SELECT * FROM usage WHERE kind = 'chat' ORDER BY id DESC LIMIT 1")
    .first();
  return json({
    persona: s.persona,
    model: s.model,
    effort: s.effort,
    summary: s.summary,
    unsummarized: recent.length,
    cost: { month: month.cost, total: total.cost, last: last ? last.cost : null },
  });
}

export async function onRequestPut({ env, request }) {
  const body = await request.json().catch(() => ({}));
  const stmts = [];
  if (typeof body.persona === 'string' && body.persona.trim()) stmts.push(setSetting(env.DB, 'persona', body.persona));
  if (typeof body.summary === 'string') stmts.push(setSetting(env.DB, 'summary', body.summary));
  if (MODELS.includes(body.model)) stmts.push(setSetting(env.DB, 'model', body.model));
  if (EFFORTS.includes(body.effort)) stmts.push(setSetting(env.DB, 'effort', body.effort));
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
}

// POST /api/settings  立即整理
export async function onRequestPost({ env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: '还没有设置 ANTHROPIC_API_KEY。' }, 500);
  try {
    return json(await maybeCompact(env, env.DB, { force: true }));
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
