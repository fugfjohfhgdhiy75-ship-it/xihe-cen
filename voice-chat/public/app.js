const statusText = document.getElementById('statusText');
const transcriptEl = document.getElementById('transcript');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const systemPromptEl = document.getElementById('systemPrompt');
const sttLangEl = document.getElementById('sttLang');
const voiceSelectEl = document.getElementById('voiceSelect');
const micBtn = document.getElementById('micBtn');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const docUpload = document.getElementById('docUpload');
const docUploadStatus = document.getElementById('docUploadStatus');

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

let messages = [];
let selectedVoice = null;
let ttsProvider = 'browser';
let recognizing = false;
let activeRecognition = null;

const ttsPlayer = document.getElementById('ttsPlayer');
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

function unlockAudioPlayback() {
  ttsPlayer.src = SILENT_WAV;
  ttsPlayer.play().catch(() => {});
}

const configPromise = fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => { ttsProvider = cfg.ttsProvider || 'browser'; })
  .catch(() => { ttsProvider = 'browser'; });

function loadVoices() {
  const voices = speechSynthesis.getVoices();
  voiceSelectEl.innerHTML = '';
  voices.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelectEl.appendChild(opt);
  });
  const zhIndex = voices.findIndex(v => v.lang.startsWith('zh'));
  if (zhIndex >= 0) voiceSelectEl.value = zhIndex;
  selectedVoice = voices[voiceSelectEl.value] || voices[0] || null;
}
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

voiceSelectEl.addEventListener('change', () => {
  const voices = speechSynthesis.getVoices();
  selectedVoice = voices[voiceSelectEl.value] || null;
});

settingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));
closeSettings.addEventListener('click', () => settingsPanel.classList.add('hidden'));

const SYSTEM_PROMPT_KEY = 'suyan_system_prompt';
const savedPrompt = localStorage.getItem(SYSTEM_PROMPT_KEY);
if (savedPrompt) systemPromptEl.value = savedPrompt;
systemPromptEl.addEventListener('input', () => {
  localStorage.setItem(SYSTEM_PROMPT_KEY, systemPromptEl.value);
});

docUpload.addEventListener('change', async () => {
  const files = Array.from(docUpload.files || []);
  if (!files.length) return;

  for (const file of files) {
    docUploadStatus.textContent = `正在导入 ${file.name}...`;
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/extract-text', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || '导入失败');

      const sep = systemPromptEl.value.trim() ? '\n\n' : '';
      systemPromptEl.value += `${sep}--- ${body.filename} ---\n${body.text}`;
      localStorage.setItem(SYSTEM_PROMPT_KEY, systemPromptEl.value);
      docUploadStatus.textContent = `已导入 ${file.name}(${body.text.length} 字)`;
    } catch (err) {
      docUploadStatus.textContent = `${file.name} 导入失败: ${err.message}`;
    }
  }
  docUpload.value = '';
});

function appendBubble(role, text) {
  const div = document.createElement('div');
  div.className = 'bubble ' + role;

  const textEl = document.createElement('span');
  textEl.className = 'bubble-text';
  textEl.textContent = text;
  div.appendChild(textEl);

  let playBtn = null;
  if (role === 'assistant') {
    playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'play-btn';
    playBtn.textContent = '▶';
    div.appendChild(playBtn);
  }

  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return { el: div, textEl, playBtn };
}

function speakBrowser(text) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = sttLangEl.value;
  if (selectedVoice) utter.voice = selectedVoice;
  speechSynthesis.speak(utter);
}

function playUrl(url) {
  ttsPlayer.pause();
  ttsPlayer.src = url;
  ttsPlayer.play().catch(() => {
    statusText.textContent = '自动播放被拦截,点一下气泡上的 ▶ 按钮';
  });
}

async function fetchMinimaxAudioUrl(text) {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'TTS 请求失败');
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function attachAudio(bubble, text) {
  if (ttsProvider === 'minimax') {
    fetchMinimaxAudioUrl(text)
      .then((url) => {
        bubble.playBtn.classList.add('ready');
        bubble.playBtn.onclick = () => playUrl(url);
        playUrl(url);
      })
      .catch((err) => {
        statusText.textContent = 'TTS 出错: ' + err.message;
      });
  } else {
    bubble.playBtn.classList.add('ready');
    bubble.playBtn.onclick = () => speakBrowser(text);
    speakBrowser(text);
  }
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  micBtn.disabled = busy;
}

async function sendMessage(rawText) {
  const text = (rawText || '').trim();
  if (!text) return;

  await configPromise;
  appendBubble('user', text);
  messages.push({ role: 'user', content: text });
  textInput.value = '';
  setBusy(true);
  statusText.textContent = '思考中...';

  const assistantBubble = appendBubble('assistant', '');
  let fullText = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system: systemPromptEl.value || undefined }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.error) throw new Error(payload.error);
        if (payload.text) {
          fullText += payload.text;
          assistantBubble.textEl.textContent = fullText;
          transcriptEl.scrollTop = transcriptEl.scrollHeight;
        }
      }
    }

    if (fullText) {
      messages.push({ role: 'assistant', content: fullText });
      attachAudio(assistantBubble, fullText);
      statusText.textContent = '';
    } else {
      assistantBubble.textEl.textContent = '(没有收到回复)';
      statusText.textContent = '';
    }
  } catch (err) {
    assistantBubble.textEl.textContent = '(出错了: ' + err.message + ')';
    statusText.textContent = '';
  } finally {
    setBusy(false);
  }
}

function startVoiceInput() {
  const rec = new SpeechRecognitionImpl();
  rec.lang = sttLangEl.value;
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  let transcript = '';

  rec.onresult = (e) => {
    const result = e.results[e.results.length - 1];
    if (result.isFinal) transcript = result[0].transcript.trim();
  };

  rec.onerror = (e) => {
    if (e.error !== 'aborted' && e.error !== 'no-speech') {
      statusText.textContent = '识别出错: ' + e.error;
    }
  };

  rec.onend = () => {
    recognizing = false;
    activeRecognition = null;
    micBtn.classList.remove('recording');
    if (transcript) {
      sendMessage(transcript);
    } else if (!statusText.textContent.startsWith('识别出错')) {
      statusText.textContent = '';
    }
  };

  activeRecognition = rec;
  recognizing = true;
  micBtn.classList.add('recording');
  statusText.textContent = '在听...';
  try {
    rec.start();
  } catch (err) {
    recognizing = false;
    activeRecognition = null;
    micBtn.classList.remove('recording');
  }
}

micBtn.addEventListener('click', () => {
  if (!SpeechRecognitionImpl) {
    alert('这个浏览器不支持语音识别,换 Chrome 或 Edge 试试。');
    return;
  }
  unlockAudioPlayback();
  if (recognizing) {
    if (activeRecognition) activeRecognition.stop();
    return;
  }
  startVoiceInput();
});

sendBtn.addEventListener('click', () => {
  unlockAudioPlayback();
  sendMessage(textInput.value);
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    unlockAudioPlayback();
    sendMessage(textInput.value);
  }
});
