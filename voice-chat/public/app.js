const statusText = document.getElementById('statusText');
const transcriptEl = document.getElementById('transcript');
const setupNotice = document.getElementById('setupNotice');
const sessionTitle = document.getElementById('sessionTitle');

// iOS Safari: `dvh` accounts for the URL bar hiding/showing, but NOT for
// the on-screen keyboard. Without this, the keyboard covers the composer
// (or the whole page jumps) instead of the layout shrinking to fit above
// it. window.visualViewport reflects the actual visible area, keyboard
// included, so drive the app shell's height from that directly.
function syncAppHeightToViewport() {
  const appEl = document.querySelector('.app');
  if (!appEl || !window.visualViewport) return;
  appEl.style.height = window.visualViewport.height + 'px';
  // iOS sometimes scrolls the document to bring the focused input into
  // view even though nothing here is meant to scroll; snap it back.
  window.scrollTo(0, 0);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncAppHeightToViewport);
  window.visualViewport.addEventListener('scroll', syncAppHeightToViewport);
  syncAppHeightToViewport();
}

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
const imageBtn = document.getElementById('imageBtn');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const imagePreviewImg = document.getElementById('imagePreviewImg');
const imagePreviewRemove = document.getElementById('imagePreviewRemove');

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

let selectedVoice = null;
let ttsProvider = 'browser';
let supabaseReady = false;
let recognizing = false;
let selectedImageFile = null;
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
      const bubble = appendBubble(m.role, m.content, m.image_url, m.id);
      if (m.role === 'assistant') attachAudioLazy(bubble, m.content);
    });
    statusText.textContent = '';
  } catch (err) {
    statusText.textContent = '加载记录失败: ' + err.message;
  }
}

// ---- Chat bubbles ----

function appendBubble(role, text, imageUrl, id) {
  const div = document.createElement('div');
  div.className = 'bubble ' + role;

  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'bubble-img';
    img.src = imageUrl;
    img.alt = '图片';
    div.appendChild(img);
  }

  const row = document.createElement('div');
  row.className = 'bubble-row';
  div.appendChild(row);

  const textEl = document.createElement('span');
  textEl.className = 'bubble-text';
  textEl.textContent = text;
  row.appendChild(textEl);

  let playBtn = null;
  if (role === 'assistant') {
    playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'play-btn';
    playBtn.textContent = '▶';
    row.appendChild(playBtn);
  }

  let editBtn = null;
  const bubble = { el: div, textEl, playBtn, id };
  if (role === 'user') {
    editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'edit-btn';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => startEditBubble(bubble));
    row.appendChild(editBtn);
  }
  bubble.editBtn = editBtn;

  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return bubble;
}

function startEditBubble(bubble) {
  if (!bubble.id) {
    statusText.textContent = '这条消息还没保存好,等一下再改';
    return;
  }
  const original = bubble.textEl.textContent;

  const textarea = document.createElement('textarea');
  textarea.className = 'edit-textarea';
  textarea.value = original;
  bubble.textEl.replaceWith(textarea);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const actions = document.createElement('div');
  actions.className = 'edit-actions';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'mini-btn';
  saveBtn.textContent = '保存';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'mini-icon-btn';
  cancelBtn.textContent = '取消';
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  textarea.after(actions);

  if (bubble.editBtn) bubble.editBtn.classList.add('hidden');

  function exitEdit(finalText) {
    bubble.textEl.textContent = finalText;
    textarea.replaceWith(bubble.textEl);
    actions.remove();
    if (bubble.editBtn) bubble.editBtn.classList.remove('hidden');
  }

  cancelBtn.addEventListener('click', () => exitEdit(original));

  saveBtn.addEventListener('click', async () => {
    const next = textarea.value.trim();
    if (!next || next === original) { exitEdit(original); return; }
    saveBtn.disabled = true;
    try {
      const res = await fetch(`/api/messages/${bubble.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '保存失败');
      }
      exitEdit(next);
    } catch (err) {
      statusText.textContent = '编辑失败: ' + err.message;
      saveBtn.disabled = false;
    }
  });
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
// Strip parenthesized stage directions (动作/表情/环境描写) so TTS only
// reads the actual spoken line, e.g. "(抱住你)在的在的。" -> "在的在的。"
function stripStageDirections(text) {
  return text.replace(/[（(][^）)]*[）)]/g, '').replace(/[ \t]+/g, ' ').trim();
}

function attachAudioLazy(bubble, text) {
  const spoken = stripStageDirections(text);
  bubble.playBtn.classList.add('ready');
  bubble.playBtn.onclick = async () => {
    if (!spoken) { statusText.textContent = '这条只有动作描写,没有可朗读的台词'; return; }
    if (ttsProvider !== 'minimax') { speakBrowser(spoken); return; }
    bubble.playBtn.disabled = true;
    try {
      const url = await fetchMinimaxAudioUrl(spoken);
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
  const imageFile = selectedImageFile;
  if ((!text && !imageFile) || !currentSessionId) return;

  const localImageUrl = imageFile ? URL.createObjectURL(imageFile) : undefined;
  const userBubble = appendBubble('user', text, localImageUrl);
  textInput.value = '';
  clearImageSelection();
  setBusy(true);
  statusText.textContent = '思考中...';

  const assistantBubble = appendBubble('assistant', '');
  let fullText = '';

  try {
    const form = new FormData();
    form.append('sessionId', currentSessionId);
    form.append('message', text);
    if (imageFile) form.append('image', imageFile);

    const res = await fetch('/api/chat', { method: 'POST', body: form });

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
        if (payload.userMessageId) {
          userBubble.id = payload.userMessageId;
        }
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
    // The user message (and possibly the reply) may already be saved
    // server-side even if this connection dropped — offer to reload the
    // real state from the database instead of silently losing it or
    // risking a duplicate send on retry.
    assistantBubble.textEl.textContent = `(出错了: ${err.message} —— 点这条消息重新加载,看看是不是其实发出去了)`;
    assistantBubble.el.style.cursor = 'pointer';
    assistantBubble.el.addEventListener('click', () => selectSession(currentSessionId), { once: true });
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

function clearImageSelection() {
  selectedImageFile = null;
  imageInput.value = '';
  imagePreview.classList.add('hidden');
  imagePreviewImg.src = '';
}

imageBtn.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', () => {
  const file = imageInput.files && imageInput.files[0];
  if (!file) return;
  selectedImageFile = file;
  imagePreviewImg.src = URL.createObjectURL(file);
  imagePreview.classList.remove('hidden');
});

imagePreviewRemove.addEventListener('click', clearImageSelection);
