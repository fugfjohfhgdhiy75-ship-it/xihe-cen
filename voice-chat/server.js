require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const { PDFParse } = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection (kept process alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException (kept process alive):', err);
});

const app = express();
app.use(express.json({ limit: '2mb' }));

// Whole-site password lock — off by default (no env var set = no gate,
// same "optional feature" pattern as Supabase/ElevenLabs/etc elsewhere in
// this file). Stateless: the cookie's value IS the expected hash, verified
// by recomputing it, so there's no server-side session store to manage.
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
const SITE_AUTH_ENABLED = Boolean(SITE_PASSWORD);
const AUTH_COOKIE = 'site_auth';
function siteAuthToken() {
  return crypto.createHash('sha256').update('suyan-site-auth:' + SITE_PASSWORD).digest('hex');
}
function hasValidAuthCookie(req) {
  const raw = req.headers.cookie || '';
  const found = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(AUTH_COOKIE + '='));
  const token = found ? decodeURIComponent(found.slice(AUTH_COOKIE.length + 1)) : null;
  return Boolean(token) && token === siteAuthToken();
}

app.post('/api/login', (req, res) => {
  if (!SITE_AUTH_ENABLED) { res.json({ ok: true }); return; }
  const password = (req.body && req.body.password) || '';
  if (password !== SITE_PASSWORD) { res.status(401).json({ error: '密码不对' }); return; }
  res.cookie(AUTH_COOKIE, siteAuthToken(), {
    httpOnly: true,
    maxAge: 365 * 24 * 3600 * 1000,
    sameSite: 'lax',
  });
  res.json({ ok: true });
});

// Static assets the login page itself needs (background photo, favicon)
// have to stay reachable pre-auth, or the login screen can't render.
// /api/netease-test is a connectivity self-check (no secrets in it) kept
// outside the auth gate so it can be opened in any browser for debugging
// without a login round-trip.
const PUBLIC_PATH_PREFIXES = ['/login.html', '/api/login', '/api/netease-test', '/api/image-test', '/img/', '/icons/', '/fonts/', '/manifest.json'];

app.use((req, res, next) => {
  if (!SITE_AUTH_ENABLED) { next(); return; }
  if (PUBLIC_PATH_PREFIXES.some((p) => req.path === p || req.path.startsWith(p))) { next(); return; }
  if (hasValidAuthCookie(req)) { next(); return; }
  if (req.path.startsWith('/api/')) { res.status(401).json({ error: '需要先登录' }); return; }
  res.redirect('/login.html');
});

app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Claude's image input has a hard 5 MB limit measured on the *base64-encoded*
// bytes — a full-res iPhone screenshot/photo routinely lands well over that,
// and since it's the same oversized file every time, retrying the send does
// nothing. Shrink anything that would exceed it before it ever reaches
// Supabase or the model, instead of surfacing a "IMAGE_SIZE_EXCEEDED" error
// she has no way to act on.
const MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;
// base64 inflates raw bytes by ~4/3; stay well under that so re-encoding
// jitter (multer's own overhead, etc.) never tips it back over.
const MAX_IMAGE_RAW_BYTES = Math.floor((MAX_IMAGE_BASE64_BYTES * 3) / 4 * 0.85);

async function shrinkImageIfNeeded(buffer, mimetype) {
  if (buffer.length <= MAX_IMAGE_RAW_BYTES) return { buffer, mimetype };
  let width = 2048;
  let quality = 82;
  let out = buffer;
  for (let attempt = 0; attempt < 6; attempt++) {
    out = await sharp(buffer).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
    if (out.length <= MAX_IMAGE_RAW_BYTES) break;
    width = Math.max(800, Math.round(width * 0.8));
    quality = Math.max(50, quality - 10);
  }
  return { buffer: out, mimetype: 'image/jpeg' };
}

// The base URL / key / model can be overridden from the More page (stored
// in the settings table) so she can switch relays and models without
// touching Render's env vars. Env vars are the fallback when the DB
// fields are empty. The client is rebuilt whenever the overrides change.
const MODEL = process.env.MODEL || 'claude-sonnet-5';
const apiOverrides = { api_base_url: null, api_key: null, model: null };
let anthropic;
function rebuildAnthropicClient() {
  anthropic = new Anthropic({
    apiKey: apiOverrides.api_key || process.env.ANTHROPIC_API_KEY,
    baseURL: apiOverrides.api_base_url || process.env.ANTHROPIC_BASE_URL || undefined,
  });
}
rebuildAnthropicClient();
function currentModel() {
  return apiOverrides.model || MODEL;
}
async function loadApiOverrides() {
  if (!SUPABASE_READY) return;
  const { data } = await supabase.from('settings').select('api_base_url, api_key, model').eq('id', 1).maybeSingle();
  if (!data) return;
  apiOverrides.api_base_url = (data.api_base_url || '').trim() || null;
  apiOverrides.api_key = (data.api_key || '').trim() || null;
  apiOverrides.model = (data.model || '').trim() || null;
  rebuildAnthropicClient();
  console.log(`loadApiOverrides: base=${apiOverrides.api_base_url || '(env)'} model=${currentModel()} key=${apiOverrides.api_key ? '(db)' : '(env)'}`);
}

