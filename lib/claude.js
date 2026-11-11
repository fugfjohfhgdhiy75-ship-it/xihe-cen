import Anthropic from '@anthropic-ai/sdk';
import { getSettings, setSetting, listMemories } from './db.js';
import { recordUsage } from './pricing.js';

// 未整理的消息超过 COMPACT_AT 条时，把较早的部分整理进摘要，只留最近 KEEP 条原文。
// 两次整理之间，发给 Claude 的开头部分是不变的，提示缓存能一直命中。
export const COMPACT_AT = 40;
export const KEEP = 20;

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// 页面里填的优先，没填就用 Cloudflare 环境变量
export function apiConfig(env, settings) {
  return {
    key: (settings.api_key || env.ANTHROPIC_API_KEY || '').trim(),
    base: (settings.api_base || env.ANTHROPIC_BASE_URL || '').trim().replace(/\/+$/, ''),
  };
}

export function makeClient(env, settings) {
  const { key, base } = apiConfig(env, settings);
  return new Anthropic({ apiKey: key, ...(base ? { baseURL: base } : {}) });
}

// Haiku 没有服务端兜底，其他模型被安全分类器拒绝时自动换模型重答。
// 用自定义接口地址时不开，第三方接口不一定支持。
function fallbackParams(model, settings) {
  if (model.startsWith('claude-haiku') || settings.api_base) return {};
  return { betas: [FALLBACK_BETA], fallbacks: 'default' };
}

export function buildSystem(settings, memories) {
  let text = settings.persona.trim();
  if (memories.length) {
    text += '\n\n## 你记得的事\n' + memories.map((m) => '- ' + m.content.replace(/\s+/g, ' ').trim()).join('\n');
  }
  if (settings.summary.trim()) {
    text += '\n\n## 更早的聊天经过\n' + settings.summary.trim();
  }
  text +=
    '\n\n## 小屋说明\n' +
    '这里只发给你最近的一段聊天原文，更早的内容在上面的记忆和经过里，自然地用上就好，不用说“根据记忆”。' +
    '每次对方说话后会有一条系统消息告诉你现在的时间，用它判断早晚和隔了多久，不用特意报时。';
  return text;
}

function beijingNow(ts = Date.now()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

function gapText(ms) {
  const min = Math.round(ms / 60000);
  if (min < 30) return '';
  if (min < 60) return `距离上一条消息过去了约 ${min} 分钟。`;
  const h = Math.round(min / 60);
  if (h < 24) return `距离上一条消息过去了约 ${h} 小时。`;
  return `距离上一条消息过去了约 ${Math.round(h / 24)} 天。`;
}

export async function loadRecent(db, summaryUpto) {
  const { results } = await db
    .prepare('SELECT id, role, content, created_at FROM messages WHERE id > ? ORDER BY id ASC')
    .bind(Number(summaryUpto) || 0)
    .all();
  return results;
}

// 返回一个 ReadableStream，按行推送 JSON：{t: 文本片段} / {done, id} / {error}
export async function streamChat({ env, db, userText, waitUntil }) {
  const settings = await getSettings(db);
  const memories = await listMemories(db);

  const lastRow = await db.prepare('SELECT created_at FROM messages ORDER BY id DESC LIMIT 1').first();
  const now = Date.now();
  const userRow = await db
    .prepare('INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?) RETURNING id')
    .bind('user', userText, now)
    .first();

  let recent = await loadRecent(db, settings.summary_upto);
  // 第一条必须是用户消息
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);

  const messages = recent.map((m, i) => {
    const isLast = i === recent.length - 1;
    if (isLast) {
      return {
        role: m.role,
        content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }],
      };
    }
    return { role: m.role, content: m.content };
  });
  const timeNote = `现在是北京时间 ${beijingNow(now)}。` + (lastRow ? gapText(now - lastRow.created_at) : '');
  messages.push({ role: 'system', content: timeNote });

  const model = settings.model;
  const client = makeClient(env, settings);
  const encoder = new TextEncoder();

  let stream = null;
  let cancelled = false;
  return new ReadableStream({
    cancel() {
      // 她点了停止或关掉页面：停掉生成，不再继续计费
      cancelled = true;
      if (stream) stream.abort();
    },
    async start(controller) {
      const send = (obj) => {
        if (cancelled) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { cancelled = true; }
      };
      let full = '';
      try {
        stream = client.beta.messages.stream({
          model,
          max_tokens: 64000,
          system: [{ type: 'text', text: buildSystem(settings, memories), cache_control: { type: 'ephemeral' } }],
          messages,
          output_config: { effort: settings.effort },
          ...fallbackParams(model, settings),
        });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            full += event.delta.text;
            send({ t: event.delta.text });
          }
        }
        const final = await stream.finalMessage();
        if (!full) {
          full = final.stop_reason === 'refusal' ? '（这条没能回答，换个说法再试试）' : '（没有说出话来）';
          send({ t: full });
        }
        const row = await db
          .prepare('INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?) RETURNING id')
          .bind('assistant', full, Date.now())
          .first();
        await recordUsage(db, 'chat', final.model || model, final.usage);
        send({ done: true, id: row.id, userId: userRow.id });
        waitUntil(maybeCompact(env, db).catch((e) => console.error('compact failed', e)));
      } catch (err) {
        if (!cancelled) console.error(err);
        if (stream && stream.currentMessage) {
          await recordUsage(db, 'chat', model, stream.currentMessage.usage).catch(() => {});
        }
        // 回复没成功时，把半截回复也存下来，免得丢
        if (full) {
          await db
            .prepare('INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)')
            .bind('assistant', full, Date.now())
            .run();
        }
        send({ error: describeError(err), userId: userRow.id });
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'API key 不对，去记忆页最下面的 API 里检查一下。';
  if (err instanceof Anthropic.PermissionDeniedError) return '没有权限：可能是所在地区不支持，开着梯子再试试。';
  if (err instanceof Anthropic.RateLimitError) return '请求太频繁或额度用完了，等一下再试。';
  if (err instanceof Anthropic.BadRequestError) return '请求出错：' + err.message;
  if (err instanceof Anthropic.APIError) return `Claude 那边出错了（${err.status ?? '网络'}），等一下再试。`;
  return '出错了：' + (err && err.message ? err.message : String(err));
}

const COMPACT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    new_memories: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'new_memories'],
  additionalProperties: false,
};

