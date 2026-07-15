const callBtn = document.getElementById('callBtn');
const callIcon = document.getElementById('callIcon');
const statusText = document.getElementById('statusText');
const interruptBtn = document.getElementById('interruptBtn');
const transcriptEl = document.getElementById('transcript');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const systemPromptEl = document.getElementById('systemPrompt');
const sttLangEl = document.getElementById('sttLang');
const voiceSelectEl = document.getElementById('voiceSelect');

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let callActive = false;
let currentTranscript = null;
let messages = [];
let abortController = null;
let pendingUtterances = 0;
let streamDone = true;
let selectedVoice = null;

function setState(state) {
  callBtn.className = 'call-btn ' + state;
  interruptBtn.classList.toggle('hidden', state !== 'thinking' && state !== 'speaking');
  const labels = {
    idle: '点击下方按钮开始通话',
    listening: '在听...',
    thinking: '思考中...',
    speaking: '说话中...',
  };
  statusText.textContent = labels[state] || '';
  callIcon.textContent = state === 'idle' ? '🎙️' : (state === 'listening' ? '🎧' : (state === 'thinking' ? '…' : '🔊'));
}

function appendBubble(role, text) {
  const div = document.createElement('div');
  div.className = 'bubble ' + role;
  div.textContent = text;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return div;
}

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

function speakSentence(text) {
  if (!text.trim()) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = sttLangEl.value;
  if (selectedVoice) utter.voice = selectedVoice;
  pendingUtterances++;
  utter.onend = utter.onerror = () => {
    pendingUtterances--;
    maybeReturnToListening();
  };
  speechSynthesis.speak(utter);
}

function maybeReturnToListening() {
  if (callActive && streamDone && pendingUtterances <= 0) {
    startListening();
  }
}

function initRecognition() {
  recognition = new SpeechRecognitionImpl();
  recognition.lang = sttLangEl.value;
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    const result = e.results[e.results.length - 1];
    if (result.isFinal) {
      currentTranscript = result[0].transcript.trim();
    }
  };

  recognition.onend = () => {
    if (!callActive) return;
    if (currentTranscript) {
      const t = currentTranscript;
      currentTranscript = null;
      handleUserUtterance(t);
    } else {
      startListening();
    }
  };

  recognition.onerror = (e) => {
    if (e.error === 'aborted' || e.error === 'no-speech') return;
    statusText.textContent = '识别出错: ' + e.error;
  };
}

function startListening() {
  if (!callActive) return;
  setState('listening');
  try {
    recognition.lang = sttLangEl.value;
    recognition.start();
  } catch (err) {
    // already started; ignore
  }
}

async function handleUserUtterance(text) {
  appendBubble('user', text);
  messages.push({ role: 'user', content: text });
  setState('thinking');

  const assistantBubble = appendBubble('assistant', '');
  let fullText = '';
  let sentenceBuffer = '';
  streamDone = false;
  abortController = new AbortController();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system: systemPromptEl.value || undefined }),
      signal: abortController.signal,
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
          sentenceBuffer += payload.text;
          assistantBubble.textContent = fullText;
          transcriptEl.scrollTop = transcriptEl.scrollHeight;
          setState('speaking');

          const match = sentenceBuffer.match(/^(.*?[。!?\n.!?])(.*)$/s);
          if (match) {
            speakSentence(match[1]);
            sentenceBuffer = match[2];
          }
        }
      }
    }

    if (sentenceBuffer.trim()) speakSentence(sentenceBuffer);
    messages.push({ role: 'assistant', content: fullText });
  } catch (err) {
    if (err.name !== 'AbortError') {
      assistantBubble.textContent = '(出错了: ' + err.message + ')';
    }
  } finally {
    streamDone = true;
    maybeReturnToListening();
  }
}

function startCall() {
  callActive = true;
  messages = [];
  transcriptEl.innerHTML = '';
  initRecognition();
  startListening();
}

function endCall() {
  callActive = false;
  streamDone = true;
  pendingUtterances = 0;
  if (recognition) {
    try { recognition.abort(); } catch (e) {}
  }
  speechSynthesis.cancel();
  if (abortController) abortController.abort();
  setState('idle');
}

callBtn.addEventListener('click', () => {
  if (callActive) {
    endCall();
  } else {
    if (!SpeechRecognitionImpl) {
      alert('这个浏览器不支持语音识别,换 Chrome 或 Edge 试试。');
      return;
    }
    startCall();
  }
});

interruptBtn.addEventListener('click', () => {
  speechSynthesis.cancel();
  pendingUtterances = 0;
  if (abortController) abortController.abort();
  if (callActive) startListening();
});

setState('idle');