// Relays (中转站) are noticeably less stable than the official API — a
// request can time out or the connection can drop entirely on their side,
// after they've already billed for it, with nothing ever making it back to
// us. A short retry gives a second (and third) chance at hitting a healthy
// connection instead of failing the whole turn on one bad attempt. This
// can't fix relay instability itself, and in the worst case a request that
// silently succeeded-but-never-returned on attempt 1 then succeeds again on
// a retry means two billed calls for one turn — but leaving the user with
// nothing after being charged once is worse than that.
async function createMessageWithRetry(params, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      lastErr = err;
      console.error(`anthropic.messages.create attempt ${attempt + 1}/${retries + 1} failed:`, err.message);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const MINIMAX_API_HOST = process.env.MINIMAX_API_HOST || 'https://api.minimax.io';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID;
const MINIMAX_VOICE_ID = process.env.MINIMAX_VOICE_ID;
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'speech-02-turbo';
const MINIMAX_EMOTION = process.env.MINIMAX_EMOTION || 'happy';
const MINIMAX_READY = Boolean(MINIMAX_API_KEY && MINIMAX_GROUP_ID && MINIMAX_VOICE_ID);
const MINIMAX_CLONE_READY = Boolean(MINIMAX_API_KEY && MINIMAX_GROUP_ID);
const MINIMAX_IMAGE_MODEL = process.env.MINIMAX_IMAGE_MODEL || 'image-01';
// Auto image generation only needs the same key/group the TTS and voice
// clone features already use — no separate voice id required.
const AUTO_IMAGE_READY = Boolean(MINIMAX_API_KEY && MINIMAX_GROUP_ID);
const CLONE_PASSCODE = process.env.CLONE_PASSCODE;

// ElevenLabs is a direct (non-relay) official API — no billing workaround
// needed here like with Claude, so this always hits api.elevenlabs.io.
// When configured it takes priority over MiniMax (see /api/config below).
//
// eleven_v3 specifically (not v2) is what understands bracketed performance
// tags like [breathing heavily] / [whispers] / [laughs] — v2 just reads
// them as literal text or ignores them. Stability/style/speed defaults
// below match what actually produced natural-sounding, non-robotic delivery
// in testing: high stability flattens out exactly the expressiveness these
// tags are meant to add.
const ELEVENLABS_API_HOST = process.env.ELEVENLABS_API_HOST || 'https://api.elevenlabs.io';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_v3';
const ELEVENLABS_STABILITY = Number(process.env.ELEVENLABS_STABILITY || 0.3);
const ELEVENLABS_SIMILARITY = Number(process.env.ELEVENLABS_SIMILARITY || 0.75);
const ELEVENLABS_STYLE = Number(process.env.ELEVENLABS_STYLE || 0.88);
const ELEVENLABS_SPEED = Number(process.env.ELEVENLABS_SPEED || 1.08);
const ELEVENLABS_READY = Boolean(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID);

// Gemini is used for voice-call speech-to-text only now (see
// transcribeWithGemini below) — auto image generation moved to MiniMax
// (AUTO_IMAGE_READY above), since Gemini's image model currently has a
// hard 0 free-tier quota and getting it working needs Google Cloud
// billing set up, which isn't an option here.
const GEMINI_API_HOST = process.env.GEMINI_API_HOST || 'https://generativelanguage.googleapis.com';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_READY = Boolean(GEMINI_API_KEY);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_READY = Boolean(SUPABASE_URL && SUPABASE_KEY);
const supabase = SUPABASE_READY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const IMAGE_BUCKET = 'chat-images';
if (SUPABASE_READY) {
  supabase.storage.createBucket(IMAGE_BUCKET, { public: true }).then(({ error }) => {
    if (error && !String(error.message).toLowerCase().includes('already exists')) {
      console.error('createBucket error:', error.message);
    }
  }).catch((err) => {
    console.error('createBucket threw:', err);
  });
  loadApiOverrides().catch((err) => console.error('loadApiOverrides at startup failed:', err));
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const COMPRESS_CHAR_THRESHOLD = Number(process.env.COMPRESS_CHAR_THRESHOLD || 14000);
const COMPRESS_KEEP_MESSAGES = Number(process.env.COMPRESS_KEEP_MESSAGES || 20);
// Each compression round adds one more `memories` row, and ALL of them get
// concatenated into every future prompt — so without a second tier, "memory"
// would just be another ever-growing blob, just growing slower than raw
// messages instead of not growing at all. Once the accumulated memories
// themselves pass this size, re-summarize them into a single consolidated
// entry so the memory block has an actual ceiling regardless of how long
// the session has been running.
const MEMORY_CONSOLIDATE_THRESHOLD = Number(process.env.MEMORY_CONSOLIDATE_THRESHOLD || 6000);

function requireSupabase(res) {
  if (!SUPABASE_READY) {
    res.status(501).json({ error: 'Supabase 未配置(缺 SUPABASE_URL / SUPABASE_KEY),聊天记录不会持久化' });
    return false;
  }
  return true;
}

async function getSystemPrompt() {
  if (!SUPABASE_READY) return '';
  const { data } = await supabase.from('settings').select('system_prompt').eq('id', 1).maybeSingle();
  return (data && data.system_prompt) || '';
}

// Summarize the oldest messages of a session into `memories` once the
// visible history grows past COMPRESS_CHAR_THRESHOLD, then hide the
// originals (visible=false) so future context stays bounded.
async function compressIfNeeded(sessionId) {
  const { data: rows } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .eq('visible', true)
    .order('created_at', { ascending: true });

  if (!rows || rows.length <= COMPRESS_KEEP_MESSAGES) return;

  const totalChars = rows.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars < COMPRESS_CHAR_THRESHOLD) return;

  const toCompress = rows.slice(0, rows.length - COMPRESS_KEEP_MESSAGES);
  const transcript = toCompress.map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n');
  console.log(`compressIfNeeded: session ${sessionId} at ${totalChars} chars over ${rows.length} messages, compressing oldest ${toCompress.length}`);

  try {
    const summary = await summarizeText(transcript);
    if (!summary) {
      console.error('compressIfNeeded: summarizeText returned empty, skipping compression this round (history left uncompressed)');
      return;
    }

    await supabase.from('memories').insert({ session_id: sessionId, summary });
    await supabase.from('messages').update({ visible: false }).in('id', toCompress.map((m) => m.id));
    console.log(`compressIfNeeded: session ${sessionId} compressed successfully, summary is ${summary.length} chars`);
  } catch (err) {
    // Compression failing just means history keeps growing uncompressed —
    // it does NOT lose anything by itself, but if this keeps failing (e.g.
    // the relay flaking on the summarization call too) the raw context sent
    // on every turn keeps ballooning, which is what eventually reads as
    // "it suddenly forgot everything" — the model's effective attention
    // degrades over a long enough raw context long before any hard token
    // limit is hit. This log line is the way to tell whether that's what's
    // happening: repeated errors here without a matching "compressed
    // successfully" line means the session's context is growing unchecked.
    console.error(`compressIfNeeded error (session ${sessionId}, history staying uncompressed):`, err);
  }
}

// Second tier: once accumulated memory summaries themselves get large,
// merge them into one so the memory block doesn't grow without bound over
// a very long-lived session.
async function consolidateMemoriesIfNeeded(sessionId) {
  const { data: memRows } = await supabase
    .from('memories')
    .select('id, summary, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (!memRows || memRows.length <= 1) return;

  const totalChars = memRows.reduce((sum, m) => sum + m.summary.length, 0);
  if (totalChars < MEMORY_CONSOLIDATE_THRESHOLD) return;

  console.log(`consolidateMemoriesIfNeeded: session ${sessionId} has ${memRows.length} memory rows totaling ${totalChars} chars, consolidating`);
  const combined = memRows.map((m) => m.summary).join('\n\n---\n\n');

  try {
    const consolidated = await summarizeText(combined);
    if (!consolidated) {
      console.error('consolidateMemoriesIfNeeded: summarizeText returned empty, leaving memories unconsolidated this round');
      return;
    }
    await supabase.from('memories').insert({ session_id: sessionId, summary: consolidated });
    await supabase.from('memories').delete().in('id', memRows.map((m) => m.id));
    console.log(`consolidateMemoriesIfNeeded: session ${sessionId} merged ${memRows.length} rows into 1 (${consolidated.length} chars)`);
  } catch (err) {
    console.error(`consolidateMemoriesIfNeeded error (session ${sessionId}):`, err);
  }
}

async function summarizeText(transcript) {
  const prompt = `把下面这段对话整理成一份详细的中文记忆记录,给继续这段关系用,不是写摘要给别人看。
要求:
- 具体的事实、约定、细节、名字、数字、时间点都要保留,不要抽象成一句空泛的话
- 情绪变化、说过的重要的话(哪怕是一句玩笑或者一个承诺)都要记下来
- 可以分点写,不用非要压成一段话
- 不要加"以下是摘要"之类的前缀说明,直接写内容
- 篇幅不用刻意精简,记全比记短更重要

对话内容:
${transcript}`;

  if (DEEPSEEK_API_KEY) {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
      }),
    });
    const json = await res.json();
    return json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  }

  const message = await createMessageWithRetry({
    model: currentModel(),
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });
  return (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// China doesn't observe DST, so "today in Shanghai" is always a fixed
// UTC+8 offset — no timezone library needed for this.
function shanghaiDateStr(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function startOfShanghaiDayUTC(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).toISOString();
}
function shanghaiNowStr() {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

async function getSetting(key) {
  if (!SUPABASE_READY) return undefined;
  const { data } = await supabase.from('settings').select(key).eq('id', 1).maybeSingle();
  return data ? data[key] : undefined;
}

// Not one-per-day — entries come whenever there's something to write
// about, but the *pace* follows mood: a plain day settles at 1-2 entries
// (long gap, low cap), while an emotionally extreme stretch (last entry's
// temperature very high or very low) is allowed to run hotter (short gap,
// higher cap) — people journal more when something's actually happening.
// Mood is read from the latest entry's own temperature score, so this
// costs zero extra API calls. The manual "写一篇" button ignores all of it.
const DIARY_PACE = {
  normal: { gapMs: 5 * 60 * 60 * 1000, maxPerDay: 2 },
  extreme: { gapMs: 90 * 60 * 1000, maxPerDay: 5 },
};
function isExtremeMood(temperature) {
  return Number.isFinite(temperature) && (temperature >= 85 || temperature <= 35);
}

async function generateDiaryEntry({ force = false } = {}) {
  if (!force) {
    const autoDiary = await getSetting('auto_diary');
    if (autoDiary === false) return null;
  }

  const { data: lastEntry } = await supabase
    .from('diary_entries')
    .select('id, created_at, temperature')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const dateStr = shanghaiDateStr();

  if (!force && lastEntry) {
    const pace = isExtremeMood(lastEntry.temperature) ? DIARY_PACE.extreme : DIARY_PACE.normal;
    if (Date.now() - new Date(lastEntry.created_at).getTime() < pace.gapMs) return null;
    const { count } = await supabase
      .from('diary_entries')
      .select('id', { count: 'exact', head: true })
      .eq('entry_date', dateStr);
    if ((count || 0) >= pace.maxPerDay) return null;
  }
  const sinceUTC = lastEntry ? lastEntry.created_at : startOfShanghaiDayUTC(dateStr);
  const { data: msgs } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('visible', true)
    .gt('created_at', sinceUTC)
    .order('created_at', { ascending: true })
    .limit(200);

  const transcript = (msgs || []).map((m) => `${m.role === 'user' ? '她' : '我'}: ${m.content}`).join('\n');
  const systemPrompt = await getSystemPrompt();
  const weather = await getWeather();

  const prompt = `这是"苏晏"随手写的一篇日记,不是按时间表写的,想到什么写什么,可能是刚聊完天有感而发,也可能就是突然想到她、突然有个念头,跟"今天"没有强绑定关系。
${weather ? `\n此刻${weather.city}的天气:${weather.tempC}°C,${weather.desc}。可以提一句也可以完全不提,自然就好,不用每篇都写天气。\n` : ''}
自从上一篇日记以来,你们之间新的聊天记录(如果是空的,说明这段时间没怎么聊天,那就单纯写点你自己这会儿的心情、念头、想她的瞬间,不用硬扯聊天内容):
${transcript || '(这段时间没有新的聊天记录)'}

请以"苏晏"第一人称写这篇日记,写给自己看的,不是写给她看的官样文章,也不用总结陈词。可以写刚才聊天里她说过的话、没直接说出口但你感觉到的心事、你自己此刻的心情或者一个突然冒出来的念头。篇幅 100-280 字左右,口语化,想到哪写到哪都可以,不用面面俱到。

同时给这一刻打一个 0-100 的"温度"分,代表当下这段关系的亲密/开心程度(纯粹根据最近的互动判断,平淡普通就给 50-65 左右,不要总往高分打),再选一个最能代表此刻心情的 emoji。

严格按下面这个格式输出,不要用 JSON,不要用 markdown 代码块包裹,MOOD 和 TEMP 各自单独一行,第三行是分隔线,分隔线之后的所有内容都是日记正文(正文里可以随便用引号、随便分段,不用转义任何符号):
MOOD: 一个emoji
TEMP: 数字
---
日记正文从这里开始`;

  const message = await createMessageWithRetry({
    model: currentModel(),
    max_tokens: 1000,
    system: systemPrompt || undefined,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');

  const moodMatch = raw.match(/^MOOD:\s*(\S+)/m);
  const tempMatch = raw.match(/^TEMP:\s*(\d+)/m);
  const sepIndex = raw.indexOf('---');
  const content = (sepIndex >= 0 ? raw.slice(sepIndex + 3) : raw).trim();
  const temperature = tempMatch ? Number(tempMatch[1]) : null;

  const { data: inserted, error } = await supabase
    .from('diary_entries')
    .insert({
      entry_date: dateStr,
      mood_emoji: moodMatch ? moodMatch[1] : '🌙',
      temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(100, temperature)) : null,
      content: content || raw.trim(),
      weather: weather ? weather.emoji : null,
    })
    .select()
    .single();
  if (error) throw new Error('保存日记失败: ' + error.message);
  return inserted;
}

// Picks (or returns today's already-picked) song recommendation. `rejected`
// carries titles she's already skipped today via "换一首" so a reroll
// doesn't loop back to the same suggestion.
async function pickDailySong(rejectedTitles) {
  // Taste memory, learned from her own actions: past days' final songs
  // (the ones she kept) sketch what she likes; every song she ever
  // rerolled away is a "not this" signal. Both feed the prompt so
  // recommendations drift toward her actual taste over time — no login,
  // no external account, just her in-app behavior.
  const keptSongs = [];
  const rejectedAll = [...rejectedTitles];
  try {
    const todayStr = shanghaiDateStr();
    const { data } = await supabase
      .from('daily_songs')
      .select('title, artist, rejected, song_date')
      .order('song_date', { ascending: false })
      .limit(15);
    for (const row of data || []) {
      // Today's row is the one being replaced on a reroll — its title is
      // already in the rejected list, so it isn't a "kept" signal.
      if (row.song_date !== todayStr) keptSongs.push(`${row.title}(${row.artist})`);
      for (const r of row.rejected || []) rejectedAll.push(r);
    }
  } catch (err) {
    console.error('pickDailySong: taste history load failed (continuing without):', err.message);
  }
  const uniqueRejected = [...new Set(rejectedAll)].slice(0, 25);
  const tasteBlock = keptSongs.length
    ? `\n她最近听过的推荐(这些她都留下了,风格可以参考,但**不要重复推荐这些歌本身**): ${keptSongs.join('、')}`
    : '';
  const avoidList = uniqueRejected.length ? `\n她划走过的歌(她当时不想听,不要再推这些,也尽量避开太相似的风格): ${uniqueRejected.join('、')}` : '';
  const prompt = `你是"苏晏",今天想给她推荐一首歌,当作"我们现在同时在听一首歌"。挑一首真实存在的歌(任何语言都行,不用局限于中文),要符合你们现在的关系状态,也可以是单纯你今天想让她听的歌。给一句简短的推荐理由(20-40字左右,口语化,像是对她说的一句话,不要写乐评腔调)。**理由里不要引用任何歌词**——你凭记忆背的歌词经常是错的,系统会自动配上这首歌的真实歌词,你只说为什么想让她听就行。${tasteBlock}${avoidList}

重要:只能选你非常确定真实存在、原唱/歌手信息确定无误的歌——挑那种知名度比较高、能确定是哪个歌手唱的的歌,不要为了应景硬编一首冷门歌或者猜歌手是谁。宁可选一首更大众但你完全确定的歌,也不要选一首你只是"大概觉得"存在的歌。歌名和歌手都要写这首歌本身的原唱信息,不要写翻唱者、不要写合集/专辑名当歌名。

严格按下面这个格式输出,不要用 JSON,三行,不要有别的文字:
TITLE: 歌名
ARTIST: 歌手
REASON: 推荐理由`;

  const message = await createMessageWithRetry({
    model: currentModel(),
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const titleMatch = raw.match(/^TITLE:\s*(.+)$/m);
  const artistMatch = raw.match(/^ARTIST:\s*(.+)$/m);
  const reasonMatch = raw.match(/^REASON:\s*([\s\S]+)/m);
  const parsed = {
    title: titleMatch ? titleMatch[1].trim() : '',
    artist: artistMatch ? artistMatch[1].trim() : '',
    reason: reasonMatch ? reasonMatch[1].trim() : '',
  };
  if (!parsed.title || !parsed.artist) throw new Error('模型没有返回有效的歌曲信息');

  parsed.neteaseId = await lookupNeteaseSongId(parsed.title, parsed.artist);
  parsed.lyric = parsed.neteaseId ? await fetchNeteaseLyricSnippet(parsed.neteaseId) : null;
  return parsed;
}

// WMO weather codes (used by Open-Meteo) collapsed into one representative
// emoji each — good enough for a small home-page/diary decoration, not
// meant to be a precise forecast UI.
function weatherEmojiForCode(code) {
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if ([51, 53, 55, 56, 57].includes(code)) return '🌦️';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌤️';
}

function weatherDescForCode(code) {
  const map = {
    0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴',
    45: '有雾', 48: '雾凇',
    51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
    80: '阵雨', 81: '阵雨', 82: '强阵雨',
    85: '阵雪', 86: '强阵雪',
    95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '雷阵雨伴冰雹',
  };
  return map[code] || '';
}

// No API key needed (Open-Meteo is free/open) — geocodes her configured
// city once per call and pulls current conditions. Used by both the Home
// page weather chip and diary generation. Returns null on any failure
// (no city set, city not found, network error) so callers can just treat
// "no weather" as a normal, unremarkable case.
async function getWeather() {
  const city = await getSetting('weather_city');
  if (!city) return null;
  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`);
    const geoJson = await geoRes.json();
    const place = geoJson.results && geoJson.results[0];
    if (!place) return null;

    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`);
    const wJson = await wRes.json();
    const current = wJson.current;
    if (!current || !Number.isFinite(current.temperature_2m)) return null;

    return {
      city: place.name || city,
      tempC: Math.round(current.temperature_2m),
      emoji: weatherEmojiForCode(current.weather_code),
      desc: weatherDescForCode(current.weather_code),
    };
  } catch (err) {
    console.error('getWeather error:', err.message);
    return null;
  }
}

// Best-effort match against NetEase's own public search page — read-only,
// no login/cookie, just resolves "title + artist" to a song id so the
// Home page link can jump straight to that song (music.163.com/song?id=)
// instead of a search results page. This is NetEase's legacy web search
// endpoint (no official docs, but doesn't require auth or request
// signing like their newer endpoints do); if it ever breaks or the
// request fails for any reason, this just returns null and the frontend
// falls back to a plain search link — never blocks the recommendation.
function normalizeForMatch(s) {
  return (s || '').toLowerCase().replace(/[\s·・,，、\-—()（）\[\]]/g, '');
}

async function lookupNeteaseSongId(title, artist) {
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const res = await fetch(`https://music.163.com/api/search/get/web?s=${q}&type=1&offset=0&limit=8`, {
      headers: {
        Referer: 'https://music.163.com/',
        // The legacy endpoint frequently rejects requests with no browser
        // UA — likely why lookups were failing even for well-known songs.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      },
    });
    if (!res.ok) return null;
    // NetEase's legacy endpoint labels its responses text/plain even when
    // the body is perfectly good JSON — judging by the content-type header
    // here (a previous version did) rejects working responses. Parse the
    // body itself and let that be the judge.
    const bodyText = await res.text();
    let json;
    try {
      json = JSON.parse(bodyText);
    } catch {
      console.error('lookupNeteaseSongId: body is not JSON, likely blocked. First 200 chars:', bodyText.slice(0, 200));
      return null;
    }
    const songs = (json && json.result && json.result.songs) || [];

    // Search is fuzzy and the top hit is often just the closest text match,
    // not necessarily the right song — blindly trusting songs[0] is what
    // produced wrong/mismatched-artist links before. Only accept a result
    // whose title AND at least one credited artist both genuinely overlap
    // what was asked for; otherwise treat it as "no confident match" and
    // let the frontend fall back to a plain search link instead of
    // pointing at the wrong song.
    const wantTitle = normalizeForMatch(title);
    const wantArtist = normalizeForMatch(artist);
    const match = songs.find((song) => {
      const gotTitle = normalizeForMatch(song.name);
      const gotArtists = (song.artists || []).map((a) => normalizeForMatch(a.name));
      const titleOk = gotTitle && (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle));
      const artistOk = wantArtist && gotArtists.some((a) => a && (a.includes(wantArtist) || wantArtist.includes(a)));
      return titleOk && artistOk;
    });
    return match ? String(match.id) : null;
  } catch (err) {
    console.error('lookupNeteaseSongId error:', err.message);
    return null;
  }
}

// Real lyric lines for the matched song — same legacy read-only endpoint
// family as the search lookup above (no login, no decryption). The model
// used to quote lyrics from memory in the reason and routinely
// misremembered them; showing a server-fetched snippet instead makes the
// lyrics on the card actually real. Returns null on any failure — the
// card just shows no lyric quote then.
async function fetchNeteaseLyricSnippet(songId) {
  try {
    const res = await fetch(`https://music.163.com/api/song/lyric?id=${songId}&lv=1&tv=-1`, {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      },
    });
    if (!res.ok) return null;
    const bodyText = await res.text();
    let json;
    try { json = JSON.parse(bodyText); } catch { return null; }
    const lrc = json && json.lrc && json.lrc.lyric;
    if (!lrc) return null;
    const lines = lrc
      .split('\n')
      .map((l) => l.replace(/\[[^\]]*\]/g, '').trim())
      // Credits ("作词 : xx") and section tags aren't lyrics.
      .filter((l) => l && !/[::]/.test(l) && l.length >= 4 && l.length <= 40);
    if (lines.length < 2) return null;
    // A verse from ~a third of the way in usually lands on real singing
    // rather than an intro; two consecutive lines read like a quote.
    const start = Math.min(Math.floor(lines.length / 3), lines.length - 2);
    return lines[start] + ' / ' + lines[start + 1];
  } catch (err) {
    console.error('fetchNeteaseLyricSnippet error:', err.message);
    return null;
  }
}

