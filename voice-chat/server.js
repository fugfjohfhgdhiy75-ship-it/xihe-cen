require('dotenv').config();
const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

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
const MINIMAX_READY = Boolean(MINIMAX_API_KEY && MINIMAX_GROUP_ID && MINIMAX_VOICE_ID);
const MINIMAX_CLONE_READY = Boolean(MINIMAX_API_KEY && MINIMAX_GROUP_ID);
const CLONE_PASSCODE = process.env.CLONE_PASSCODE;

app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

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
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: system || undefined,
      messages,
    });

    let receivedChars = 0;
    stream.on('text', (text) => {
      receivedChars += text.length;
      send({ text });
    });
    stream.on('end', async () => {
      if (ended) return;
      if (receivedChars === 0) {
        try {
          const final = await stream.finalMessage();
          console.error('/api/chat: empty stream, finalMessage =', JSON.stringify(final));
          send({ error: `模型没返回任何文字(stop_reason=${final.stop_reason}),把这条截图发给开发者` });
        } catch (e) {
          console.error('/api/chat: empty stream, finalMessage() also failed:', e);
          send({ error: '模型没返回任何文字,而且拿不到详细原因,把 Render Logs 截图发给开发者' });
        }
      } else {
        send({ done: true });
      }
      finish();
    });
    stream.on('error', (err) => {
      console.error('/api/chat stream error:', err);
      send({ error: (err && err.message) || String(err) });
      finish();
    });

    req.on('close', () => {
      if (!ended) stream.abort();
      finish();
    });
  } catch (err) {
    console.error('/api/chat handler error:', err);
    send({ error: err.message });
    finish();
  }
});

app.get('/api/config', (req, res) => {
  res.json({ ttsProvider: MINIMAX_READY ? 'minimax' : 'browser' });
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
