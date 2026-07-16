const statusText = document.getElementById('statusText');
const transcriptEl = document.getElementById('transcript');
const setupNotice = document.getElementById('setupNotice');
const sessionTitle = document.getElementById('sessionTitle');

const sessionsBtn = document.getElementById('sessionsBtn');
const sessionsPanel = document.getElementById('sessionsPanel');
const sessionsList = document.getElementById('sessionsList');
const newSessionBtn = document.getElementById('newSessionBtn');

const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const saveSettingsBtn = document.getElementById('saveSettings');
const systemPromptEl = document.getElementById('systemPrompt');
const sttLangEl = document.getElementById('sttLang');
const voiceSelectEl = document.getElementById('voiceSelect');
const docUpload = document.getElementById('docUpload');
const docUploadStatus = document.getElementById('docUploadStatus');

const micBtn = document.getElementById('micBtn');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

let selectedVoice = null;
let ttsProvider = 'browser';
let supabaseReady = false;
let recognizing = false;
let activeRecognition = null;
let sessions = [];
let currentSessionId = null;

const ttsPlayer = document.getElementById('ttsPlayer');
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

function unlockAudioPlayback() {
  ttsPlayer.src = SILENT_WAV;
  ttsPlayer.play().catch(() => {});
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  micBtn.disabled = busy;
}

function disableComposer() {
  sendBtn.disabled = true;
  micBtn.disabled = true;
  textInput.disabled = true;
}

async function init() {
  const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  ttsProvider = cfg.ttsProvider || 'browser';
  supabaseReady = Boolean(cfg.supabaseReady);

  if (!supabaseReady) {
    setupNotice.classList.remove('hidden');
    disableComposer();
    return;
  }

  await loadSettings();
  await loadSessions();
}
init();

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

settingsBtn.addEventListener('click', () => {
  sessionsPanel.classList.add('hidden');
  settingsPanel.classList.toggle('hidden');
});
closeSettings.addEventListener('click', () => settingsPanel.classList.add('hidden'));

sessionsBtn.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  sessionsPanel.classList.toggle('hidden');
});

// ---- Settings (server-persisted) ----

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    systemPromptEl.value = data.system_prompt || '';
  } catch (err) {
    statusText.textContent = '加载设置失败: ' + err.message;
  }
}

async function saveSettings() {
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: systemPromptEl.value }),
    });
    docUploadStatus.textContent = '已保存';
  } catch (err) {
    docUploadStatus.textContent = '保存失败: ' + err.message;
  }
}
saveSettingsBtn.addEventListener('click', saveSettings);

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
      await saveSettings();
      docUploadStatus.textContent = `已导入 ${file.name}(${body.text.length} 字)`;
    } catch (err) {
      docUploadStatus.textContent = `${file.name} 导入失败: ${err.message}`;
    }
  }
  docUpload.value = '';
});

// ---- Sessions ----

async function loadSessions() {
  const res = await fetch('/api/sessions');
  sessions = await res.json();

  if (!sessions.length) {
    const created = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新对话' }),
    }).then((r) => r.json());
    sessions = [created];
  }

  renderSessionsList();

  if (!currentSessionId || !sessions.find((s) => s.id === currentSessionId)) {
    await selectSession(sessions[0].id);
  }
}

function renderSessionsList() {
  sessionsList.innerHTML = '';
  sessions.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'session-row' + (s.id === currentSessionId ? ' active' : '');

    const name = document.createElement('span');
    name.className = 'session-name';
    name.textContent = s.name;
    name.addEventListener('click', () => selectSession(s.id));
    row.appendChild(name);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'mini-icon-btn';
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); renameSession(s.id, s.name); });
    row.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'mini-icon-btn';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(s.id); });
    row.appendChild(delBtn);

    sessionsList.appendChild(row);
  });
}

newSessionBtn.addEventListener('click', async () => {
  const created = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '新对话' }),
  }).then((r) => r.json());
  sessions.unshift(created);
  await selectSession(created.id);
  renderSessionsList();
});

async function renameSession(id, currentName) {
  const name = prompt('改个名字', currentName);
  if (!name || !name.trim()) return;
  await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  const s = sessions.find((x) => x.id === id);
  if (s) s.name = name.trim();
  renderSessionsList();
  if (id === currentSessionId) sessionTitle.textContent = name.trim();
}

async function deleteSession(id) {
  if (!confirm('删掉这个对话?聊天记录会一起没了。')) return;
  await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  sessions = sessions.filter((s) => s.id !== id);
  if (id === currentSessionId) {
    currentSessionId = null;
    if (sessions.length) {
      await selectSession(sessions[0].id);
    } else {
      await loadSessions();
    }
  }
  renderSessionsList();
}

async function selectSession(id) {
  currentSessionId = id;
  const s = sessions.find((x) => x.id === id);
  sessionTitle.textContent = (s && s.name) || '苏晏';
  sessionsPanel.classList.add('hidden');
  renderSessionsList();

  transcriptEl.innerHTML = '';
  statusText.textContent = '加载记录中...';
  try {
    const res = await fetch(`/api/sessions/${id}/messages`);
    const msgs = await res.json();
    msgs.forEach((m) => {
      const bubble = appendBubble(m.role, m.content);
      if (m.role === 'assistant') attachAudioLazy(bubble, m.content);
    });
    statusText.textContent = '';
  } catch (err) {
    statusText.textContent = '加载记录失败: ' + err.message;
  }
}

// ---- Chat bubbles ----

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

// Lazy: text always shows immediately; audio is only fetched/synthesized
// when the user taps ▶ — no auto-play, for fresh replies or history alike.
function attachAudioLazy(bubble, text) {
  bubble.playBtn.classList.add('ready');
  bubble.playBtn.onclick = async () => {
    if (ttsProvider !== 'minimax') { speakBrowser(text); return; }
    bubble.playBtn.disabled = true;
    try {
      const url = await fetchMinimaxAudioUrl(text);
      bubble.playBtn.onclick = () => playUrl(url);
      playUrl(url);
    } catch (err) {
      statusText.textContent = 'TTS 出错: ' + err.message;
    } finally {
      bubble.playBtn.disabled = false;
    }
  };
}

async function sendMessage(rawText) {
  const text = (rawText || '').trim();
  if (!text || !currentSessionId) return;

  appendBubble('user', text);
  textInput.value = '';
  setBusy(true);
  statusText.textContent = '思考中...';

  const assistantBubble = appendBubble('assistant', '');
  let fullText = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, message: text }),
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
      attachAudioLazy(assistantBubble, fullText);
      statusText.textContent = '';
      const s = sessions.find((x) => x.id === currentSessionId);
      if (s) {
        s.updated_at = new Date().toISOString();
        sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        renderSessionsList();
      }
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
