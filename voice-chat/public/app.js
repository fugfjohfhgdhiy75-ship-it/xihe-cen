const statusText = document.getElementById('statusText');
const transcriptEl = document.getElementById('transcript');
const setupNotice = document.getElementById('setupNotice');

// iOS Safari never shrinks the layout viewport for the on-screen keyboard —
// it just overlays it. The previous approach kept the composer at
// `position: fixed` and tried to compute how far to translateY it up by
// diffing visualViewport against a guessed "no keyboard" baseline — that
// math had edge cases (still visible as a gap between the composer and the
// keyboard in testing) and was fighting the browser instead of just
// reading its actual state.
//
// Simpler and more direct: the composer lives back in the normal flex
// column (.app > .transcript, .composer-dock), and JS just sets `.app`'s
// height to exactly window.visualViewport.height on every change — that
// number already IS "however tall the visible area currently is," keyboard
// or address bar or both, no guessing which caused it. The composer, as
// the last flex child, naturally ends up sitting right at the bottom edge
// of whatever's actually visible.
const appEl = document.querySelector('.app');
const composerDock = document.getElementById('composerDock');
function syncAppHeight() {
  if (!appEl || !window.visualViewport) return;
  appEl.style.height = window.visualViewport.height + 'px';
  // iOS sometimes scrolls the (non-scrolling) page to bring the focused
  // input into view on its own; snap it back so our own layout is the only
  // thing driving position.
  window.scrollTo(0, 0);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncAppHeight);
  window.visualViewport.addEventListener('scroll', syncAppHeight);
}
window.addEventListener('load', syncAppHeight);
syncAppHeight();

// env(safe-area-inset-bottom) reserves room for the home-indicator bar and
// stays constant even when the keyboard is up — but the keyboard already
// occupies that strip, so keeping the padding left a blank gap between the
// composer and the keyboard. "Is a text field focused" is a direct, always-
// correct signal for "is the keyboard open" (far more reliable than
// inferring it from a viewport-height diff, which can be thrown off by
// exactly how much of the shrink is keyboard vs. Safari's own accessory
// toolbar above it) — use that to toggle the padding off.
//
// Also doubles as the belt-and-suspenders fix for visualViewport's resize
// event lagging the keyboard's open/close animation on some iOS versions:
// re-run the height sync a few times right after focus changes so the
// layout catches up even if that event was late or skipped.
document.addEventListener('focusin', (e) => {
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
  if (composerDock) composerDock.classList.add('kb-open');
  [0, 50, 150, 300, 500].forEach((ms) => setTimeout(syncAppHeight, ms));
});
document.addEventListener('focusout', (e) => {
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
  if (composerDock) composerDock.classList.remove('kb-open');
  [0, 50, 150, 300, 500].forEach((ms) => setTimeout(syncAppHeight, ms));
});

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

const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const imageBtn = document.getElementById('imageBtn');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');

const MAX_IMAGES = 6;

let selectedVoice = null;
let ttsProvider = 'browser';
let supabaseReady = false;
let selectedImageFiles = [];
let sessions = [];
let currentSessionId = null;

const ttsPlayer = document.getElementById('ttsPlayer');
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

function unlockAudioPlayback() {
  ttsPlayer.src = SILENT_WAV;
  ttsPlayer.play().catch(() => {});
}

function setBusy(busy) {
  sendBtn.disabled = busy;
}

function disableComposer() {
  sendBtn.disabled = true;
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
  sessionsPanel.classList.add('hidden');
  renderSessionsList();

  transcriptEl.innerHTML = '';
  statusText.textContent = '加载记录中...';
  try {
    const res = await fetch(`/api/sessions/${id}/messages`);
    const msgs = await res.json();
    if (!res.ok) throw new Error(msgs.error || `HTTP ${res.status}`);
    msgs.forEach((m) => {
      const imageUrls = m.image_urls || (m.image_url ? [m.image_url] : []);
      const bubble = appendBubble(m.role, m.content, imageUrls, m.id);
      if (m.role === 'assistant') attachAudioLazy(bubble, m.content);
    });
    statusText.textContent = '';
  } catch (err) {
    statusText.textContent = '加载记录失败: ' + err.message;
  }
}

// ---- Chat bubbles ----

// The model writes in a screenplay-ish style — every action beat and line
// of dialogue gets its own paragraph, separated by a blank line — and
// `white-space: pre-wrap` renders each one as a forced line break. Even
// after collapsing blank gaps, that still means most "lines" are really
// short sentence fragments that end long before the bubble's right edge,
// instead of flowing prose that wraps by width like a normal chat bubble.
// Flatten everything to one continuous block and let the browser wrap it
// naturally (display only — doesn't touch what's stored/edited/sent to TTS).
function formatForDisplay(text) {
  return text.replace(/\s*\n+\s*/g, ' ').trim();
}