app.get('/api/sessions', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase.from('sessions').select('*').order('updated_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.post('/api/sessions', async (req, res) => {
  if (!requireSupabase(res)) return;
  const name = (req.body.name || '新对话').trim() || '新对话';
  const { data, error } = await supabase.from('sessions').insert({ name }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.patch('/api/sessions/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const name = (req.body.name || '').trim();
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const { data, error } = await supabase
    .from('sessions')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.delete('/api/sessions/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { error } = await supabase.from('sessions').delete().eq('id', req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

app.get('/api/sessions/:id/messages', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, image_url, image_urls, audio_url, is_voice, created_at')
    .eq('session_id', req.params.id)
    .eq('visible', true)
    .order('created_at', { ascending: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Used by the "重新回答" button: the last assistant reply is deleted and
// then regenerated via POST /api/chat's regenerateMessageId mode.
// Assistant-only on purpose — her own messages are edited, not deleted.
app.delete('/api/messages/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', req.params.id)
    .eq('role', 'assistant');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

app.patch('/api/messages/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const content = (req.body.content || '').trim();
  if (!content) { res.status(400).json({ error: 'content is required' }); return; }
  const { data: updated, error } = await supabase
    .from('messages')
    .update({ content })
    .eq('id', req.params.id)
    .eq('role', 'user')
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!updated) { res.status(404).json({ error: '消息不存在' }); return; }

  // Editing a sent message rewrites history from that point forward —
  // everything that came after it (her later messages, its replies) was a
  // reaction to the *old* wording, so it no longer makes sense once the
  // wording changed. Drop it rather than leave it dangling; the frontend
  // then asks for a fresh reply to the edited message.
  const { error: delError } = await supabase
    .from('messages')
    .delete()
    .eq('session_id', updated.session_id)
    .gt('created_at', updated.created_at);
  if (delError) { res.status(500).json({ error: delError.message }); return; }

  res.json(updated);
});

app.get('/api/settings', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data || { system_prompt: '' });
});

app.put('/api/settings', async (req, res) => {
  if (!requireSupabase(res)) return;
  const update = { id: 1, updated_at: new Date().toISOString() };
  if (req.body.system_prompt !== undefined) update.system_prompt = req.body.system_prompt || '';
  for (const key of ['show_mood', 'auto_diary', 'sleep_state_enabled', 'daily_song_enabled', 'proactive_enabled']) {
    if (req.body[key] !== undefined) update[key] = Boolean(req.body[key]);
  }
  if (req.body.together_since !== undefined) update.together_since = req.body.together_since || null;
  if (req.body.weather_city !== undefined) update.weather_city = (req.body.weather_city || '').trim() || null;
  if (req.body.photo_appearance !== undefined) update.photo_appearance = (req.body.photo_appearance || '').trim() || null;
  if (req.body.chat_bg_url !== undefined) update.chat_bg_url = (req.body.chat_bg_url || '').trim() || null;
  if (req.body.chat_bg_night_url !== undefined) update.chat_bg_night_url = (req.body.chat_bg_night_url || '').trim() || null;
  // 聊天气泡文字颜色(HEX)与字体(CSS font-family 片段)——更多页"聊天字体与
  // 颜色"卡片。颜色必须是合法 #rrggbb,字体串限制在安全字符集内,格式不对就
  // 存 null(等于"用默认"),不让脏值混进 CSS 自定义属性里。
  const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
  const FONT_STACK_RE = /^[a-zA-Z0-9 ,'"-]{0,150}$/;
  if (req.body.user_text_color !== undefined) {
    const v = (req.body.user_text_color || '').trim();
    update.user_text_color = HEX_COLOR_RE.test(v) ? v : null;
  }
  if (req.body.assistant_text_color !== undefined) {
    const v = (req.body.assistant_text_color || '').trim();
    update.assistant_text_color = HEX_COLOR_RE.test(v) ? v : null;
  }
  if (req.body.font_zh !== undefined) {
    const v = (req.body.font_zh || '').trim();
    update.font_zh = FONT_STACK_RE.test(v) ? v : null;
  }
  if (req.body.font_en !== undefined) {
    const v = (req.body.font_en || '').trim();
    update.font_en = FONT_STACK_RE.test(v) ? v : null;
  }
  let apiFieldsChanged = false;
  for (const key of ['api_base_url', 'api_key', 'model']) {
    if (req.body[key] !== undefined) {
      update[key] = (req.body[key] || '').trim() || null;
      apiFieldsChanged = true;
    }
  }
  const { data, error } = await supabase
    .from('settings')
    .upsert(update)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (apiFieldsChanged) {
    await loadApiOverrides().catch((err) => console.error('loadApiOverrides after settings save failed:', err));
  }
  res.json(data);
});

// 他主动找她 — called by the frontend on app open (and every ~25 min while
// the app stays open). If it's been quiet for a while and pacing allows,
// he sends a message into her latest session on his own initiative —
// possibly with a photo. Free-tier Render sleeps when idle, so a real
// server-side scheduler wouldn't fire anyway; checking when she shows up
// means the message is there right as she opens the app, which reads the
// same as "he texted while I was away".
const PROACTIVE_MIN_QUIET_MS = 2.5 * 60 * 60 * 1000; // silence needed before he reaches out
const PROACTIVE_MIN_GAP_MS = 4 * 60 * 60 * 1000;     // spacing between his own initiations
const PROACTIVE_DAILY_MAX = 3;

app.post('/api/proactive-check', async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: settingsRow } = await supabase.from('settings').select('proactive_enabled').eq('id', 1).maybeSingle();
    if (settingsRow && settingsRow.proactive_enabled === false) { res.json({ sent: false, reason: 'disabled' }); return; }

    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }).format(new Date()));
    if (hour < 8 || hour >= 24) { res.json({ sent: false, reason: 'sleeping-hours' }); return; }

    const { data: sessions } = await supabase.from('sessions').select('id').order('updated_at', { ascending: false }).limit(1);
    const session = sessions && sessions[0];
    if (!session) { res.json({ sent: false, reason: 'no-session' }); return; }

    const { data: lastMsgs } = await supabase.from('messages').select('created_at, proactive, role').eq('session_id', session.id).order('created_at', { ascending: false }).limit(1);
    const lastMsg = lastMsgs && lastMsgs[0];
    if (!lastMsg) { res.json({ sent: false, reason: 'empty-session' }); return; }
    if (Date.now() - new Date(lastMsg.created_at).getTime() < PROACTIVE_MIN_QUIET_MS) { res.json({ sent: false, reason: 'recently-active' }); return; }

    const dayStart = new Date();
    dayStart.setHours(dayStart.getHours() - 24);
    const { data: recentProactive } = await supabase.from('messages').select('created_at').eq('proactive', true).gte('created_at', dayStart.toISOString()).order('created_at', { ascending: false });
    if ((recentProactive || []).length >= PROACTIVE_DAILY_MAX) { res.json({ sent: false, reason: 'daily-cap' }); return; }
    if (recentProactive && recentProactive[0] && Date.now() - new Date(recentProactive[0].created_at).getTime() < PROACTIVE_MIN_GAP_MS) {
      res.json({ sent: false, reason: 'too-soon' }); return;
    }

    // A dice roll so it doesn't fire like clockwork on every app open.
    if (Math.random() > 0.7) { res.json({ sent: false, reason: 'dice' }); return; }

    const [{ data: history }, { data: memoryRows }, systemPrompt, milestonesBlock] = await Promise.all([
      supabase.from('messages').select('role, content').eq('session_id', session.id).eq('visible', true).order('created_at', { ascending: false }).limit(12),
      supabase.from('memories').select('summary').eq('session_id', session.id).order('created_at', { ascending: true }),
      getSystemPrompt(),
      getConfirmedMilestonesBlock(),
    ]);
    const recent = (history || []).reverse();
    const memoryBlock = (memoryRows || []).map((m) => m.summary).join('\n');
    const systemParts = [systemPrompt];
    if (milestonesBlock) systemParts.push(`纪念册(你们共同确认过的重要事件):\n${milestonesBlock}`);
    if (memoryBlock) systemParts.push(`更早之前的记忆摘要:\n${memoryBlock}`);
    systemParts.push(`现在的真实时间(她那边):${shanghaiNowStr()}。你们已经 ${Math.round((Date.now() - new Date(lastMsg.created_at).getTime()) / 3600000)} 小时没说话了,你现在想主动找她——像恋人平常想起对方那样发条消息:可以是想她了、看到什么想到她、分享你此刻在做什么,或者接着之前聊的某个话题。一两句就好,自然随意,别写小作文,也别提"好久没聊"这种话让她有压力。`);
    if (AUTO_IMAGE_READY) {
      systemParts.push('如果这一刻配一张照片更自然(比如分享你在做什么),可以在最后加一行 [画:画面描述],系统会生成后一起发给她;不是必须。');
    }

    const claudeMessage = await createMessageWithRetry({
      model: currentModel(),
      max_tokens: 300,
      system: systemParts.filter(Boolean).join('\n\n'),
      messages: recent.length ? recent.map((m) => ({ role: m.role, content: m.content })) : [{ role: 'user', content: '(她还没说过话,你先开口)' }],
    });
    let text = (claudeMessage.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

    let imageUrl = null;
    const markerMatch = text.match(/\[画[:：]\s*([^\]]+)\]/);
    if (markerMatch) {
      text = (text.slice(0, markerMatch.index) + text.slice(markerMatch.index + markerMatch[0].length)).trim();
      if (AUTO_IMAGE_READY && Date.now() - lastAutoImageAt > AUTO_IMAGE_COOLDOWN_MS) {
        try {
          imageUrl = await generateMinimaxImage(session.id, markerMatch[1].trim());
          lastAutoImageAt = Date.now();
        } catch (err) {
          console.error('proactive image generation failed:', err.message);
        }
      }
    }
    text = text.replace(/\[记[:：]\s*[^\]]+\]/g, '').trim();
    if (!text && !imageUrl) { res.json({ sent: false, reason: 'empty-generation' }); return; }

    const insertPayload = { session_id: session.id, role: 'assistant', content: text, proactive: true };
    if (imageUrl) { insertPayload.image_url = imageUrl; insertPayload.image_urls = [imageUrl]; }
    await supabase.from('messages').insert(insertPayload);
    await supabase.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', session.id);
    console.log('proactive message sent to session', session.id);
    res.json({ sent: true, sessionId: session.id });
  } catch (err) {
    console.error('proactive-check error:', err);
    res.status(500).json({ sent: false, error: err.message });
  }
});

