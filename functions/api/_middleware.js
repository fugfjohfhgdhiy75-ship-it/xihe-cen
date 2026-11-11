import { ensureSchema, json } from '../../lib/db.js';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequest(context) {
  const { env, request } = context;
  if (!env.DB) return json({ error: '还没有绑定 D1 数据库（变量名要叫 DB）。' }, 500);
  if (!env.APP_PASSWORD) return json({ error: '还没有设置 APP_PASSWORD。' }, 500);
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!safeEqual(token, env.APP_PASSWORD)) return json({ error: '密码不对' }, 401);
  await ensureSchema(env.DB);
  return context.next();
}
