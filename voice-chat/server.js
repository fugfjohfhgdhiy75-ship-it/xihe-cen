require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || 'claude-sonnet-5';

const MINIMAX_API_HOST = process.env.MINIMAX_API_HOST || 'https://api.minimax.io';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID;
const MINIMAX_VOICE_ID = process.env.MINIMAX_VOICE_ID;
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'speech-02-turbo';
const MINIMAX_READY = Boolean(MINIMAX_API_KEY && MINIMAX_GROUP_ID && MINIMAX_VOICE_ID);

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

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: system || undefined,
      messages,
    });

    stream.on('text', (text) => send({ text }));
    stream.on('end', () => {
      send({ done: true });
      res.end();
    });
    stream.on('error', (err) => {
      send({ error: err.message });
      res.end();
    });

    req.on('close', () => stream.abort());
  } catch (err) {
    send({ error: err.message });
    res.end();
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`voice-chat listening on http://localhost:${PORT}`));