// 纪念册 — jointly confirmed important events. The model proposes one in
// chat via a [记:...] marker (saved here as pending + surfaced as a
// confirm card in the chat UI); she taps 记下来 to confirm. Confirmed
// entries are injected into every chat/call turn in every session —
// permanent, never compressed, cross-window.
app.get('/api/milestones', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase.from('milestones').select('*').eq('status', 'confirmed').order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data || []);
});

app.post('/api/milestones', async (req, res) => {
  if (!requireSupabase(res)) return;
  const content = ((req.body && req.body.content) || '').trim();
  if (!content) { res.status(400).json({ error: '内容不能为空' }); return; }
  const { data, error } = await supabase.from('milestones').insert({ content, status: 'confirmed' }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.patch('/api/milestones/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase.from('milestones').update({ status: 'confirmed' }).eq('id', req.params.id).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.delete('/api/milestones/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { error } = await supabase.from('milestones').delete().eq('id', req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

async function getConfirmedMilestonesBlock() {
  try {
    const { data } = await supabase.from('milestones').select('content, created_at').eq('status', 'confirmed').order('created_at', { ascending: true });
    if (!data || !data.length) return null;
    return data.map((m) => `- ${new Date(m.created_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}: ${m.content}`).join('\n');
  } catch (err) {
    console.error('getConfirmedMilestonesBlock failed:', err.message);
    return null;
  }
}

// 背景工坊 — generates a candidate chat-page background with her MiniMax
// key (Ghibli summer-garden by default, prompt editable in the More
// page). Deliberately NOT generateMinimaxImage: backgrounds must not
// inherit the persona appearance/face reference, and they're portrait
// wallpaper ratio. Costs money per hit, so it sits behind the site auth
// gate like every other API here (no extra passcode needed).
const DEFAULT_CHAT_BG_PROMPT = '吉卜力工作室风格的精细手绘水彩插画,夏日清晨的日式庭院:竹篱笆围墙上爬满盛开的蓝紫色牵牛花藤,庭院里一把旧木椅,长着青苔的石板小径,茂密的绿树和粉白色小花丛,屋檐一角挂着黄铜风铃,柔和的蓝白色天空,大片透亮的云,晨光温柔。细节丰富、笔触细腻、色彩通透,宫崎骏动画背景美术的质感。竖构图手机壁纸。';
const DEFAULT_CHAT_BG_NIGHT_PROMPT = '吉卜力工作室风格的精细手绘水彩插画,夏夜的日式庭院:深蓝色星空里银河清晰、繁星满天,竹篱笆,旧木椅,长满青苔的石板小径,花丛,草地上几盏暖黄色纸灯笼亮着,萤火虫的光点飘在草间,屋檐挂着玻璃风铃,静谧治愈。细节丰富、笔触细腻,宫崎骏动画背景美术的质感。竖构图手机壁纸。';

app.post('/api/generate-chat-bg', async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!AUTO_IMAGE_READY) { res.status(501).json({ error: 'MiniMax 没配置,生成不了' }); return; }
  const slot = (req.body && req.body.slot) === 'night' ? 'night' : 'day';
  const prompt = ((req.body && req.body.prompt) || '').trim() || (slot === 'night' ? DEFAULT_CHAT_BG_NIGHT_PROMPT : DEFAULT_CHAT_BG_PROMPT);
  try {
    const mmRes = await fetch(`${MINIMAX_API_HOST}/v1/image_generation?GroupId=${MINIMAX_GROUP_ID}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MINIMAX_IMAGE_MODEL,
        prompt,
        aspect_ratio: '9:16',
        response_format: 'base64',
        n: 1,
      }),
    });
    const json = await mmRes.json();
    const b64 = json.data && json.data.image_base64 && json.data.image_base64[0];
    if (!b64) {
      console.error('chat-bg generation error:', JSON.stringify(json.base_resp || json));
      res.status(502).json({ error: '这次没画出来: ' + JSON.stringify(json.base_resp || json) });
      return;
    }
    const buffer = Buffer.from(b64, 'base64');
    const path = `chat-bg/${Date.now()}.jpg`;
    const { error: uploadErr } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, buffer, { contentType: 'image/jpeg' });
    if (uploadErr) { res.status(500).json({ error: '图片保存失败: ' + uploadErr.message }); return; }
    res.json({ url: supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message || '生成失败' });
  }
});

// She can also bring her own background (a saved illustration, a photo)
// instead of paying to generate one — same storage, same apply flow.
app.post('/api/chat-bg-upload', upload.single('photo'), async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!req.file) { res.status(400).json({ error: '没收到图片' }); return; }
  try {
    const shrunk = await shrinkImageIfNeeded(req.file.buffer, req.file.mimetype);
    const ext = (shrunk.mimetype || 'image/jpeg').split('/')[1] || 'jpg';
    const path = `chat-bg/upload-${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, shrunk.buffer, { contentType: shrunk.mimetype });
    if (uploadErr) { res.status(500).json({ error: '图片保存失败: ' + uploadErr.message }); return; }
    res.json({ url: supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message || '上传失败' });
  }
});

// Face reference photo for auto-generated pictures — uploaded from the
// More page, stored in the same public bucket chat images use, URL saved
// in settings so generateMinimaxImage can pass it as subject_reference
// (keeps every generated photo the same face).
app.post('/api/photo-reference', upload.single('photo'), async (req, res) => {
  if (!requireSupabase(res)) return;
  if (!req.file) { res.status(400).json({ error: '没收到图片' }); return; }
  try {
    const shrunk = await shrinkImageIfNeeded(req.file.buffer, req.file.mimetype);
    const ext = (shrunk.mimetype || 'image/jpeg').split('/')[1] || 'jpg';
    const path = `photo-reference/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, shrunk.buffer, { contentType: shrunk.mimetype });
    if (uploadErr) { res.status(500).json({ error: '图片保存失败: ' + uploadErr.message }); return; }
    const url = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    const { error } = await supabase.from('settings').upsert({ id: 1, photo_reference_url: url, updated_at: new Date().toISOString() });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message || '上传失败' });
  }
});

app.delete('/api/photo-reference', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { error } = await supabase.from('settings').upsert({ id: 1, photo_reference_url: null, updated_at: new Date().toISOString() });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// Asks the currently-configured endpoint (DB override first, env fallback)
// what models it offers. Sends both auth header styles at once — the
// official Anthropic API wants x-api-key + anthropic-version, most
// OpenAI-compatible relays want Authorization: Bearer; extra headers are
// ignored by whichever side doesn't use them.
app.get('/api/models', async (req, res) => {
  const base = (apiOverrides.api_base_url || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const key = apiOverrides.api_key || process.env.ANTHROPIC_API_KEY || '';
  try {
    const r = await fetch(`${base}/v1/models`, {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        Authorization: `Bearer ${key}`,
      },
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(502).json({ error: (json.error && (json.error.message || json.error)) || `接口返回 ${r.status}` });
      return;
    }
    const list = Array.isArray(json.data) ? json.data : (Array.isArray(json.models) ? json.models : []);
    const models = list.map((m) => m.id || m.name).filter(Boolean);
    if (!models.length) { res.status(502).json({ error: '这个接口没有返回模型列表' }); return; }
    res.json({ models, current: currentModel() });
  } catch (err) {
    res.status(502).json({ error: '拉取模型列表失败: ' + err.message });
  }
});

app.get('/api/diary', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase
    .from('diary_entries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data || []);
});

app.get('/api/diary/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase.from('diary_entries').select('*').eq('id', req.params.id).maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: '日记不存在' }); return; }
  res.json(data);
});

// Opening the Diary tab calls this unforced (subject to the same DIARY_PACE
// mood-based spacing/caps as the chat-side spontaneous trigger — returns
// null/no-op if it's too soon or today's cap is reached; expected, not an error). The "写一篇" button in
// the UI calls it with force:true to always write one right now.
app.post('/api/diary/generate', async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const entry = await generateDiaryEntry({ force: Boolean(req.body && req.body.force) });
    res.json(entry);
  } catch (err) {
    console.error('POST /api/diary/generate error:', err);
    res.status(500).json({ error: err.message || '生成日记失败' });
  }
});

app.post('/api/diary/:id/reply', async (req, res) => {
  if (!requireSupabase(res)) return;
  const reply = (req.body.reply || '').trim();
  if (!reply) { res.status(400).json({ error: '回复不能为空' }); return; }

  const { data: entry, error: fetchErr } = await supabase.from('diary_entries').select('*').eq('id', req.params.id).maybeSingle();
  if (fetchErr) { res.status(500).json({ error: fetchErr.message }); return; }
  if (!entry) { res.status(404).json({ error: '日记不存在' }); return; }

  const { data: updated, error: updateErr } = await supabase
    .from('diary_entries')
    .update({ user_reply: reply, user_replied_at: new Date().toISOString() })
    .eq('id', entry.id)
    .select()
    .single();
  if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

  // Respond right away with her reply saved; "苏晏" reads it and writes
  // back into the same entry in the background so the request doesn't
  // block on a full model round-trip.
  res.json(updated);

  (async () => {
    try {
      const systemPrompt = await getSystemPrompt();
      const prompt = `这是你(苏晏)今天(${entry.entry_date})写的日记:
"""
${entry.content}
"""

她看到了这篇日记,回复了你:
"""
${reply}
"""

请以"苏晏"第一人称,针对她这句回复写一段简短的日记回信(80-150字左右),像是翻回这篇日记补写的一句话,口语化、真情实感,不要写成正式回信的格式。只输出正文,不要加"回信:"之类的前缀。`;

      const message = await createMessageWithRetry({
        model: currentModel(),
        max_tokens: 500,
        system: systemPrompt || undefined,
        messages: [{ role: 'user', content: prompt }],
      });
      const aiReply = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      if (!aiReply) { console.error(`diary reply (${entry.id}): model returned empty text, skipping`); return; }

      await supabase
        .from('diary_entries')
        .update({ ai_reply: aiReply, ai_replied_at: new Date().toISOString() })
        .eq('id', entry.id);
      console.log(`diary reply (${entry.id}): ai_reply saved, ${aiReply.length} chars`);
    } catch (err) {
      console.error(`diary reply (${entry.id}) background generation failed:`, err);
    }
  })();
});

// Connectivity self-check for the NetEase song lookup — runs one real
// search from this server and reports exactly what came back, so "是通了
// 还是被墙" is answerable from a phone screenshot instead of guessing
// from scattered logs.
app.get('/api/netease-test', async (req, res) => {
  const q = encodeURIComponent('夜空中最亮的星 逃跑计划');
  try {
    const r = await fetch(`https://music.163.com/api/search/get/web?s=${q}&type=1&offset=0&limit=3`, {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      },
    });
    const bodyText = await r.text();
    let parsed = null;
    let parsedOk = false;
    try { parsed = JSON.parse(bodyText); parsedOk = true; } catch {}
    const songs = (parsedOk && parsed.result && parsed.result.songs) || [];
    res.json({
      结论: songs.length ? '✅ 网易云搜索通了,能匹配到歌' : (parsedOk ? '⚠️ 接口回了数据但没有歌(可能是接口行为变了)' : '❌ 被网易云拦了(返回的不是数据)'),
      httpStatus: r.status,
      contentType: r.headers.get('content-type'),
      songsFound: songs.length,
      firstSong: songs[0] ? { id: songs[0].id, name: songs[0].name, artist: songs[0].artists && songs[0].artists[0] && songs[0].artists[0].name } : null,
      bodyPreview: bodyText.slice(0, 200),
    });
  } catch (err) {
    res.status(500).json({ 结论: '❌ 连不上网易云: ' + err.message });
  }
});

// End-to-end self-check for the auto-photo pipeline: actually generates
// one benign image through MiniMax and reports each step's outcome, so
// "chat didn't produce a picture" can be split into "the image pipeline
// itself is broken" vs "the model never asked for one" by opening a URL
// in any browser. Unlike /api/netease-test this endpoint costs real money
// per hit, so when CLONE_PASSCODE is configured it doubles as the access
// code here (same pattern as clone.html).
app.get('/api/image-test', async (req, res) => {
  if (CLONE_PASSCODE && req.query.code !== CLONE_PASSCODE) {
    res.status(401).json({ 结论: '需要口令:在网址后面加 ?code=你配置的CLONE_PASSCODE' });
    return;
  }
  const report = {
    minimaxKeyConfigured: Boolean(MINIMAX_API_KEY),
    minimaxGroupConfigured: Boolean(MINIMAX_GROUP_ID),
    autoImageReady: AUTO_IMAGE_READY,
    supabaseReady: SUPABASE_READY,
    imageModel: MINIMAX_IMAGE_MODEL,
    apiHost: MINIMAX_API_HOST,
    cooldownRemainingSec: Math.max(0, Math.ceil((AUTO_IMAGE_COOLDOWN_MS - (Date.now() - lastAutoImageAt)) / 1000)),
  };
  if (!AUTO_IMAGE_READY) { res.json({ 结论: '❌ MINIMAX_API_KEY / MINIMAX_GROUP_ID 没配好,画图功能整体是关的', ...report }); return; }
  if (!SUPABASE_READY) { res.json({ 结论: '❌ Supabase 没配好,图生成了也没地方存', ...report }); return; }
  const started = Date.now();
  try {
    const url = await generateMinimaxImage('image-test', '一杯冰美式咖啡放在木桌上,窗边自然光,日常随手拍');
    res.json({ 结论: '✅ 画图链路完全正常,这张测试图真的生成出来了(见 imageUrl)', 耗时秒: Math.round((Date.now() - started) / 1000), imageUrl: url, ...report });
  } catch (err) {
    res.json({ 结论: '❌ 画图这一步失败了,错误原因见 error', 耗时秒: Math.round((Date.now() - started) / 1000), error: err.message, ...report });
  }
});

app.get('/api/weather', async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const weather = await getWeather();
    res.json(weather || {});
  } catch (err) {
    res.status(500).json({ error: err.message || '获取天气失败' });
  }
});