// The model sometimes writes markdown-style **bold** for emphasis, but the
// bubble just shows raw text — so it was literally showing the asterisks
// instead of emphasis. Parse that into a real <strong> instead.
function renderBubbleText(el, text) {
  el.innerHTML = '';
  text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      el.appendChild(strong);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  });
}

function appendBubble(role, text, imageUrls, id) {
  const div = document.createElement('div');
  div.className = 'bubble ' + role;

  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  if (urls.length) {
    const grid = document.createElement('div');
    grid.className = 'bubble-img-grid';
    urls.forEach((url) => {
      const img = document.createElement('img');
      img.className = 'bubble-img';
      img.src = url;
      img.alt = '图片';
      grid.appendChild(img);
    });
    div.appendChild(grid);
  }

  const row = document.createElement('div');
  row.className = 'bubble-row';
  div.appendChild(row);

  const textEl = document.createElement('span');
  textEl.className = 'bubble-text';
  renderBubbleText(textEl, formatForDisplay(text));
  row.appendChild(textEl);

  let playBtn = null;
  let speedBtn = null;
  if (role === 'assistant') {
    const audioControls = document.createElement('div');
    audioControls.className = 'audio-controls';

    playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'play-btn';
    playBtn.innerHTML = ICON_PLAY;
    audioControls.appendChild(playBtn);

    speedBtn = document.createElement('button');
    speedBtn.type = 'button';
    speedBtn.className = 'speed-btn';
    speedBtn.textContent = formatRate(playbackRate);
    audioControls.appendChild(speedBtn);

    row.appendChild(audioControls);
  }

  let editBtn = null;
  const bubble = { el: div, textEl, playBtn, speedBtn, id };
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

async function fetchServerAudioUrl(text) {
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
//
// Stage directions like "(笑着)" get turned into ElevenLabs performance tags
// like [laughs] server-side (see server.js) — that decision has to live on
// the server, not here, because the server is the one that knows whether
// this request actually ends up on ElevenLabs or falls back to MiniMax
// (e.g. on quota errors). Doing it client-side caused MiniMax to receive
// literal English tags it doesn't understand whenever ElevenLabs failed
// mid-session, producing broken/undecodable audio. So the browser only
// does a plain strip — for the "is there anything to speak at all" check,
// and for the browser-speechSynthesis fallback, which never gets tags
// either way — and sends the *original* text to the server for everything
// else, letting it decide per actual provider used.
function stripStageDirections(text) {
  return text.replace(/[（(][^）)]*[）)]/g, '').replace(/[ \t]+/g, ' ').trim();
}

// The whole app shares one <audio> element (needed for the iOS autoplay
// unlock trick), so only one bubble can be "active" at a time. Pausing and
// resuming just calls the native audio.pause()/play() — currentTime is left
// untouched by those, so resume picks up exactly where it left off.
let currentPlayingBubble = null;
let playbackRate = Number(localStorage.getItem('ttsRate')) || 1;
const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2];
function formatRate(r) { return (r === 1 ? '1' : String(r)) + 'x'; }

ttsPlayer.addEventListener('ended', () => {
  if (currentPlayingBubble) currentPlayingBubble.playBtn.innerHTML = ICON_PLAY;
  currentPlayingBubble = null;
});

// If the fetched audio is empty/corrupt/unplayable, the browser fires
// 'error' on the element (often instantly, before or instead of ever
// actually sounding) rather than rejecting the play() promise — without
// this listener that fails completely silently: the icon just quietly
// resets to ▶ with no indication anything went wrong.
// MediaError.code: 1=ABORTED(载入被打断,通常无害) 2=NETWORK 3=DECODE(数据本身
// 解不出来) 4=SRC_NOT_SUPPORTED(格式不对/根本不是音频)。把这个数字直接亮出来,
// 不用再去翻服务器日志才能定位是哪一类问题。
ttsPlayer.addEventListener('error', () => {
  const code = ttsPlayer.error ? ttsPlayer.error.code : '?';
  if (code === 1) return; // aborted by us swapping .src on purpose, not a real failure
  statusText.textContent = `播放失败(MediaError code ${code}),可能是返回的音频有问题`;
  if (currentPlayingBubble) currentPlayingBubble.playBtn.innerHTML = ICON_PLAY;
  currentPlayingBubble = null;
});

