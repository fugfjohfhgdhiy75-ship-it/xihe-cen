// 美元 / 每百万 token。缓存写入按 5 分钟缓存的 1.25 倍输入价算。
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, read: 0.01 },
};

export function costOf(model, usage) {
  const p = PRICES[model] || PRICES['claude-opus-5-5'];
  const u = usage || {};
  return (
    ((u.input_tokens || 0) * p.input +
      (u.output_tokens || 0) * p.output +
      (u.cache_read_input_tokens || 0) * p.read +
      (u.cache_creation_input_tokens || 0) * p.input * 1.25) /
    1e6
  );
}

export async function recordUsage(db, kind, model, usage) {
  const u = usage || {};
  await db
    .prepare(
      `INSERT INTO usage (created_at, kind, model, input_tokens, output_tokens, cache_read, cache_write, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      Date.now(),
      kind,
      model,
      u.input_tokens || 0,
      u.output_tokens || 0,
      u.cache_read_input_tokens || 0,
      u.cache_creation_input_tokens || 0,
      costOf(model, u)
    )
    .run();
}