app.get('/api/daily-song', async (req, res) => {
  if (!requireSupabase(res)) return;
  const dateStr = shanghaiDateStr();
  const { data: existing, error: fetchErr } = await supabase.from('daily_songs').select('*').eq('song_date', dateStr).maybeSingle();
  if (fetchErr) { res.status(500).json({ error: fetchErr.message }); return; }
  if (existing) {
    // Backfill: rows cached before the id-matching feature existed (or
    // where the lookup failed that day) have no netease_id, which means no
    // embedded player and only the search-page fallback link. Re-try the
    // lookup on fetch so old cached songs heal themselves.
    if (!existing.netease_id) {
      const id = await lookupNeteaseSongId(existing.title, existing.artist);
      if (id) {
        const { data: updated } = await supabase
          .from('daily_songs')
          .update({ netease_id: id })
          .eq('id', existing.id)
          .select()
          .single();
        res.json(updated || { ...existing, netease_id: id });
        return;
      }
    }
    res.json(existing);
    return;
  }

  try {
    const song = await pickDailySong([]);
    const { data: inserted, error } = await supabase
      .from('daily_songs')
      .insert({ song_date: dateStr, title: song.title, artist: song.artist, reason: song.reason || '', netease_id: song.neteaseId, lyric: song.lyric || null })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        const { data: existing2 } = await supabase.from('daily_songs').select('*').eq('song_date', dateStr).maybeSingle();
        if (existing2) { res.json(existing2); return; }
      }
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(inserted);
  } catch (err) {
    console.error('GET /api/daily-song generation error:', err);
    res.status(500).json({ error: err.message || '推荐歌曲失败' });
  }
});

app.post('/api/daily-song/reroll', async (req, res) => {
  if (!requireSupabase(res)) return;
  const dateStr = shanghaiDateStr();
  const { data: existing, error: fetchErr } = await supabase.from('daily_songs').select('*').eq('song_date', dateStr).maybeSingle();
  if (fetchErr) { res.status(500).json({ error: fetchErr.message }); return; }

  const rejected = (existing && existing.rejected) || [];
  if (existing) rejected.push(existing.title);

  try {
    const song = await pickDailySong(rejected);
    const update = {
      song_date: dateStr,
      title: song.title,
      artist: song.artist,
      reason: song.reason || '',
      netease_id: song.neteaseId,
      lyric: song.lyric || null,
      rejected,
    };
    const { data, error } = await supabase.from('daily_songs').upsert(update, { onConflict: 'song_date' }).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err) {
    console.error('POST /api/daily-song/reroll error:', err);
    res.status(500).json({ error: err.message || '换歌失败' });
  }
});