function attachAudioLazy(bubble, text) {
  const spoken = stripStageDirections(text);
  bubble.playBtn.classList.add('ready');
  bubble.speedBtn.classList.add('ready');
  let audioUrl = null;

  bubble.speedBtn.addEventListener('click', () => {
    const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(playbackRate) + 1) % PLAYBACK_RATES.length];
    playbackRate = next;
    localStorage.setItem('ttsRate', String(next));
    document.querySelectorAll('.speed-btn').forEach((btn) => { btn.textContent = formatRate(next); });
    if (currentPlayingBubble) ttsPlayer.playbackRate = next;
  });

  bubble.playBtn.onclick = async () => {
    if (!spoken) { statusText.textContent = '这条只有动作描写,没有可朗读的台词'; return; }
    if (ttsProvider === 'browser') { speakBrowser(spoken); return; }

    if (currentPlayingBubble === bubble && !ttsPlayer.paused) {
      ttsPlayer.pause();
      bubble.playBtn.innerHTML = ICON_PLAY;
      return;
    }
    if (currentPlayingBubble === bubble && ttsPlayer.paused && audioUrl) {
      ttsPlayer.play();
      bubble.playBtn.innerHTML = ICON_PAUSE;
      return;
    }

    // Must happen synchronously inside the click handler, before any
    // `await` — iOS Safari only counts play() as tied to the user's tap if
    // it's called (near-)immediately. The real audio fetch below can take
    // a while (especially ElevenLabs' slower models), so by the time we'd
    // otherwise call ttsPlayer.play() the gesture window may have already
    // closed, silently rejecting it ("not allowed by the user agent").
    // Only needed on this fresh-fetch path — the pause/resume branches
    // above already call play()/pause() synchronously themselves.
    unlockAudioPlayback();

    bubble.playBtn.disabled = true;
    try {
      // Send the original text (stage directions and all) — the server
      // decides how to prep it per the provider it actually ends up using.
      if (!audioUrl) audioUrl = await fetchServerAudioUrl(text);
      if (currentPlayingBubble && currentPlayingBubble !== bubble) {
        currentPlayingBubble.playBtn.innerHTML = ICON_PLAY;
      }
      currentPlayingBubble = bubble;
      ttsPlayer.pause();
      ttsPlayer.src = audioUrl;
      ttsPlayer.playbackRate = playbackRate;
      ttsPlayer.currentTime = 0;
      await ttsPlayer.play();
      bubble.playBtn.innerHTML = ICON_PAUSE;
    } catch (err) {
      statusText.textContent = 'TTS 出错: ' + err.message;
    } finally {
      bubble.playBtn.disabled = false;
    }
  };
}

async function sendMessage(rawText) {
  const text = (rawText || '').trim();
  const imageFiles = selectedImageFiles;
  if ((!text && !imageFiles.length) || !currentSessionId) return;

  const localImageUrls = imageFiles.map((f) => URL.createObjectURL(f));
  const userBubble = appendBubble('user', text, localImageUrls);
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
    imageFiles.forEach((f) => form.append('images', f));

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
          renderBubbleText(assistantBubble.textEl, formatForDisplay(fullText));
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
    // server-side even if this connection dropped — this was previously a
    // manual "tap to reload" prompt, but that happened often enough to be
    // annoying, so try reloading automatically a couple of times first
    // (giving the server a moment in case it's still mid-request/retry)
    // before falling back to asking the user to do it themselves.
    assistantBubble.el.remove();
    statusText.textContent = '连接断了,自动重连中...';
    const recovered = await tryAutoRecover(currentSessionId, [1500, 3000]);
    if (!recovered) {
      statusText.textContent = '';
      const retryBubble = appendBubble('assistant', `(出错了: ${err.message} —— 点这条消息重新加载,看看是不是其实发出去了)`);
      retryBubble.el.style.cursor = 'pointer';
      retryBubble.el.addEventListener('click', () => selectSession(currentSessionId), { once: true });
    }
  } finally {
    setBusy(false);
  }
}

// Reload the session from the database and check whether the last message
// is now an assistant reply (meaning the request actually completed
// server-side despite the client-side connection dropping). Waits `delays`
// between attempts, longest last, since the server may still be retrying
// internally when the first check happens.
async function tryAutoRecover(sessionId, delays) {
  for (const delay of delays) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      await selectSession(sessionId);
    } catch {
      continue;
    }
    const last = transcriptEl.lastElementChild;
    if (last && last.classList.contains('assistant')) return true;
  }
  return false;
}

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

function renderImagePreview() {
  imagePreview.innerHTML = '';
  if (!selectedImageFiles.length) {
    imagePreview.classList.add('hidden');
    return;
  }
  selectedImageFiles.forEach((file, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'image-preview-thumb';

    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    thumb.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'image-preview-remove';
    removeBtn.type = 'button';
    removeBtn.title = '移除这张';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      selectedImageFiles.splice(i, 1);
      renderImagePreview();
    });
    thumb.appendChild(removeBtn);

    imagePreview.appendChild(thumb);
  });
  imagePreview.classList.remove('hidden');
}

function clearImageSelection() {
  selectedImageFiles = [];
  imageInput.value = '';
  renderImagePreview();
}

imageBtn.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', () => {
  const files = Array.from(imageInput.files || []);
  if (!files.length) return;
  selectedImageFiles = selectedImageFiles.concat(files).slice(0, MAX_IMAGES);
  imageInput.value = '';
  renderImagePreview();
});
