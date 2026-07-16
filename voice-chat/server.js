require('dotenv').config();
const express = require('express');
const multer = require('multer');
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
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
});
const MODEL = process.env.MODEL || 'claude-sonnet-5';

const MINIMAX_API_HOST = process.env.MINIMAX_API_HOST || 'https://api.minimax.io';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID;
const MINIMAX_VOICE_ID = process.env.MINIMAX_VOICE_ID;
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'speech-02-turbo';
const MINIMAX_EMOTION = process.env.MINIMAX_EMOTION || 'happy';
const MINIMAX_READY = Boolean(MINIMAX_API_KEY && MINIMAX_GROUP_ID && MINIMAX_VOICE_ID);
const MINIMAX_CLONE_READY = Boolean(MINIMAX_API_KEY && MINIMAX_GROUP_ID);
const CLONE_PASSCODE = process.env.CLONE_PASSCODE;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_READY = Boolean(SUPABASE_URL && SUPABASE_KEY);
const supabase = SUPABASE_READY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const COMPRESS_CHAR_THRESHOLD = Number(process.env.COMPRESS_CHAR_THRESHOLD || 6000);
const COMPRESS_KEEP_MESSAGES = Number(process.env.COMPRESS_KEEP_MESSAGES || 10);

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

  try {
    const summary = await summarizeText(transcript);
    if (!summary) return;

    await supabase.from('memories').insert({ session_id: sessionId, summary });
    await supabase.from('messages').update({ visible: false }).in('id', toCompress.map((m) => m.id));
  } catch (err) {
    console.error('compressIfNeeded error:', err);
  }
}

async function summarizeText(transcript) {
  const prompt = `把下面这段对话压缩成一段简短的中文摘要,保留关键事实、情绪和上下文,不超过 200 字,不要加任何前缀说明:\n\n${transcript}`;

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
        max_tokens: 400,
      }),
    });
    const json = await res.json();
    return json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });
  return (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
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
    .select('id, role, content, created_at')
    .eq('session_id', req.params.id)
    .eq('visible', true)
    .order('created_at', { ascending: true });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.get('/api/settings', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data || { system_prompt: '' });
});

app.put('/api/settings', async (req, res) => {
  if (!requireSupabase(res)) return;
  const systemPrompt = req.body.system_prompt || '';
  const { data, error } = await supabase
    .from('settings')
    .upsert({ id: 1, system_prompt: systemPrompt, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

app.post('/api/chat', async (req, res) => {
  const { sessionId, message, system: systemOverride } = req.body;

  if (!sessionId || !message || !message.trim()) {
    res.status(400).json({ error: 'sessionId and message are required' });
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
  const finish = () => {
    if (ended || res.writableEnded) return;
    ended = true;
    res.end();
  };

  try {
    await supabase.from('messages').insert({ session_id: sessionId, role: 'user', content: message });
    await supabase.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId);

    const [{ data: history }, { data: memoryRows }, systemPrompt] = await Promise.all([
      supabase.from('messages').select('role, content').eq('session_id', sessionId).eq('visible', true).order('created_at', { ascending: true }),
      supabase.from('memories').select('summary').eq('session_id', sessionId).order('created_at', { ascending: true }),
      getSystemPrompt(),
    ]);

    const memoryBlock = (memoryRows || []).map((m) => m.summary).join('\n');
    const systemParts = [systemOverride || systemPrompt];
    if (memoryBlock) systemParts.push(`以下是这段关系/对话更早之前的记忆摘要,供参考:\n${memoryBlock}`);
    const system = systemParts.filter(Boolean).join('\n\n') || undefined;

    const messages = (history || []).map((m) => ({ role: m.role, content: m.content }));

    const claudeMessage = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
    });

    const text = (claudeMessage.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!text) {
      console.error('/api/chat: empty completion, message =', JSON.stringify(claudeMessage));
      send({ error: `模型没返回任何文字(stop_reason=${claudeMessage.stop_reason}),把这条截图发给开发者` });
    } else {
      await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: text });
      send({ text });
      send({ done: true });
      compressIfNeeded(sessionId).catch((err) => console.error('compressIfNeeded background error:', err));
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
      model: MODEL,
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
    });
    res.json({
      ok: true,
      ms: Date.now() - started,
      model: MODEL,
      baseURL: process.env.ANTHROPIC_BASE_URL || '(official)',
      stop_reason: message.stop_reason,
      content: message.content,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      ms: Date.now() - started,
      model: MODEL,
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
  res.json({ ttsProvider: MINIMAX_READY ? 'minimax' : 'browser', supabaseReady: SUPABASE_READY });
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

app.post('/api/tts', async (req, res) => {
  if (!MINIMAX_READY) {
    res.status(501).json({ error: 'MiniMax 未配置(缺 MINIMAX_API_KEY / MINIMAX_GROUP_ID / MINIMAX_VOICE_ID)' });
    return;
  }

  const { text } = req.body;
  if (!text || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  try {
    const mmRes = await fetch(`${MINIMAX_API_HOST}/v1/t2a_v2?GroupId=${MINIMAX_GROUP_ID}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        text,
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
      res.status(502).json({ error: 'MiniMax 返回异常: ' + JSON.stringify(json.base_resp || json) });
      return;
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(json.data.audio, 'hex'));
  } catch (err) {
    res.status(500).json({ error: err.message });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`voice-chat listening on http://localhost:${PORT}`));