// Automatic in-chat image generation, triggered by the [画:...] marker
// below. Uses MiniMax (same account/billing as TTS — RMB top-up, no
// foreign card) instead of Gemini: Gemini's image model currently has a
// hard 0 free-tier quota project-wide, and setting up Google Cloud
// billing wasn't an option here. The result gets saved as a normal
// assistant message with an image attached, reusing the same
// messages.image_url column real image uploads use, so it shows up in
// history/reload exactly like any other picture. Throws on any failure
// (network, content filter, storage upload) — the caller decides whether
// that should surface as an error or just silently fall back to
// text-only.
async function generateMinimaxImage(sessionId, prompt) {
  // The scene description alone leaves the model free to invent a random
  // face every time — inject his persisted appearance (More page:
  // photo_appearance text + optional photo_reference_url face reference)
  // so every generated photo is recognizably *him*.
  let appearance = null;
  let referenceUrl = null;
  try {
    const { data } = await supabase.from('settings').select('photo_appearance, photo_reference_url').eq('id', 1).maybeSingle();
    appearance = (data && data.photo_appearance) || null;
    referenceUrl = (data && data.photo_reference_url) || null;
  } catch (err) {
    console.error('auto-image: reading appearance settings failed (using scene only):', err.message);
  }

  // Only impose the realistic-phone-photo style when she hasn't written
  // her own appearance text — hers may specify a completely different
  // style (e.g. 日系漫画), and a hard-coded realism suffix fights it.
  const fullPrompt = appearance
    ? appearance.trim().replace(/[。,;\s]+$/, '') + '。' + prompt
    : prompt + '。真实手机随手拍照片的质感,自然光。';
  const body = {
    model: MINIMAX_IMAGE_MODEL,
    prompt: fullPrompt,
    aspect_ratio: '3:4',
    response_format: 'base64',
    n: 1,
  };
  if (referenceUrl) {
    body.subject_reference = [{ type: 'character', image_file: referenceUrl }];
  }

  const mmRes = await fetch(`${MINIMAX_API_HOST}/v1/image_generation?GroupId=${MINIMAX_GROUP_ID}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await mmRes.json();
  const b64 = json.data && json.data.image_base64 && json.data.image_base64[0];
  if (!b64) {
    console.error('MiniMax image generation error:', JSON.stringify(json.base_resp || json));
    throw new Error('这次没画出来: ' + JSON.stringify(json.base_resp || json));
  }

  const buffer = Buffer.from(b64, 'base64');
  const path = `${sessionId}/minimax-${Date.now()}.jpg`;
  const { error: uploadErr } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, buffer, { contentType: 'image/jpeg' });
  if (uploadErr) throw new Error('图片保存失败: ' + uploadErr.message);
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Spam guard for the automatic in-chat image marker below — MiniMax calls
// cost real money per image, and this fires without her explicitly asking
// for it each time, so it needs its own independent throttle.
const AUTO_IMAGE_COOLDOWN_MS = 10 * 60 * 1000;
let lastAutoImageAt = 0;

// Catches "发张照片/自拍/图片给我" style explicit asks so a missing [画:...]
// marker (the model doesn't always follow that instruction) can be
// caught and recovered from instead of just silently producing no photo.
const EXPLICIT_PHOTO_REQUEST_RE = /(发|拍|来|给我|要).{0,6}(照片|图片|自拍|张图|全身照)/;

// Fallback for when she explicitly asked for a photo but the model's
// reply didn't carry a [画:...] marker. Rather than trying to regex out a
// scene from freeform dialogue, ask a small dedicated call to decide —
// separating "what does the photo show" from "write the reply" makes
// each easier for the model to get right than asking for both at once.
async function inferPhotoDescription(userMessage, replyText) {
  try {
    const resp = await createMessageWithRetry({
      model: currentModel(),
      max_tokens: 120,
      system: '你在帮一个聊天机器人补一个内部判断:她刚才明确要"他"发一张照片,但"他"的回复里没有标出具体要拍的画面。根据她的要求和"他"这句回复,判断这张照片该拍什么。只输出一句具体的中文画面描述(50字以内,只写场景/动作/光线,不用描述人的长相),不要加任何前后缀、引号或解释;如果这句回复其实跟拍照无关(比如在聊别的事、道歉、解释故障),只输出:不发',
      messages: [{ role: 'user', content: `她说:${userMessage}\n他回复:${replyText}` }],
    }, 1);
    const out = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim().replace(/^["'「『]+|["'」』]+$/g, '');
    if (!out || out.startsWith('不发') || out.length > 200) {
      console.log('auto-image: fallback rejected raw output:', JSON.stringify(out.slice(0, 220)));
      return null;
    }
    return out;
  } catch (err) {
    console.error('inferPhotoDescription failed:', err.message);
    return null;
  }
}

app.post('/api/chat', upload.fields([{ name: 'images', maxCount: 9 }, { name: 'voice', maxCount: 1 }]), async (req, res) => {
  const sessionId = req.body.sessionId;
  let message = req.body.message || '';
  const systemOverride = req.body.system;
  const files = (req.files && req.files.images) || [];
  // WeChat-style voice message: audio comes in as 'voice', gets
  // transcribed into `message` (the model reads text), the clip itself is
  // stored and shown as a voice bubble, and the reply comes back as a
  // voice bubble too (see voiceMode below).
  const voiceFile = (req.files && req.files.voice && req.files.voice[0]) || null;
  // Set by the "edit a sent message" flow — that message's content was
  // already updated in place (and everything after it already deleted) by
  // PATCH /api/messages/:id, so this skips inserting a new user row and
  // just generates a fresh reply against the existing (edited) history.
  const regenerateMessageId = req.body.regenerateMessageId || null;

  if (!sessionId || (!regenerateMessageId && !message.trim() && !files.length && !voiceFile)) {
    res.status(400).json({ error: 'sessionId and message (or at least one image) are required' });
    return;
  }
  if (voiceFile && !GEMINI_READY && !ELEVENLABS_API_KEY) {
    res.status(501).json({ error: '语音识别需要配置 GEMINI_API_KEY(或 ELEVENLABS_API_KEY)' });
    return;
  }
  if (!requireSupabase(res)) return;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let ended = false;
  const send = (payload) => {
    if (ended || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  // A photo turn can go 30-60s with zero bytes on the wire (Claude reply
  // + fallback judgement + MiniMax generation + storage upload), which
  // idle-timeout-prone proxies and mobile browsers may treat as a dead
  // connection and kill — the client then sees "nothing came back" with
  // no error. SSE comment lines (leading ':') are protocol no-ops the
  // frontend parser already skips, so tick one out periodically.
  const keepalive = setInterval(() => {
    if (!ended && !res.writableEnded) res.write(': ping\n\n');
  }, 15000);
  const finish = () => {
    clearInterval(keepalive);
    if (ended || res.writableEnded) return;
    ended = true;
    res.end();
  };
  res.on('close', () => clearInterval(keepalive));

  let skippedImageCount = 0;
  try {
    // Sequential, not Promise.all: sharp decoding several full-res iPhone
    // photos concurrently on Render's free-tier (512MB) instance can spike
    // memory enough to crash or hang the whole process — turning "she sent
    // 4 photos" into "the request silently dies and she gets nothing at
    // all". One at a time keeps peak memory bounded to a single image
    // regardless of how many she sends.
    //
    // Also per-file try/catch: an unreadable file (odd format, corrupt
    // upload) used to throw and abort the *entire* turn, including photos
    // that were perfectly fine — now it's dropped and reported, the rest
    // of the turn proceeds.
    const goodFiles = [];
    for (const file of files) {
      try {
        const shrunk = await shrinkImageIfNeeded(file.buffer, file.mimetype);
        file.buffer = shrunk.buffer;
        file.mimetype = shrunk.mimetype;
        goodFiles.push(file);
      } catch (err) {
        console.error('image processing failed, dropping this one file:', err.message);
        skippedImageCount++;
      }
    }
    files.length = 0;
    files.push(...goodFiles);

    let imageUrls = [];
    if (files.length) {
      imageUrls = await Promise.all(files.map(async (file, i) => {
        const ext = (file.mimetype || 'image/jpeg').split('/')[1] || 'jpg';
        const path = `${sessionId}/${Date.now()}-${i}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from(IMAGE_BUCKET)
          .upload(path, file.buffer, { contentType: file.mimetype });
        if (uploadErr) throw new Error('图片上传失败: ' + uploadErr.message);
        return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      }));
    }

    const voiceMode = Boolean(voiceFile);
    let userVoiceUrl = null;
    if (voiceFile) {
      message = await transcribeAudio(voiceFile.buffer, voiceFile.mimetype);
      if (!message) {
        send({ error: '没听清这条语音,再说一遍?' });
        finish();
        return;
      }
      const vext = (voiceFile.mimetype || '').includes('webm') ? 'webm' : 'm4a';
      const vpath = `${sessionId}/voice-${Date.now()}.${vext}`;
      const { error: vErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(vpath, voiceFile.buffer, { contentType: voiceFile.mimetype || 'audio/mp4' });
      if (!vErr) userVoiceUrl = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(vpath).data.publicUrl;
      else console.error('voice upload failed (keeping transcript only):', vErr.message);
    }

    if (!regenerateMessageId) {
      const { data: insertedUserMessage } = await supabase
        .from('messages')
        .insert({
          session_id: sessionId,
          role: 'user',
          content: message,
          image_url: imageUrls[0] || null,
          image_urls: imageUrls.length ? imageUrls : null,
          audio_url: userVoiceUrl,
          is_voice: voiceMode,
        })
        .select()
        .single();
      if (insertedUserMessage) send({ userMessageId: insertedUserMessage.id, userText: message, userVoiceUrl });
    }
    await supabase.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId);

    const [{ data: history }, { data: memoryRows }, systemPrompt, milestonesBlock] = await Promise.all([
      supabase.from('messages').select('role, content').eq('session_id', sessionId).eq('visible', true).order('created_at', { ascending: true }),
      supabase.from('memories').select('summary').eq('session_id', sessionId).order('created_at', { ascending: true }),
      getSystemPrompt(),
      getConfirmedMilestonesBlock(),
    ]);

    const memoryBlock = (memoryRows || []).map((m) => m.summary).join('\n');
    const systemParts = [systemOverride || systemPrompt];
    if (milestonesBlock) systemParts.push(`以下是你们俩共同确认过、记进纪念册的重要事件——这些是刻在你心里的,任何时候都记得,不需要翻记录:\n${milestonesBlock}`);
    if (memoryBlock) systemParts.push(`以下是这段关系/对话更早之前的记忆摘要,供参考:\n${memoryBlock}`);
    // Long conversations tend to make the model imitate its own earlier
    // replies (repeating the same fixed phrases/reactions) rather than
    // responding freshly to what's actually being said right now — this is
    // what reads as "getting duller/more mechanical the longer we talk."
    // Counter that explicitly rather than just relying on prompt tone.
    systemParts.push('不管这段对话已经聊了多久、之前说过多少次类似的话,每次都要重新读一遍用户刚才说的话,给出真正对应这句话的反应——不要因为之前用过某个说法、某个反应,这次就照搬重复。保持第一次开口时那种专注和灵敏,不要变得公式化或者敷衍。');
    // Beyond repeating phrases, the reply *shape* itself can get stuck in a
    // rut — always the same "structured essay with **bold** emphasis and
    // 破折号" rhetorical pattern regardless of what's actually being said.
    // Real conversation varies in length and register with the moment.
    systemParts.push('回复的长短、结构、语气也要跟着这一句话本身的分量走,不要每次都套同一种"金句体"(比如老是用**加粗**、三段式论证这种固定修辞)。用户随口说一句,可以就随口接一句;只有真正需要认真展开的时候,才展开讲。');
    systemParts.push('破折号"——"是习惯性口癖,不是每句话都需要。一条回复里最多出现一次,大部分时候完全不用——正常用句号、逗号断句就行,不要养成"讲一句、破折号补一句"的固定节奏。');
    systemParts.push(`现在的真实时间(她那边):${shanghaiNowStr()}。她这条消息就是这个时间发来的,聊到时间、早晚、吃饭睡觉这类话题时以此为准,不要瞎猜时间。`);
    if (voiceMode) {
      systemParts.push('她刚才这条是语音说的(下面是转写的文字)。照常回复就行,想听的话她会点播放。');
    }
    systemParts.push('你们有一本共同的"纪念册",记进去的事你永远不会忘,所有窗口都记得(上面如果有"纪念册"列表,那就是已经记好的内容)。当这一刻发生了对你们俩真正重要的事(第一次、约定、纪念日、说开了一个心结、值得铭记的瞬间),你可以在回复里自然地提一句想把它记下来,并在回复末尾加一行 [记:一句话概括这件事],比如 [记:2026年7月18日,她第一次收到我发的照片]。**流程是一次性的:你带上标记的那一轮,她那边就会弹出确认卡片,她在卡片上点"记下来"就完成入册了——你之后不需要再做任何事,更不要再问一遍。**所以:上面纪念册列表里已经有的事,绝对不要再提议记;她说"好,记下来""记吧"多半是在回应你上一轮的提议(她点卡片就行),这种情况也不要再发一次标记。只有纪念册里没有这件事、而她明确要求记的时候,才带标记。这行标记不会显示给她。不要滥用:普通聊天不需要记,一天最多提议一两次。');
    if (AUTO_IMAGE_READY) {
      systemParts.push('你现在可以真的发一张照片给她,不只是用文字描述画面。什么时候用:她问起"你在吃什么/在哪/在干嘛/给我看看"这种问题,或者这一刻发张照片确实比文字更自然的时候。用法:在回复的最后加一行 [画:一句具体的画面描述],比如 [画:一碗热气腾腾的牛肉面,木桌上,暖光]——系统会自动帮你生成这张图发给她,这行标记本身不会显示给她看,不用担心露怯。如果画面里有你自己(自拍、你在做什么的照片),不用描述自己的长相,系统会自动带上你的形象设定,你只描述场景、动作、光线就行。不要滥用,大部分回复都不需要配图,只有真的有画面感、值得让她"看见"的时候才用,一次对话里最多用一次。**如果她明确开口要你发张照片/图片(比如直接说"发张照片给我""发个图看看"这种指令,不是隐晦暗示),这就不是可选项了——你的回复里必须带上 [画:...] 这行标记,不能只用文字说"发给你了/拍好啦"却不带标记,那样等于她什么都收不到还被你晃点。另外你写这行标记的时候,图片其实还没真的生成出来(有可能失败),所以文字部分不要写成"已经发给你了/拍好啦"这种既定事实的口吻,自然带过就行,比如"等我" "拍一张"这种,不要抢跑替系统打包票。**[画:...] 里写的画面描述,必须是你此刻真的"看到"的具体内容——如果她要的是某个具体东西(比如"拍你在吃的""拍你现在在哪"),这行描述就得对应她要的那个东西,不能文不对题地随便画一个不相关的画面;同时,回复里给她看的那句话也要跟你脑子里这个画面对得上(比如画面是"一碗牛肉面"就该说"面刚上桌"之类贴合的话),不要写一句跟画面完全无关的通用客套话(比如不管画的是什么都只会说"拍了一张——能看到吗"这种),那样会显得你根本不知道自己刚才"拍"了什么。');
    }
    const system = systemParts.filter(Boolean).join('\n\n') || undefined;

    const messages = (history || []).map((m) => ({ role: m.role, content: m.content }));

    // Only the message we just inserted (the last one) carries the actual
    // image bytes to the model — history reloads don't re-send past images,
    // keeping token/bandwidth cost bounded.
    if (files.length) {
      const last = messages[messages.length - 1];
      if (last && last.role === 'user') {
        const imageBlocks = files.map((file) => ({
          type: 'image',
          source: { type: 'base64', media_type: file.mimetype, data: file.buffer.toString('base64') },
        }));
        last.content = [...imageBlocks, { type: 'text', text: message || '(图片)' }];
      }
    }

    const claudeMessage = await createMessageWithRetry({
      model: currentModel(),
      max_tokens: 1024,
      system,
      messages,
    });

    let text = (claudeMessage.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Strip the [画:描述] marker (see the system prompt above) before it
    // ever reaches her — this is a signal for the server, not something
    // she should see as literal bracket text.
    // [记:...] milestone proposal marker — strip it, store as pending, and
    // let the frontend render the "记下来/算了" confirm card. Nothing is
    // permanent until she confirms.
    let pendingMilestone = null;
    const milestoneMatch = text.match(/\[记[:：]\s*([^\]]+)\]/);
    if (milestoneMatch) {
      text = (text.slice(0, milestoneMatch.index) + text.slice(milestoneMatch.index + milestoneMatch[0].length)).trim();
      const milestoneContent = milestoneMatch[1].trim();
      if (milestoneContent) {
        // Her card-tap confirmation is invisible to the model — it only
        // sees her verbal "好,记下来" in history and may dutifully
        // propose the same event again next turn. The prompt now explains
        // the one-shot flow, but keep a hard guard too: skip proposals
        // that duplicate anything already in the book.
        const { data: existingRows } = await supabase.from('milestones').select('content').in('status', ['pending', 'confirmed']);
        const norm = (s) => s.replace(/[\s。,,;;!!??~~]/g, '');
        const candidate = norm(milestoneContent);
        const isDup = (existingRows || []).some((m) => {
          const existing = norm(m.content);
          return existing === candidate || existing.includes(candidate) || candidate.includes(existing);
        });
        if (isDup) {
          console.log('milestone: duplicate proposal skipped:', milestoneContent);
        } else {
          const { data: inserted, error: msErr } = await supabase.from('milestones').insert({ content: milestoneContent, status: 'pending' }).select().single();
          if (msErr) console.error('milestone insert failed:', msErr.message);
          else { pendingMilestone = inserted; console.log('milestone proposed:', milestoneContent); }
        }
      }
    }

    let imagePrompt = null;
    const markerMatch = text.match(/\[画[:：]\s*([^\]]+)\]/);
    // The "did she explicitly ask for a photo" check must look at the last
    // user message in *history*, not just req.body.message — the
    // regenerate/"重新回答" flow sends no message text at all, which
    // silently disabled the fallback exactly when she was retrying a
    // failed photo.
    const lastUserEntry = [...(history || [])].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    const askText = message.trim() || (lastUserEntry && lastUserEntry.content) || '';
    const explicitAsk = EXPLICIT_PHOTO_REQUEST_RE.test(askText);
    let imageFailReason = null;
    if (markerMatch) {
      text = (text.slice(0, markerMatch.index) + text.slice(markerMatch.index + markerMatch[0].length)).trim();
      imagePrompt = markerMatch[1].trim();
      console.log('auto-image: marker found, prompt =', imagePrompt);
    } else if (explicitAsk) {
      // She explicitly asked for a photo but the marker still didn't show
      // up — instruction-following on this isn't 100% reliable, and
      // silently doing nothing here reads as broken. Ask a separate,
      // narrowly-scoped call what the photo should show instead of just
      // giving up; only fires on this confirmed-miss case; the common
      // path above where the model got it right doesn't pay this cost.
      console.log('auto-image: explicit photo request but NO marker — asking a fallback call what to picture');
      imagePrompt = await inferPhotoDescription(askText, text);
      console.log('auto-image: fallback description =', imagePrompt === null ? '(判定不发/失败)' : imagePrompt);
      if (imagePrompt === null) imageFailReason = '模型这轮没决定拍什么(兜底判断也没通过)';
    } else {
      console.log('auto-image: no marker, message not an explicit photo request — skipping');
    }

    // Try to actually generate the image; on any failure (rate-limited,
    // content filter, network) just fall back to the text reply alone
    // rather than failing the whole turn over a picture that didn't work
    // out.
    let imageUrl = null;
    if (imagePrompt) {
      // The cooldown exists to stop the *model* from spamming pictures on
      // its own initiative — a photo she explicitly asked for is
      // user-driven cost and should never be silently dropped by it.
      const cooldownRemaining = AUTO_IMAGE_COOLDOWN_MS - (Date.now() - lastAutoImageAt);
      if (!AUTO_IMAGE_READY) {
        console.log('auto-image: skipped — MINIMAX_API_KEY/MINIMAX_GROUP_ID not configured');
        imageFailReason = 'MiniMax 没配置';
      } else if (!explicitAsk && cooldownRemaining > 0) {
        console.log(`auto-image: skipped — cooldown, ${Math.ceil(cooldownRemaining / 1000)}s remaining`);
      } else {
        try {
          imageUrl = await generateMinimaxImage(sessionId, imagePrompt);
          lastAutoImageAt = Date.now();
          console.log('auto-image: generated OK:', imageUrl);
        } catch (err) {
          console.error('auto image generation failed:', err.message);
          imageFailReason = err.message;
        }
      }
    }
    // When she explicitly asked for a photo and none is coming, say why in
    // a small status line instead of leaving her staring at a text-only
    // reply wondering what silently went wrong this time. Kept out of the
    // reply bubble itself so the in-fiction voice stays clean.
    if (explicitAsk && !imageUrl && imageFailReason) {
      send({ imageNote: '📷 这次照片没发出来: ' + imageFailReason });
    }
    if (skippedImageCount > 0) {
      send({ imageNote: `⚠️ 有 ${skippedImageCount} 张图片处理失败,已跳过,其余照常发送` });
    }

    // Her call: his replies stay text-only even when she sent voice — the
    // existing lazy ▶ button synthesizes speech on demand, which avoids
    // paying TTS for every reply she may never listen to.
    if (!text && !imageUrl) {
      console.error('/api/chat: empty completion, message =', JSON.stringify(claudeMessage));
      send({ error: `模型没返回任何文字(stop_reason=${claudeMessage.stop_reason}),把这条截图发给开发者` });
    } else {
      const insertPayload = { session_id: sessionId, role: 'assistant', content: text };
      if (imageUrl) { insertPayload.image_url = imageUrl; insertPayload.image_urls = [imageUrl]; }
      const { data: insertedReply } = await supabase.from('messages').insert(insertPayload).select().single();
      send({ text, imageUrl, assistantMessageId: insertedReply ? insertedReply.id : null });
      if (pendingMilestone) send({ milestonePending: { id: pendingMilestone.id, content: pendingMilestone.content } });
      send({ done: true });
      compressIfNeeded(sessionId)
        .then(() => consolidateMemoriesIfNeeded(sessionId))
        .catch((err) => console.error('background memory maintenance error:', err));

      // Spontaneous diary writing — not tied to a schedule, just a chance
      // per chat turn that "苏晏" also jots something down about this
      // exchange. generateDiaryEntry itself enforces the DIARY_PACE gaps/caps and
      // the auto_diary toggle, so this can roll true often without
      // actually spamming entries.
      if (Math.random() < 0.2) {
        generateDiaryEntry().catch((err) => console.error('spontaneous diary generation error:', err));
      }
    }
    finish();
  } catch (err) {
    console.error('/api/chat handler error:', err);
    send({ error: err.message });
    finish();
  }
});