// 把较早的聊天整理成摘要，并顺手提取值得长期记住的事
export async function maybeCompact(env, db, { force = false } = {}) {
  const settings = await getSettings(db);
  const recent = await loadRecent(db, settings.summary_upto);
  if (!force && recent.length <= COMPACT_AT) return { compacted: false };
  if (recent.length <= KEEP) return { compacted: false };

  // 切点落在一条用户消息上，让剩下的部分从用户开始
  let cut = recent.length - KEEP;
  while (cut < recent.length && recent[cut].role !== 'user') cut++;
  if (cut >= recent.length) return { compacted: false };
  const older = recent.slice(0, cut);
  const memories = await listMemories(db);

  const transcript = older
    .map((m) => `[${beijingNow(m.created_at)}] ${m.role === 'user' ? '我' : '你'}：${m.content}`)
    .join('\n');
  const prompt =
    '下面是我们小屋里一段较早的聊天，请帮忙整理。\n\n' +
    '已有的经过摘要：\n' + (settings.summary.trim() || '（还没有）') + '\n\n' +
    '已有的记忆：\n' + (memories.map((m) => '- ' + m.content).join('\n') || '（还没有）') + '\n\n' +
    '新的聊天记录：\n' + transcript + '\n\n' +
    '请输出：\n' +
    'summary：把已有摘要和新聊天合成一份新的经过摘要，按时间顺序，用第二人称“你”指回答的一方、“我”指提问的一方，' +
    '保留重要的事件、情绪、约定和日期，去掉寒暄，控制在 800 字以内。\n' +
    'new_memories：从新聊天里找出值得长期记住、已有记忆里还没有的事（喜好、习惯、重要的人和事、约定、雷区），' +
    '每条一句话，没有就给空数组。';

  const client = makeClient(env, settings);
  const model = settings.model;
  const res = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: COMPACT_SCHEMA } },
    ...fallbackParams(model, settings),
  });
  await recordUsage(db, 'compact', res.model || model, res.usage);
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
    throw new Error('整理失败：' + res.stop_reason);
  }
  const textBlock = res.content.find((b) => b.type === 'text');
  const out = JSON.parse(textBlock.text);

  const now = Date.now();
  const stmts = [
    setSetting(db, 'summary', out.summary),
    setSetting(db, 'summary_upto', older[older.length - 1].id),
  ];
  for (const m of out.new_memories || []) {
    if (m && m.trim()) {
      stmts.push(
        db
          .prepare('INSERT INTO memories (content, source, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .bind(m.trim(), 'auto', now, now)
      );
    }
  }
  await db.batch(stmts);
  return { compacted: true, added: (out.new_memories || []).length };
}