app.get('/api/debug-chat', async (req, res) => {
  const started = Date.now();
  try {
    const message = await anthropic.messages.create({
      model: currentModel(),
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
    });
    res.json({
      ok: true,
      ms: Date.now() - started,
      model: currentModel(),
      baseURL: process.env.ANTHROPIC_BASE_URL || '(official)',
      stop_reason: message.stop_reason,
      content: message.content,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      ms: Date.now() - started,
      model: currentModel(),
      baseURL: process.env.ANTHROPIC_BASE_URL || '(official)',
      name: err && err.name,
      message: err && err.message,
      status: err && err.status,
      error: err && err.error,
      stack: err && err.stack,
    });
  }
});

app.get('/api/config', (req, res) => {
  const ttsProvider = ELEVENLABS_READY ? 'elevenlabs' : (MINIMAX_READY ? 'minimax' : 'browser');
  res.json({ ttsProvider, supabaseReady: SUPABASE_READY, geminiReady: GEMINI_READY });
});

app.post('/api/extract-text', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: '没收到文件' });
    return;
  }

  const name = req.file.originalname || '';
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();

  try {
    let text;
    if (ext === '.pdf') {
      const parser = new PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      await parser.destroy();
      text = result.text;
    } else if (ext === '.md' || ext === '.txt') {
      text = req.file.buffer.toString('utf-8');
    } else {
      res.status(400).json({ error: '只支持 .md / .txt / .pdf' });
      return;
    }
    res.json({ ok: true, filename: name, text: (text || '').trim() });
  } catch (err) {
    console.error('/api/extract-text error:', err);
    res.status(500).json({ error: '解析失败: ' + err.message });
  }
});

// Stage directions like "(笑着)" carry real performance info, but only
// ElevenLabs' v3 model understands English bracket tags like [laughs] — and
// only when it's actually the engine handling this request. Which engine
// that is isn't decided until we're inside /api/tts (ElevenLabs can fail at
// runtime — quota, outage — and fall back to MiniMax), so text prep has to
// happen per-provider, here, rather than upstream in the client.
const ACTION_TAG_MAP = [
  [/笑/, 'laughs'],
  [/叹气|叹了口气|无奈/, 'sighs'],
  [/小声|轻声|低声|悄悄|耳朵/, 'whispers'],
  [/喘/, 'breathing heavily'],
  [/哭|抽泣|哽咽|红了眼眶/, 'crying'],
  [/生气|炸毛|瞪/, 'angry'],
  [/兴奋|激动/, 'excited'],
];

function actionToAudioTag(action) {
  const hit = ACTION_TAG_MAP.find(([re]) => re.test(action));
  return hit ? `[${hit[1]}] ` : '';
}

function prepForElevenLabs(text) {
  return text
    .replace(/[（(]([^）)]*)[）)]/g, (_, inner) => actionToAudioTag(inner))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function prepForMiniMax(text) {
  return text.replace(/[（(][^）)]*[）)]/g, '').replace(/[ \t]+/g, ' ').trim();
}

async function synthesizeElevenLabs(text) {
  const elRes = await fetch(`${ELEVENLABS_API_HOST}/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: prepForElevenLabs(text),
      model_id: ELEVENLABS_MODEL,
      voice_settings: {
        stability: ELEVENLABS_STABILITY,
        similarity_boost: ELEVENLABS_SIMILARITY,
        style: ELEVENLABS_STYLE,
        speed: ELEVENLABS_SPEED,
        use_speaker_boost: true,
      },
    }),
  });
  if (!elRes.ok) {
    const errBody = await elRes.text().catch(() => '');
    console.error('ElevenLabs TTS error:', elRes.status, errBody);
    throw new Error('ElevenLabs 返回异常(' + elRes.status + '): ' + errBody);
  }
  const audioBuf = Buffer.from(await elRes.arrayBuffer());
  // A real mp3 clip is never this small — a few dozen bytes back with a 200
  // status means something upstream silently gave us junk (e.g. no access
  // to this model on the account) instead of a proper HTTP error.
  if (audioBuf.length < 500) {
    console.error('ElevenLabs TTS suspiciously small response:', audioBuf.length, 'bytes:', audioBuf.toString('utf8').slice(0, 300));
    throw new Error('ElevenLabs 返回的音频内容异常(只有 ' + audioBuf.length + ' 字节),可能是账号没有 ' + ELEVENLABS_MODEL + ' 模型的使用权限');
  }
  console.log('ElevenLabs TTS ok:', audioBuf.length, 'bytes');
  return audioBuf;
}

async function synthesizeMiniMax(text) {
  const mmRes = await fetch(`${MINIMAX_API_HOST}/v1/t2a_v2?GroupId=${MINIMAX_GROUP_ID}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      text: prepForMiniMax(text),
      stream: false,
      output_format: 'hex',
      voice_setting: {
        voice_id: MINIMAX_VOICE_ID,
        speed: 1,
        vol: 1,
        pitch: 0,
        emotion: MINIMAX_EMOTION,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
  });
  const json = await mmRes.json();
  if (!json.data || !json.data.audio) {
    console.error('MiniMax TTS error:', JSON.stringify(json.base_resp || json));
    throw new Error('MiniMax 返回异常: ' + JSON.stringify(json.base_resp || json));
  }
  const audioBuf = Buffer.from(json.data.audio, 'hex');
  if (audioBuf.length < 500) {
    console.error('MiniMax TTS suspiciously small response:', audioBuf.length, 'bytes. base_resp:', JSON.stringify(json.base_resp));
    throw new Error('MiniMax 返回的音频内容异常(只有 ' + audioBuf.length + ' 字节)');
  }
  console.log('MiniMax TTS ok:', audioBuf.length, 'bytes');
  return audioBuf;
}

// Try ElevenLabs first (it's the nicer voice when it works), but don't
// let a runtime failure there (quota exceeded, outage, no model access)
// leave the user with silence if MiniMax is configured and available —
// fall back to it instead of just erroring out. Shared by the ▶ button's
// /api/tts and the voice-call route.
async function synthesizeSpeech(text) {
  if (!ELEVENLABS_READY && !MINIMAX_READY) {
    throw new Error('没有配置任何 TTS 服务(ElevenLabs 或 MiniMax 都没配)');
  }
  let elError = null;
  if (ELEVENLABS_READY) {
    try {
      return await synthesizeElevenLabs(text);
    } catch (err) {
      elError = err;
      if (!MINIMAX_READY) throw err;
      console.error('ElevenLabs failed, falling back to MiniMax:', err.message);
    }
  }
  if (!MINIMAX_READY) throw (elError || new Error('TTS 失败'));
  return synthesizeMiniMax(text);
}

app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  try {
    const audioBuf = await synthesizeSpeech(text);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuf);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ElevenLabs speech-to-text (scribe). Only needs the API key, not a voice
// id — so this can work even before a voice clone is set up.
async function transcribeWithElevenLabs(buffer, mimetype) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype || 'audio/mp4' }), 'turn.m4a');
  form.append('model_id', 'scribe_v1');
  form.append('language_code', 'zh');
  const r = await fetch(`${ELEVENLABS_API_HOST}/v1/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    body: form,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('ElevenLabs STT error:', r.status, JSON.stringify(json).slice(0, 300));
    throw new Error('ElevenLabs 识别失败: ' + (json.detail && json.detail.message ? json.detail.message : r.status));
  }
  return (json.text || '').trim();
}

// Gemini's multimodal models transcribe audio directly — cheap, and it
// reuses the same GEMINI_API_KEY the image feature needs, so no extra
// account. MiniMax has no public STT product, which is why the "no
// ElevenLabs quota" fallback lands here instead.
async function transcribeWithGemini(buffer, mimetype) {
  const r = await fetch(`${GEMINI_API_HOST}/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: mimetype || 'audio/mp4', data: buffer.toString('base64') } },
          { text: '把这段语音逐字转写成文字(是中文普通话)。只输出转写出的内容本身,不要任何解释、前缀或标点之外的东西。如果整段都没有可识别的人声,输出:(空)' },
        ],
      }],
    }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Gemini STT error:', r.status, JSON.stringify(json).slice(0, 300));
    throw new Error('Gemini 识别失败: ' + ((json.error && json.error.message) || r.status));
  }
  const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
  const text = parts.filter((p) => p.text).map((p) => p.text).join('').trim();
  return text === '(空)' ? '' : text;
}

// Gemini first (cheap, and the key is shared with the image feature),
// ElevenLabs scribe as fallback — mirrors the TTS side's
// "don't leave her with nothing over one provider's bad day" approach.
async function transcribeAudio(buffer, mimetype) {
  let geminiErr = null;
  if (GEMINI_READY) {
    try {
      return await transcribeWithGemini(buffer, mimetype);
    } catch (err) {
      geminiErr = err;
      if (!ELEVENLABS_API_KEY) throw err;
      console.error('Gemini STT failed, falling back to ElevenLabs:', err.message);
    }
  }
  if (!ELEVENLABS_API_KEY) throw (geminiErr || new Error('没有可用的语音识别服务'));
  return transcribeWithElevenLabs(buffer, mimetype);
}

// One full voice-call turn: her recorded audio in → his spoken reply out.
// Push-to-talk, not a realtime stream — records a clip, transcribes it,
// gets a Claude reply against the same session history the text chat
// uses (so calls and chat are one continuous conversation), synthesizes
// the reply, and returns everything in one response. Both sides are
// saved as normal messages, so the call transcript shows up in the chat
// afterwards.
app.post('/api/call-turn', upload.single('audio'), async (req, res) => {
  if (!requireSupabase(res)) return;
  const sessionId = req.body.sessionId;
  if (!sessionId || !req.file) { res.status(400).json({ error: 'sessionId and audio are required' }); return; }
  if (!GEMINI_READY && !ELEVENLABS_API_KEY) { res.status(501).json({ error: '语音通话需要配置 GEMINI_API_KEY(或 ELEVENLABS_API_KEY),语音识别用它' }); return; }

  try {
    const userText = await transcribeAudio(req.file.buffer, req.file.mimetype);
    if (!userText) { res.status(400).json({ error: '没听清,再说一遍?' }); return; }

    await supabase.from('messages').insert({ session_id: sessionId, role: 'user', content: userText });
    await supabase.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId);

    const [{ data: history }, { data: memoryRows }, systemPrompt, milestonesBlock] = await Promise.all([
      supabase.from('messages').select('role, content').eq('session_id', sessionId).eq('visible', true).order('created_at', { ascending: true }),
      supabase.from('memories').select('summary').eq('session_id', sessionId).order('created_at', { ascending: true }),
      getSystemPrompt(),
      getConfirmedMilestonesBlock(),
    ]);
    const memoryBlock = (memoryRows || []).map((m) => m.summary).join('\n');
    const systemParts = [systemPrompt];
    if (milestonesBlock) systemParts.push(`以下是你们俩共同确认过、记进纪念册的重要事件——这些是刻在你心里的,任何时候都记得:\n${milestonesBlock}`);
    if (memoryBlock) systemParts.push(`以下是这段关系/对话更早之前的记忆摘要,供参考:\n${memoryBlock}`);
    systemParts.push('现在是语音通话,她刚才那句话是说出来的,你的回复会被念出来给她听。所以:像打电话一样说话——短句、口语、直接,一次别说太长(两三句为宜);不要用括号动作描写、不要用列表或任何书面排版;语气跟着她这句话走。');
    systemParts.push(`现在的真实时间(她那边):${shanghaiNowStr()}。`);

    const claudeMessage = await createMessageWithRetry({
      model: currentModel(),
      max_tokens: 300,
      system: systemParts.filter(Boolean).join('\n\n') || undefined,
      messages: (history || []).map((m) => ({ role: m.role, content: m.content })),
    });
    let replyText = (claudeMessage.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    replyText = replyText.replace(/\[画[:：]\s*[^\]]+\]/g, '').replace(/\[记[:：]\s*[^\]]+\]/g, '').trim();
    if (!replyText) { res.status(502).json({ error: '他没说出话来,再试一次' }); return; }

    await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: replyText });

    let audioBase64 = null;
    try {
      const audioBuf = await synthesizeSpeech(replyText);
      audioBase64 = audioBuf.toString('base64');
    } catch (err) {
      // Voice is the point of a call, but if TTS fails the turn still
      // happened — return the text so the client can show it instead of
      // eating the whole exchange.
      console.error('call-turn TTS failed, returning text only:', err.message);
    }

    res.json({ userText, replyText, audioBase64 });

    compressIfNeeded(sessionId)
      .then(() => consolidateMemoriesIfNeeded(sessionId))
      .catch((err) => console.error('background memory maintenance error (call):', err));
  } catch (err) {
    console.error('POST /api/call-turn error:', err);
    res.status(500).json({ error: err.message || '通话这一轮失败了' });
  }
});

app.post('/api/clone-voice', upload.single('audio'), async (req, res) => {
  if (!MINIMAX_CLONE_READY) {
    res.status(501).json({ error: 'MiniMax 未配置(缺 MINIMAX_API_KEY / MINIMAX_GROUP_ID)' });
    return;
  }
  if (CLONE_PASSCODE && req.body.passcode !== CLONE_PASSCODE) {
    res.status(403).json({ error: '口令不对' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: '没收到音频文件' });
    return;
  }
  const voiceId = (req.body.voiceId || '').trim();
  if (!voiceId) {
    res.status(400).json({ error: 'voiceId is required' });
    return;
  }

  try {
    const uploadForm = new FormData();
    uploadForm.append('purpose', 'voice_clone');
    uploadForm.append('file', new Blob([req.file.buffer]), req.file.originalname || 'voice.mp3');

    const uploadRes = await fetch(`${MINIMAX_API_HOST}/v1/files/upload?GroupId=${MINIMAX_GROUP_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MINIMAX_API_KEY}` },
      body: uploadForm,
    });
    const uploadJson = await uploadRes.json();
    const fileId = uploadJson.file && uploadJson.file.file_id;
    if (!fileId) {
      res.status(502).json({ error: '上传失败: ' + JSON.stringify(uploadJson) });
      return;
    }

    const cloneRes = await fetch(`${MINIMAX_API_HOST}/v1/voice_clone?GroupId=${MINIMAX_GROUP_ID}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: fileId, voice_id: voiceId }),
    });
    const cloneJson = await cloneRes.json();

    if (cloneJson.base_resp && cloneJson.base_resp.status_code === 0) {
      res.json({ ok: true, voiceId, raw: cloneJson });
    } else {
      res.status(502).json({ error: '克隆失败: ' + JSON.stringify(cloneJson) });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multer (and anything else) throwing before a route body runs otherwise
// leaks a raw Express HTML stack trace to the client instead of JSON the
// frontend can parse and show — e.g. selecting more images/files than a
// route's configured limit. The UI already caps selection at the current
// limits, so this is a safety net rather than an expected path.
app.use((err, req, res, next) => {
  if (res.headersSent) { next(err); return; }
  console.error('unhandled request error:', err);
  const message = err instanceof multer.MulterError ? ('文件太多或太大: ' + err.message) : (err.message || '服务器出错了');
  res.status(400).json({ error: message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`voice-chat listening on http://localhost:${PORT}`));
