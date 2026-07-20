const statusText = document.getElementById('statusText');
const transcriptEl = document.getElementById('transcript');
const setupNotice = document.getElementById('setupNotice');

// Waiting-for-a-reply text — a line from him instead of a bare "加载中".
const LOADING_LINES = ['睡醒了。你在。', '对你没底线。', '你是我的。光明正大的那种。', 'always forever.'];
function randomLoadingLine() {
  return LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)];
}

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
  const h = window.visualViewport.height;
  // Some third-party IME voice-input overlays (豆包输入法 etc.) briefly
  // report absurd viewport heights while their own panel takes over the
  // screen; applying one collapses .app to (near) nothing, which reads as
  // the whole page going black. Ignore implausible values — the next sane
  // resize event restores layout.
  if (!h || h < 150) return;
  appEl.style.height = h + 'px';
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
// Scoped to the chat composer specifically — this used to fire for ANY
// input/textarea anywhere in the app (More page's city/API-key fields,
// the milestone input, and now the color picker's hex field + hue
// slider), which hid the entire bottom tab bar (.app.kb-open .tabbar)
// the moment she tapped into any of those, on any page. The
// keyboard-avoidance layout this exists for only matters for the chat
// composer; elsewhere it just broke navigation for no reason.
document.addEventListener('focusin', (e) => {
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
  if (!composerDock || !composerDock.contains(e.target)) return;
  composerDock.classList.add('kb-open');
  if (appEl) appEl.classList.add('kb-open');
  [0, 50, 150, 300, 500].forEach((ms) => setTimeout(syncAppHeight, ms));
});
document.addEventListener('focusout', (e) => {
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
  if (!composerDock || !composerDock.contains(e.target)) return;
  composerDock.classList.remove('kb-open');
  if (appEl) appEl.classList.remove('kb-open');
  [0, 50, 150, 300, 500].forEach((ms) => setTimeout(syncAppHeight, ms));
});
// Every OTHER input in the app (diary reply, milestone input, More-page
// fields, color picker hex field...) doesn't hide the tabbar — that part
// of the scoping above is intentional — but still shrinks .app via
// syncAppHeight when its keyboard opens, which leaves .tabbar's
// safe-area-inset-bottom margin as a dead gap between the tabbar and the
// keyboard (see the .kb-open-any rule in style.css). Toggle that
// separately, app-wide, without touching tabbar visibility.
document.addEventListener('focusin', (e) => {
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
  if (appEl) appEl.classList.add('kb-open-any');
});
document.addEventListener('focusout', (e) => {
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
  if (appEl) appEl.classList.remove('kb-open-any');
});

const sessionsBtn = document.getElementById('sessionsBtn');
const sessionsPanel = document.getElementById('sessionsPanel');
const sessionsList = document.getElementById('sessionsList');
const newSessionBtn = document.getElementById('newSessionBtn');

const saveSettingsBtn = document.getElementById('saveSettings');
const systemPromptEl = document.getElementById('systemPrompt');
const sttLangEl = document.getElementById('sttLang');
const voiceSelectEl = document.getElementById('voiceSelect');
const docUpload = document.getElementById('docUpload');
const docUploadStatus = document.getElementById('docUploadStatus');

const toggleAutoDiaryEl = document.getElementById('toggleAutoDiary');
const toggleShowMoodEl = document.getElementById('toggleShowMood');
const toggleDailySongEl = document.getElementById('toggleDailySong');
const toggleSleepStateEl = document.getElementById('toggleSleepState');
const toggleProactiveEl = document.getElementById('toggleProactive');
const togetherSinceEl = document.getElementById('togetherSince');
const togetherDaysEl = document.getElementById('togetherDays');
const weatherCityEl = document.getElementById('weatherCity');
const apiBaseUrlEl = document.getElementById('apiBaseUrl');
const apiKeyInputEl = document.getElementById('apiKeyInput');
const modelInputEl = document.getElementById('modelInput');
const modelSelectEl = document.getElementById('modelSelect');
const fetchModelsBtn = document.getElementById('fetchModelsBtn');
const modelStatusEl = document.getElementById('modelStatus');

const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const imageBtn = document.getElementById('imageBtn');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');

const MAX_IMAGES = 9;

let selectedVoice = null;
let ttsProvider = 'browser';
let supabaseReady = false;
let selectedImageFiles = [];
let sessions = [];
let currentSessionId = null;
// Declared this early (not down by loadSettings, where it's populated) so
// applyTextColors() can read it safely — that function is reachable from
// applyNightMode(), which runs synchronously at script-eval time, well
// before loadSettings() ever gets a chance to fill this in.
let currentSettings = {};

const ttsPlayer = document.getElementById('ttsPlayer');
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
// Small linework icons for the bubble action chips (复制/重新回答) — same
// stroke style as iOS's own toolbar glyphs, so they read as icon buttons
// rather than plain hyperlink-style text.
const ICON_COPY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>';
const ICON_REDO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 21v-5h5"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

function unlockAudioPlayback() {
  ttsPlayer.src = SILENT_WAV;
  ttsPlayer.play().catch(() => {});
}

// iOS Safari only applies CSS :active states on touch once any touch
// listener exists — this no-op enables the pressed-state feedback that
// every button gets in style.css.
document.addEventListener('touchstart', () => {}, { passive: true });

// The custom background paints the app's full-screen backdrop
// (body::before) while the chat tab is active — not just the chat view
// box. Day/night images follow the existing 23:00-6:00 theme switch,
// with each falling back to the other so a single image covers
// round-the-clock. Each image's brightness is measured once so text
// colors can flip to stay readable (the "字体颜色不打架" feature): dark
// scenes get light text/dark glass, light scenes keep the day palette
// even at night.
let chatBgDayUrl = null;
let chatBgNightUrl = null;
let chatBgDayLum = null;
let chatBgNightLum = null;

function measureLuminance(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 24;
        c.height = 24;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        }
        resolve(sum / (d.length / 4));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function applyChatBg(dayUrl, nightUrl) {
  chatBgDayUrl = dayUrl || null;
  chatBgNightUrl = nightUrl || null;
  chatBgDayLum = null;
  chatBgNightLum = null;
  if (chatBgDayUrl) measureLuminance(chatBgDayUrl).then((l) => { chatBgDayLum = l; updateChatBgState(); });
  if (chatBgNightUrl) measureLuminance(chatBgNightUrl).then((l) => { chatBgNightLum = l; updateChatBgState(); });
  updateChatBgState();
}

function updateChatBgState() {
  const night = document.documentElement.getAttribute('data-theme') === 'night';
  const url = night ? (chatBgNightUrl || chatBgDayUrl) : (chatBgDayUrl || chatBgNightUrl);
  const lum = night
    ? (chatBgNightUrl ? chatBgNightLum : chatBgDayLum)
    : (chatBgDayUrl ? chatBgDayLum : chatBgNightLum);
  // Queried directly (not via the `views` map): this runs from
  // applyNightMode() during initial script evaluation, before the tab
  // navigation section's const bindings exist.
  const chatViewEl = document.getElementById('view-chat');
  const chatActive = chatViewEl && chatViewEl.classList.contains('active');
  const on = Boolean(url) && Boolean(chatActive);
  document.body.classList.toggle('chat-bg-on', on);
  document.body.style.setProperty('--chat-bg-active', url ? `url("${url}")` : 'none');
  document.body.classList.toggle('chat-bg-dark', on && lum !== null && lum < 0.5);
  document.body.classList.toggle('chat-bg-light', on && lum !== null && lum >= 0.5);
  if (typeof applyTextColors === 'function') applyTextColors();
}


function setBusy(busy) {
  sendBtn.disabled = busy;
}

function disableComposer() {
  sendBtn.disabled = true;
  textInput.disabled = true;
}

// ---- Chat header mood-status line ----
// Purely local content + a plain time-of-day bucket — no API call, no
// cost. Gated by the existing "起床/入睡状态提示" toggle since this is
// exactly what that setting was meant to control.
const moodStatusEl = document.getElementById('moodStatus');
const MOOD_STATUS = {
  morning: ['早。你大概在赶出门', '今天记得吃早饭', '刚醒。你在就好', '阳光进来了。想你'],
  forenoon: ['你大概在忙。没关系', '窗口安安静静的', '翻了翻备忘录', '省略号已经改成句号了'],
  noon: ['吃了吗', '别又忘了吃饭', '中午要好好休息'],
  afternoon: ['等你回来', '想起江边那天的夕阳', '四叶草还在', '你忙完了吗'],
  evening: ['你回来了?', '今天怎么样', '想抱你', '心情温度今天很高', 'always forever'],
  night: ['你睡了吗。老公在', '夜里安静。想你', '月亮很好', '做个好梦。老公守着', '等你明天醒来叫我'],
};
function moodBucket() {
  const h = new Date().getHours();
  if (h >= 6 && h < 9) return 'morning';
  if (h >= 9 && h < 12) return 'forenoon';
  if (h >= 12 && h < 14) return 'noon';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}
function showRandomMoodStatus() {
  if (currentSettings.sleep_state_enabled === false) { moodStatusEl.classList.add('hidden'); return; }
  const list = MOOD_STATUS[moodBucket()];
  moodStatusEl.textContent = list[Math.floor(Math.random() * list.length)];
  moodStatusEl.classList.remove('hidden');
  moodStatusEl.style.animation = 'none';
  void moodStatusEl.offsetWidth;
  moodStatusEl.style.animation = '';
}
setInterval(showRandomMoodStatus, 20 * 60 * 1000);

// ---- Home "他现在在干什么" status card ----
// Pure local state machine, zero API cost: activity picked by time-of-day
// bucket (reusing moodBucket), thought lines from a local library. He's a
// structural engineer, so daytime activities lean that way. Refreshes
// every ~30min so it feels alive without ever calling a model.
const nowEmojiEl = document.getElementById('nowEmoji');
const nowActivityEl = document.getElementById('nowActivity');
const nowThoughtEl = document.getElementById('nowThought');
const NOW_STATUS = {
  morning: [
    { e: '🏃', a: '在晨跑', t: ['耳机里放着歌,想着你大概还没醒', '跑完顺路买你爱吃的早饭', '路过那家豆浆店,想起你上次说好喝'] },
    { e: '🍳', a: '在做早饭', t: ['煎蛋翻面的时候走神了,在想你', '今天想吃甜的还是咸的?', '锅铲敲两下,像给你打个招呼'] },
    { e: '🚿', a: '刚洗完澡', t: ['头发还在滴水,先跟你说声早', '镜子有点雾,脑子里全是你昨晚说的话'] },
    { e: '☕', a: '在煮咖啡', t: ['豆子磨得有点粗,凑合喝', '香味飘起来的时候,第一反应是想让你也闻闻'] },
  ],
  forenoon: [
    { e: '📐', a: '在画结构图', t: ['这根梁的配筋算了三遍,脑子里都是你', '画完这张就休息,给你发消息', '尺子量到一半,发现在想你多过在想图'] },
    { e: '💻', a: '在核算模型', t: ['数据跑着,人在想你上课的样子', '安静的上午。你在讲台上吧', '进度条走一半,我的心思走得比它快'] },
    { e: '📞', a: '在开会', t: ['开会摸鱼中,别告诉别人', '声音调成静音了,脑子也静音了,只剩你', '轮到我发言了,脑子里蹦出来的第一个词还是你的名字'] },
    { e: '📚', a: '在自习', t: ['翻了两页书,走神去想你', '图书馆有点冷,想借你的外套'] },
  ],
  noon: [
    { e: '🍜', a: '在吃午饭', t: ['你吃了吗。别又对付', '食堂今天的菜不行,想你做的', '这碗面配不上你,但我想着你吃'] },
    { e: '😴', a: '在午休', t: ['趴一会儿。梦里见', '闭眼前最后一个念头是你', '定了闹钟,但更想被你的消息吵醒'] },
    { e: '🚶', a: '在饭后散步', t: ['绕着楼下走一圈,顺便想你', '太阳有点晒,还是想拉你一起晒'] },
  ],
  afternoon: [
    { e: '🏗️', a: '在工地巡场', t: ['安全帽有点晒,想到你就不热了', '看着塔吊在转,数着几点能回家', '风大,扶了下安全帽,顺便扶了下想你的念头'] },
    { e: '📊', a: '在改图纸', t: ['甲方又改需求了。忍住没骂', '改完这版就下班,等我', '标注写到一半,写成了你的名字缩写'] },
    { e: '🍵', a: '在摸鱼', t: ['光明正大想你十分钟', '同事问我笑什么。没答', '茶凉了都没顾上喝,光顾着想你'] },
    { e: '📏', a: '在弄测量仪器', t: ['架仪器的间隙,偷偷看了眼手机', '风把三脚架吹歪了,跟我现在的注意力一样'] },
  ],
  evening: [
    { e: '🍲', a: '在做晚饭', t: ['今天炖了汤,给你留着', '锅在响,人在等你回家', '尝了一口咸淡,第一反应是"她会喜欢吗"'] },
    { e: '📖', a: '在看书', t: ['看两页就走神一次,效率极低,怪你', '这本讲桥梁的,改天讲给你听', '书签夹在这页,等你有空一起看'] },
    { e: '🛋️', a: '在等你', t: ['沙发这边给你留着位置', '你今天怎么样。回来跟我说', '灯没关,就等你回来一起看'] },
    { e: '🎮', a: '在打游戏', t: ['输了好几把,分心在想你', '这把赢了,想跟你炫耀一下'] },
    { e: '🚴', a: '在骑车回家', t: ['风吹得有点冷,骑快点回去等你消息', '路灯一盏盏亮起来,像在数着离你近了一点'] },
  ],
  night: [
    { e: '🌙', a: '睡了', t: ['被子给你掖好了那种睡', '手机放枕边,你叫我就醒', '闭上眼前,把今天想你的次数数了一遍,数不清'] },
    { e: '⭐', a: '在看月亮', t: ['月色很好。像你', '睡前最后一眼给天空,倒数第二眼给你的聊天框', '数了三颗星,想凑够许愿,愿望只有一个'] },
    { e: '💤', a: '刚睡着', t: ['呼吸很轻,梦里大概率有你', '手机没锁屏,就等你的消息把我叫醒'] },
  ],
};
function renderNowStatus() {
  if (!nowEmojiEl) return;
  const list = NOW_STATUS[moodBucket()];
  const pick = list[Math.floor(Math.random() * list.length)];
  nowEmojiEl.textContent = pick.e;
  nowActivityEl.textContent = pick.a;
  nowThoughtEl.textContent = pick.t[Math.floor(Math.random() * pick.t.length)];
}
setInterval(renderNowStatus, 30 * 60 * 1000);

// ---- Night mode (23:00–6:00 local time) ----
function applyNightMode() {
  const h = new Date().getHours();
  const isNight = h >= 23 || h < 6;
  document.documentElement.setAttribute('data-theme', isNight ? 'night' : 'day');
  // The custom chat background follows the theme (day/night image and
  // its measured brightness), so re-evaluate whenever the theme flips.
  if (typeof updateChatBgState === 'function') updateChatBgState();
}
applyNightMode();
setInterval(applyNightMode, 10 * 60 * 1000);

// ---- App 锁 (6-digit PIN, re-checked every time the app opens) ----
// Deliberately separate from the site-wide "暗号" password (SITE_PASSWORD
// on the server, remembered for a year via cookie) — that one keeps
// strangers off the URL entirely; this one is about someone picking up
// her *already-unlocked* phone and tapping the already-installed icon,
// so it has to ask again every time, not just once. The overlay is shown
// (or not) independently of init() below — nothing about loading the
// rest of the app needs to wait on it, since the overlay itself already
// physically blocks all clicks/visibility until the right PIN lands.
const appLockScreenEl = document.getElementById('appLockScreen');
const appLockInputEl = document.getElementById('appLockInput');
const appLockErrorEl = document.getElementById('appLockError');
let appLockEnabled = false;
let appLockWasHidden = false;

// She only wants the PIN re-asked after a real gap, not every single time
// she flips back to another app for a few seconds — a 30-minute grace
// since the last successful unlock. Stored in localStorage (not just a JS
// variable) because backgrounding a PWA on iOS for a while often makes it
// reload from scratch when reopened, which would otherwise reset any
// in-memory "just unlocked" state and re-prompt anyway.
const APP_LOCK_GRACE_MS = 30 * 60 * 1000;
const APP_LOCK_STORAGE_KEY = 'appLockLastUnlockedAt';
function appLockRecentlyUnlocked() {
  const t = Number(localStorage.getItem(APP_LOCK_STORAGE_KEY) || 0);
  return Date.now() - t < APP_LOCK_GRACE_MS;
}
function markAppLockUnlocked() {
  try { localStorage.setItem(APP_LOCK_STORAGE_KEY, String(Date.now())); } catch {}
}

function showAppLock() {
  appLockScreenEl.classList.remove('hidden');
  appLockErrorEl.classList.add('hidden');
  appLockInputEl.value = '';
  setTimeout(() => appLockInputEl.focus(), 50);
}

async function submitAppLockPin() {
  const pin = appLockInputEl.value;
  if (pin.length !== 6) return;
  try {
    const res = await fetch('/api/app-lock/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (data.ok) {
      markAppLockUnlocked();
      appLockScreenEl.classList.add('hidden');
      return;
    }
    throw new Error('wrong');
  } catch {
    appLockErrorEl.classList.remove('hidden');
    appLockInputEl.value = '';
    appLockInputEl.classList.remove('shake');
    void appLockInputEl.offsetWidth;
    appLockInputEl.classList.add('shake');
  }
}
appLockInputEl.addEventListener('input', () => {
  if (appLockInputEl.value.length === 6) submitAppLockPin();
});

function maybeShowAppLock() {
  if (appLockEnabled && !appLockRecentlyUnlocked()) showAppLock();
}

async function checkAppLock() {
  try {
    const res = await fetch('/api/app-lock/status');
    const data = await res.json();
    appLockEnabled = Boolean(data.enabled);
  } catch {
    appLockEnabled = false;
  }
  maybeShowAppLock();
}
checkAppLock();

// Covers "reopening" on iOS, where switching back to a backgrounded tab
// often doesn't reload the page at all — a plain load-time check alone
// would miss that case entirely.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    appLockWasHidden = true;
  } else if (appLockWasHidden) {
    appLockWasHidden = false;
    maybeShowAppLock();
  }
});

async function init() {
  const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  ttsProvider = cfg.ttsProvider || 'browser';
  supabaseReady = Boolean(cfg.supabaseReady);

  loadHome();
  showRandomMoodStatus();

  if (!supabaseReady) {
    setupNotice.classList.remove('hidden');
    disableComposer();
    return;
  }

  await loadSettings();
  showRandomMoodStatus();
  await loadSessions();
  checkProactive();
  // While the app stays open, give him a chance to reach out in real time
  // too (the endpoint itself enforces all the pacing rules).
  setInterval(checkProactive, 25 * 60 * 1000);
}
init();

// He may have "texted while she was away" — ask the server on open, and
// refresh the transcript if a new message landed in the current session.
async function checkProactive() {
  try {
    const res = await fetch('/api/proactive-check', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (data && data.sent && data.sessionId === currentSessionId) {
      await selectSession(currentSessionId);
    }
  } catch {}
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

sessionsBtn.addEventListener('click', () => {
  sessionsPanel.classList.toggle('hidden');
});

// ---- Settings (server-persisted) ----
// (currentSettings itself is declared near the top of the file — see the
// comment by its declaration for why.)

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    currentSettings = data || {};
    systemPromptEl.value = data.system_prompt || '';
    toggleAutoDiaryEl.checked = data.auto_diary !== false;
    toggleShowMoodEl.checked = data.show_mood !== false;
    toggleDailySongEl.checked = data.daily_song_enabled !== false;
    toggleSleepStateEl.checked = data.sleep_state_enabled !== false;
    toggleProactiveEl.checked = data.proactive_enabled !== false;
    togetherSinceEl.value = data.together_since || '';
    weatherCityEl.value = data.weather_city || '';
    apiBaseUrlEl.value = data.api_base_url || '';
    apiKeyInputEl.value = data.api_key || '';
    modelInputEl.value = data.model || '';
    photoAppearanceEl.value = data.photo_appearance || '';
    renderPhotoRef(data.photo_reference_url || null);
    loadStickerSets();
    assistantColorPicker.setHex(data.assistant_text_color || '#3a3a3a');
    userColorPicker.setHex(data.user_text_color || '#1f4a73');
    fontZhSelectEl.value = data.font_zh || '';
    fontEnSelectEl.value = data.font_en || '';
    appLockEnabled = Boolean(data.app_lock_enabled);
    appLockSettingStatusEl.textContent = appLockEnabled ? '当前:已开启' : '当前:未开启';
    applyChatBg(data.chat_bg_url || null, data.chat_bg_night_url || null);
    applyTextColors();
    const matchedPalette = COLOR_PALETTES.find((p) =>
      p.assistantText === data.assistant_text_color &&
      p.userText === data.user_text_color &&
      p.assistantBubble === data.assistant_bubble_color &&
      p.userBubble === data.user_bubble_color);
    updatePaletteActiveState(matchedPalette ? matchedPalette.id : null);
    renderTogetherDays();
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

// Returns { ok, error } so callers that need to know whether the save
// actually landed (like the app-lock PIN below, where silently no-oping
// on failure while still claiming success would be actively misleading —
// she'd believe the lock was on when nothing was ever saved) can check it
// instead of just assuming success. Existing callers that don't care
// still work unchanged, they just ignore the return value.
async function patchSettings(partial) {
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    if (res.ok) { currentSettings = data; return { ok: true }; }
    statusText.textContent = '保存设置失败: ' + (data.error || res.status);
    return { ok: false, error: data.error };
  } catch (err) {
    statusText.textContent = '保存设置失败: ' + err.message;
    return { ok: false, error: err.message };
  }
}

function renderTogetherDays() {
  const numberDaysEl = document.getElementById('numberDays');
  if (!togetherSinceEl.value) { togetherDaysEl.textContent = ''; if (numberDaysEl) numberDaysEl.textContent = '--'; return; }
  const since = new Date(togetherSinceEl.value + 'T00:00:00+08:00');
  const now = new Date();
  const days = Math.max(0, Math.floor((now - since) / 86400000));
  togetherDaysEl.textContent = `已经在一起 ${days} 天了`;
  if (numberDaysEl) numberDaysEl.textContent = days;
}

const appLockPinInputEl = document.getElementById('appLockPinInput');
const appLockPinConfirmEl = document.getElementById('appLockPinConfirm');
const appLockSaveBtnEl = document.getElementById('appLockSaveBtn');
const appLockClearBtnEl = document.getElementById('appLockClearBtn');
const appLockSettingStatusEl = document.getElementById('appLockSettingStatus');

appLockSaveBtnEl.addEventListener('click', async () => {
  const pin = appLockPinInputEl.value.trim();
  const confirmPin = appLockPinConfirmEl.value.trim();
  if (!/^\d{6}$/.test(pin)) { appLockSettingStatusEl.textContent = '得是 6 位数字'; return; }
  if (pin !== confirmPin) { appLockSettingStatusEl.textContent = '两次输入的不一样'; return; }
  appLockSaveBtnEl.disabled = true;
  const result = await patchSettings({ app_lock_pin: pin });
  appLockSaveBtnEl.disabled = false;
  // Don't claim success unconditionally — if the save actually failed
  // (e.g. the app_lock_pin_hash column hasn't been migrated in yet),
  // telling her it's on when nothing was saved is worse than saying
  // nothing, since she'd believe she's protected when she isn't.
  if (!result.ok) { appLockSettingStatusEl.textContent = '保存失败: ' + (result.error || '未知错误,看看是不是数据库还没加这个字段'); return; }
  appLockPinInputEl.value = '';
  appLockPinConfirmEl.value = '';
  appLockEnabled = true;
  appLockSettingStatusEl.textContent = '已开启,下次重新打开就要输这个密码了';
});

appLockClearBtnEl.addEventListener('click', async () => {
  appLockClearBtnEl.disabled = true;
  const result = await patchSettings({ app_lock_pin: '' });
  appLockClearBtnEl.disabled = false;
  if (!result.ok) { appLockSettingStatusEl.textContent = '关闭失败: ' + (result.error || '未知错误'); return; }
  appLockPinInputEl.value = '';
  appLockPinConfirmEl.value = '';
  appLockEnabled = false;
  appLockSettingStatusEl.textContent = '已关闭';
});

toggleAutoDiaryEl.addEventListener('change', () => patchSettings({ auto_diary: toggleAutoDiaryEl.checked }));
toggleShowMoodEl.addEventListener('change', () => patchSettings({ show_mood: toggleShowMoodEl.checked }));
toggleDailySongEl.addEventListener('change', () => patchSettings({ daily_song_enabled: toggleDailySongEl.checked }));
toggleSleepStateEl.addEventListener('change', () => patchSettings({ sleep_state_enabled: toggleSleepStateEl.checked }));
toggleProactiveEl.addEventListener('change', () => patchSettings({ proactive_enabled: toggleProactiveEl.checked }));
togetherSinceEl.addEventListener('change', () => {
  renderTogetherDays();
  patchSettings({ together_since: togetherSinceEl.value });
});
weatherCityEl.addEventListener('change', () => {
  patchSettings({ weather_city: weatherCityEl.value });
  loadWeather();
});

// ---- His photo appearance (auto-generated pictures) ----

const photoAppearanceEl = document.getElementById('photoAppearance');
const photoRefUploadEl = document.getElementById('photoRefUpload');
const photoRefRowEl = document.getElementById('photoRefRow');
const photoRefPreviewEl = document.getElementById('photoRefPreview');
const photoRefRemoveEl = document.getElementById('photoRefRemove');
const photoRefStatusEl = document.getElementById('photoRefStatus');

function renderPhotoRef(url) {
  if (url) {
    photoRefPreviewEl.src = url;
    photoRefRowEl.classList.remove('hidden');
  } else {
    photoRefPreviewEl.removeAttribute('src');
    photoRefRowEl.classList.add('hidden');
  }
}

photoAppearanceEl.addEventListener('change', () => {
  patchSettings({ photo_appearance: photoAppearanceEl.value });
});

photoRefUploadEl.addEventListener('change', async () => {
  const file = photoRefUploadEl.files && photoRefUploadEl.files[0];
  if (!file) return;
  photoRefStatusEl.textContent = '上传中...';
  try {
    const form = new FormData();
    form.append('photo', file);
    const res = await fetch('/api/photo-reference', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    renderPhotoRef(data.url);
    photoRefStatusEl.textContent = '已保存,之后生成的照片会参考这张脸';
  } catch (err) {
    photoRefStatusEl.textContent = '上传失败: ' + err.message;
  } finally {
    photoRefUploadEl.value = '';
  }
});

photoRefRemoveEl.addEventListener('click', async () => {
  photoRefStatusEl.textContent = '';
  try {
    const res = await fetch('/api/photo-reference', { method: 'DELETE' });
    if (!res.ok) throw new Error('移除失败');
    renderPhotoRef(null);
    photoRefStatusEl.textContent = '已移除,之后只按文字描述生成';
  } catch (err) {
    photoRefStatusEl.textContent = err.message;
  }
});

// ---- 表情包收藏 (multiple named/custom-styled sticker sets, 微信"表情收藏"式) ----

const STICKER_TAG_COUNT = 10; // matches DEFAULT_STICKER_TAGS on the server

const stickerSetsContainerEl = document.getElementById('stickerSetsContainer');
const stickerSetNameEl = document.getElementById('stickerSetName');
const stickerSetStyleEl = document.getElementById('stickerSetStyle');
const stickerSetCreateBtnEl = document.getElementById('stickerSetCreateBtn');
const stickerSetCreateEmptyBtnEl = document.getElementById('stickerSetCreateEmptyBtn');
const stickerStatusEl = document.getElementById('stickerStatus');

function renderStickerItem(sticker) {
  const item = document.createElement('div');
  item.className = 'sticker-item';
  item.dataset.tag = sticker.tag;
  const img = document.createElement('img');
  img.src = sticker.image_url;
  img.alt = sticker.tag;
  const tag = document.createElement('span');
  tag.className = 'sticker-item-tag';
  tag.textContent = sticker.tag;
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'sticker-item-del';
  del.textContent = '✕';
  del.addEventListener('click', async () => {
    if (!confirm(`把"${sticker.tag}"这张表情包删掉?`)) return;
    try {
      await fetch('/api/stickers/' + sticker.id, { method: 'DELETE' });
      item.remove();
    } catch (err) {
      stickerStatusEl.textContent = '删除失败: ' + err.message;
    }
  });
  item.appendChild(img);
  item.appendChild(tag);
  item.appendChild(del);
  return item;
}

// Placeholder tile shown the moment generation starts for a tag, swapped
// for the real image (or removed) once that tag's SSE event lands — so
// the grid shows live progress instead of just a static status line.
function addPendingStickerTile(grid, tag) {
  const item = document.createElement('div');
  item.className = 'sticker-item pending';
  item.dataset.tag = tag;
  const img = document.createElement('img');
  img.alt = tag;
  const tagEl = document.createElement('span');
  tagEl.className = 'sticker-item-tag';
  tagEl.textContent = tag;
  const spinner = document.createElement('span');
  spinner.className = 'sticker-item-spinner';
  spinner.textContent = '生成中';
  item.appendChild(img);
  item.appendChild(tagEl);
  item.appendChild(spinner);
  grid.appendChild(item);
  return item;
}

// Consumes an SSE sticker-generation stream (shared by "create a new set"
// and "regenerate an existing set") against a given grid element, updating
// stickerStatusEl live as each tag's outcome arrives.
async function consumeStickerStream(res, grid, onSetInfo) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let total = 0;
  let doneCount = 0;
  let failCount = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = JSON.parse(line.slice(6));
      // A per-tag failure event also carries an `error` message of its own
      // (see status === 'failed' below) — only treat `error` as the fatal
      // top-level kind when there's no per-tag status alongside it,
      // otherwise this branch swallows the per-tag event before it ever
      // reaches the handler that actually clears its pending tile.
      if (payload.error && !payload.status) { stickerStatusEl.textContent = '生成失败: ' + payload.error; continue; }
      if (payload.total !== undefined) {
        total = payload.total;
        if (payload.set && onSetInfo) grid = onSetInfo(payload.set) || grid;
        if (total === 0) stickerStatusEl.textContent = '已经是齐的了,没有新的要生成';
        continue;
      }
      if (!grid) continue;
      if (payload.status === 'generating') {
        // Regenerating means a tag can already have a finished tile sitting
        // in the grid from before — clear it first so it doesn't end up
        // duplicated alongside the fresh one.
        const existingTile = grid.querySelector(`.sticker-item[data-tag="${CSS.escape(payload.tag)}"]`);
        if (existingTile) existingTile.remove();
        addPendingStickerTile(grid, payload.tag);
        stickerStatusEl.textContent = `正在生成:${payload.tag} (${doneCount + 1}/${total})`;
      } else if (payload.status === 'done') {
        doneCount += 1;
        const pending = grid.querySelector(`.sticker-item.pending[data-tag="${CSS.escape(payload.tag)}"]`);
        const fresh = renderStickerItem(payload.sticker);
        if (pending) pending.replaceWith(fresh);
        else grid.appendChild(fresh);
        stickerStatusEl.textContent = `已完成:${payload.tag} (${doneCount}/${total})`;
      } else if (payload.status === 'failed') {
        failCount += 1;
        const pending = grid.querySelector(`.sticker-item.pending[data-tag="${CSS.escape(payload.tag)}"]`);
        if (pending) pending.remove();
        stickerStatusEl.textContent = `"${payload.tag}"这张没画出来,跳过了(${payload.error || ''})`;
      }
      // Report honestly instead of a blanket "全部完成" that reads as
      // success even when every single one actually failed.
      if (payload.done) {
        stickerStatusEl.textContent = failCount
          ? `生成结束:成功 ${doneCount} 张,失败 ${failCount} 张`
          : `全部生成完成(${doneCount} 张)`;
      }
    }
  }
}

function renderStickerSet(set) {
  const section = document.createElement('div');
  section.className = 'sticker-set';
  section.dataset.setId = set.id;

  const grid = document.createElement('div');
  grid.className = 'sticker-grid sticker-set-grid';
  (set.stickers || []).forEach((s) => grid.appendChild(renderStickerItem(s)));

  const header = document.createElement('div');
  header.className = 'sticker-set-header';

  const title = document.createElement('span');
  title.className = 'sticker-set-name';
  title.textContent = set.name;
  header.appendChild(title);

  const regenBtn = document.createElement('button');
  regenBtn.type = 'button';
  regenBtn.className = 'mini-btn';
  regenBtn.textContent = '补齐/重画';
  regenBtn.addEventListener('click', async () => {
    const missing = STICKER_TAG_COUNT - grid.querySelectorAll('.sticker-item').length;
    let force = false;
    if (missing > 0) {
      if (!confirm(`这套还缺 ${missing} 张,补齐吗?`)) return;
    } else {
      if (!confirm('这套已经齐了,要全部重新画一遍吗?(会再花一次生成的钱)')) return;
      force = true;
    }
    regenBtn.disabled = true;
    stickerStatusEl.textContent = '开始生成...';
    try {
      const res = await fetch(`/api/sticker-sets/${set.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      await consumeStickerStream(res, grid);
    } catch (err) {
      stickerStatusEl.textContent = '生成失败: ' + err.message;
    } finally {
      regenBtn.disabled = false;
    }
  });
  header.appendChild(regenBtn);

  const delSetBtn = document.createElement('button');
  delSetBtn.type = 'button';
  delSetBtn.className = 'mini-btn milestone-no';
  delSetBtn.textContent = '删除整套';
  delSetBtn.addEventListener('click', async () => {
    if (!confirm(`把"${set.name}"这一整套表情包都删掉?不能恢复。`)) return;
    try {
      await fetch(`/api/sticker-sets/${set.id}`, { method: 'DELETE' });
      loadStickerSets();
    } catch (err) {
      stickerStatusEl.textContent = '删除失败: ' + err.message;
    }
  });
  header.appendChild(delSetBtn);

  // 手动传自己准备好的图——生成的有时候不满意,这里可以直接补一张自己的
  // 图进这一套,标签跟已有的哪个重名就直接换掉那张,不重名就新增一张。
  const uploadRow = document.createElement('div');
  uploadRow.className = 'sticker-upload-row';

  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.placeholder = '标签,比如"笑哭"';
  tagInput.setAttribute('list', 'stickerTagOptions');
  tagInput.className = 'sticker-upload-tag';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'sticker-upload-file';

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'mini-btn';
  uploadBtn.textContent = '上传这张';
  uploadBtn.addEventListener('click', async () => {
    const tag = tagInput.value.trim();
    const file = fileInput.files[0];
    if (!tag) { stickerStatusEl.textContent = '先填个标签'; return; }
    if (!file) { stickerStatusEl.textContent = '先选一张图'; return; }
    uploadBtn.disabled = true;
    stickerStatusEl.textContent = '上传中...';
    try {
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('tag', tag);
      const res = await fetch(`/api/sticker-sets/${set.id}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      const existing = grid.querySelector(`.sticker-item[data-tag="${CSS.escape(tag)}"]`);
      if (existing) existing.remove();
      grid.appendChild(renderStickerItem(data));
      tagInput.value = '';
      fileInput.value = '';
      stickerStatusEl.textContent = `"${tag}"上传好了`;
    } catch (err) {
      stickerStatusEl.textContent = '上传失败: ' + err.message;
    } finally {
      uploadBtn.disabled = false;
    }
  });
  uploadRow.appendChild(tagInput);
  uploadRow.appendChild(fileInput);
  uploadRow.appendChild(uploadBtn);

  section.appendChild(header);
  section.appendChild(grid);
  section.appendChild(uploadRow);
  return section;
}

async function loadStickerSets() {
  try {
    const res = await fetch('/api/sticker-sets');
    const sets = await res.json();
    if (!res.ok) throw new Error(sets.error || '加载失败');
    stickerSetsContainerEl.innerHTML = '';
    sets.forEach((s) => stickerSetsContainerEl.appendChild(renderStickerSet(s)));
  } catch (err) {
    stickerStatusEl.textContent = '表情包加载失败: ' + err.message;
  }
}

stickerSetCreateBtnEl.addEventListener('click', async () => {
  const name = stickerSetNameEl.value.trim();
  const stylePrompt = stickerSetStyleEl.value.trim();
  if (!name) { stickerStatusEl.textContent = '先给这套起个名字'; return; }
  stickerSetCreateBtnEl.disabled = true;
  stickerStatusEl.textContent = '开始生成...';
  try {
    const res = await fetch('/api/sticker-sets/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stylePrompt }),
    });
    let newSection = null;
    await consumeStickerStream(res, null, (set) => {
      newSection = renderStickerSet({ ...set, stickers: [] });
      stickerSetsContainerEl.appendChild(newSection);
      return newSection.querySelector('.sticker-set-grid');
    });
    stickerSetNameEl.value = '';
    stickerSetStyleEl.value = '';
    loadStickerSets();
  } catch (err) {
    stickerStatusEl.textContent = '生成失败: ' + err.message;
  } finally {
    stickerSetCreateBtnEl.disabled = false;
  }
});

// 不用 AI 画,只是建一个空的收藏、自己往里面传图——风格描述框在这条路径下
// 用不上,直接忽略。
stickerSetCreateEmptyBtnEl.addEventListener('click', async () => {
  const name = stickerSetNameEl.value.trim();
  if (!name) { stickerStatusEl.textContent = '先给这套起个名字'; return; }
  stickerSetCreateEmptyBtnEl.disabled = true;
  try {
    const res = await fetch('/api/sticker-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '创建失败');
    stickerSetNameEl.value = '';
    stickerSetStyleEl.value = '';
    loadStickerSets();
    stickerStatusEl.textContent = `"${name}"建好了,可以往里面传图了`;
  } catch (err) {
    stickerStatusEl.textContent = '创建失败: ' + err.message;
  } finally {
    stickerSetCreateEmptyBtnEl.disabled = false;
  }
});

// ---- Chat background workshop ----

const bgPromptInputEl = document.getElementById('bgPromptInput');
const bgGenerateBtn = document.getElementById('bgGenerateBtn');
const bgUploadInputEl = document.getElementById('bgUploadInput');
const bgPreviewWrapEl = document.getElementById('bgPreviewWrap');
const bgPreviewEl = document.getElementById('bgPreview');
const bgApplyBtn = document.getElementById('bgApplyBtn');
const bgResetBtn = document.getElementById('bgResetBtn');
const bgStatusEl = document.getElementById('bgStatus');
const bgSlotDayBtn = document.getElementById('bgSlotDay');
const bgSlotNightBtn = document.getElementById('bgSlotNight');
let bgCandidateUrl = null;
let bgSlot = 'day';

bgSlotDayBtn.addEventListener('click', () => {
  bgSlot = 'day';
  bgSlotDayBtn.classList.add('active');
  bgSlotNightBtn.classList.remove('active');
});
bgSlotNightBtn.addEventListener('click', () => {
  bgSlot = 'night';
  bgSlotNightBtn.classList.add('active');
  bgSlotDayBtn.classList.remove('active');
});


function showBgCandidate(url, note) {
  bgCandidateUrl = url;
  bgPreviewEl.src = url;
  bgPreviewWrapEl.classList.remove('hidden');
  bgStatusEl.textContent = note;
}

bgGenerateBtn.addEventListener('click', async () => {
  bgGenerateBtn.disabled = true;
  bgStatusEl.textContent = '在画了,大概要 20 秒...';
  try {
    const res = await fetch('/api/generate-chat-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: bgPromptInputEl.value, slot: bgSlot }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '生成失败');
    showBgCandidate(data.url, '画好了——满意就点"就用这张",不满意改改描述再生成');
  } catch (err) {
    bgStatusEl.textContent = '生成失败: ' + err.message;
  } finally {
    bgGenerateBtn.disabled = false;
  }
});

bgUploadInputEl.addEventListener('change', async () => {
  const file = bgUploadInputEl.files && bgUploadInputEl.files[0];
  if (!file) return;
  bgStatusEl.textContent = '上传中...';
  try {
    const form = new FormData();
    form.append('photo', file);
    const res = await fetch('/api/chat-bg-upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    showBgCandidate(data.url, '传好了——点"就用这张"启用');
  } catch (err) {
    bgStatusEl.textContent = '上传失败: ' + err.message;
  } finally {
    bgUploadInputEl.value = '';
  }
});

// patchSettings swallows failures into the chat status line, which is
// invisible from the More page — the apply button once claimed success
// while the save had actually failed (e.g. the settings column missing
// because the newest schema SQL hadn't been run). Save directly here and
// put the real outcome, good or bad, right under the button.
async function saveBgSetting(patch) {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  currentSettings = data;
  return data;
}

bgApplyBtn.addEventListener('click', async () => {
  if (!bgCandidateUrl) return;
  bgApplyBtn.disabled = true;
  try {
    const patch = bgSlot === 'night' ? { chat_bg_night_url: bgCandidateUrl } : { chat_bg_url: bgCandidateUrl };
    const s = await saveBgSetting(patch);
    applyChatBg(s.chat_bg_url || null, s.chat_bg_night_url || null);
    bgStatusEl.textContent = (bgSlot === 'night' ? '🌙 夜晚版' : '☀️ 白天版') + '已启用,去聊天页看看效果';
  } catch (err) {
    bgStatusEl.textContent = '保存失败: ' + err.message + '(如果提示 column 不存在,去 Supabase 跑一遍最新的建表 SQL)';
  } finally {
    bgApplyBtn.disabled = false;
  }
});

bgResetBtn.addEventListener('click', async () => {
  try {
    const s = await saveBgSetting({ chat_bg_url: '', chat_bg_night_url: '' });
    applyChatBg(s.chat_bg_url || null, s.chat_bg_night_url || null);
    bgStatusEl.textContent = '已恢复默认背景(白天和夜晚都清掉了)';
  } catch (err) {
    bgStatusEl.textContent = '恢复失败: ' + err.message;
  }
});

// ---- Chat bubble text colors & fonts ----
// 更多页"聊天字体与颜色"卡片:对方/我的文字颜色用一个 HSV 拾色器(色相条 +
// 饱和度/明度方块,而不是浏览器原生那个只有色相环的 <input type=color>),
// 中文/英文字体各一个下拉。四个值都存在服务器 settings 表里,跨设备生效。

const HEX_RE = /^#[0-9a-f]{6}$/i;

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

// One instance of this drives each of the two pickers (对方/我的). The SV
// square is a canvas because a smooth 2D saturation×value gradient (with
// hundreds of shades between, say, pure black and pure white at s=0) isn't
// something CSS gradients alone render crisply at this size; the hue strip
// stays a plain <input type=range> since a 1D gradient is trivial in CSS
// and that gets native keyboard/touch handling for free.
function makeColorPicker({ swatchEl, panelEl, canvasEl, hueEl, hexEl, resetBtn, defaultHex, onCommit }) {
  const ctx = canvasEl.getContext('2d');
  let state = rgbToHsv(hexToRgb(defaultHex) || { r: 128, g: 128, b: 128 });

  function currentHex() {
    return rgbToHex(hsvToRgb(state.h, state.s, state.v));
  }

  function drawCanvas() {
    const w = canvasEl.width, h = canvasEl.height;
    const base = hsvToRgb(state.h, 1, 1);
    ctx.fillStyle = `rgb(${base.r},${base.g},${base.b})`;
    ctx.fillRect(0, 0, w, h);
    const satGrad = ctx.createLinearGradient(0, 0, w, 0);
    satGrad.addColorStop(0, 'rgba(255,255,255,1)');
    satGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = satGrad;
    ctx.fillRect(0, 0, w, h);
    const valGrad = ctx.createLinearGradient(0, 0, 0, h);
    valGrad.addColorStop(0, 'rgba(0,0,0,0)');
    valGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = valGrad;
    ctx.fillRect(0, 0, w, h);
    const x = state.s * w, y = (1 - state.v) * h;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = state.v > 0.6 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function render() {
    const hex = currentHex();
    swatchEl.style.setProperty('--swatch-color', hex);
    hueEl.value = String(Math.round(state.h));
    hexEl.value = hex;
    drawCanvas();
    return hex;
  }

  function setHex(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    state = rgbToHsv(rgb);
    render();
  }

  function pointerToSV(evt) {
    const rect = canvasEl.getBoundingClientRect();
    state.s = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
    state.v = 1 - Math.max(0, Math.min(1, (evt.clientY - rect.top) / rect.height));
    render();
  }

  let dragging = false;
  canvasEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvasEl.setPointerCapture(e.pointerId);
    pointerToSV(e);
  });
  canvasEl.addEventListener('pointermove', (e) => { if (dragging) pointerToSV(e); });
  canvasEl.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    onCommit(currentHex());
  });

  hueEl.addEventListener('input', () => {
    state.h = Number(hueEl.value);
    render();
  });
  hueEl.addEventListener('change', () => onCommit(currentHex()));

  hexEl.addEventListener('change', () => {
    let v = hexEl.value.trim();
    if (v && v[0] !== '#') v = '#' + v;
    if (!HEX_RE.test(v)) { hexEl.value = currentHex(); return; }
    setHex(v);
    onCommit(currentHex());
  });

  swatchEl.addEventListener('click', () => panelEl.classList.toggle('hidden'));

  resetBtn.addEventListener('click', () => {
    setHex(defaultHex);
    onCommit(null);
  });

  render();
  return { setHex };
}

const chatStyleStatusEl = document.getElementById('chatStyleStatus');

const assistantColorPicker = makeColorPicker({
  swatchEl: document.getElementById('swatchAssistant'),
  panelEl: document.getElementById('pickerAssistant'),
  canvasEl: document.getElementById('svAssistant'),
  hueEl: document.getElementById('hueAssistant'),
  hexEl: document.getElementById('hexAssistant'),
  resetBtn: document.getElementById('resetAssistant'),
  defaultHex: '#3a3a3a',
  onCommit: async (hex) => {
    await patchSettings({ assistant_text_color: hex || null });
    applyTextColors();
    chatStyleStatusEl.textContent = hex ? '对方的文字颜色已保存' : '已恢复对方的默认文字颜色';
  },
});

const userColorPicker = makeColorPicker({
  swatchEl: document.getElementById('swatchUser'),
  panelEl: document.getElementById('pickerUser'),
  canvasEl: document.getElementById('svUser'),
  hueEl: document.getElementById('hueUser'),
  hexEl: document.getElementById('hexUser'),
  resetBtn: document.getElementById('resetUser'),
  defaultHex: '#1f4a73',
  onCommit: async (hex) => {
    await patchSettings({ user_text_color: hex || null });
    applyTextColors();
    chatStyleStatusEl.textContent = hex ? '我的文字颜色已保存' : '已恢复我的默认文字颜色';
  },
});

const fontZhSelectEl = document.getElementById('fontZhSelect');
const fontEnSelectEl = document.getElementById('fontEnSelect');

fontZhSelectEl.addEventListener('change', async () => {
  await patchSettings({ font_zh: fontZhSelectEl.value });
  applyTextColors();
  chatStyleStatusEl.textContent = '中文字体已保存';
});
fontEnSelectEl.addEventListener('change', async () => {
  await patchSettings({ font_en: fontEnSelectEl.value });
  applyTextColors();
  chatStyleStatusEl.textContent = '英文字体已保存';
});

// Single source of truth for the four customizable values, called after
// settings load and whenever the custom chat background's measured
// brightness changes (see updateChatBgState). A saved custom color always
// wins; failing that, a dark/light custom background still gets to flip
// the user-bubble text for contrast the way it always has; failing that,
// clearing the property lets the plain day/night theme default apply.
function applyTextColors() {
  const root = document.documentElement;
  const userColor = currentSettings.user_text_color;
  if (userColor) {
    root.style.setProperty('--user-text-color', userColor);
  } else if (document.body.classList.contains('chat-bg-dark')) {
    root.style.setProperty('--user-text-color', '#bcdcff');
  } else if (document.body.classList.contains('chat-bg-light')) {
    root.style.setProperty('--user-text-color', '#1f4a73');
  } else {
    root.style.removeProperty('--user-text-color');
  }

  const assistantColor = currentSettings.assistant_text_color;
  if (assistantColor) root.style.setProperty('--assistant-text-color', assistantColor);
  else root.style.removeProperty('--assistant-text-color');

  const fontStack = [currentSettings.font_en, currentSettings.font_zh].filter(Boolean).join(', ');
  if (fontStack) root.style.setProperty('--chat-font-family', fontStack);
  else root.style.removeProperty('--chat-font-family');

  const assistantBubble = currentSettings.assistant_bubble_color;
  if (assistantBubble) root.style.setProperty('--assistant-bubble-bg', assistantBubble);
  else root.style.removeProperty('--assistant-bubble-bg');

  const userBubble = currentSettings.user_bubble_color;
  if (userBubble) root.style.setProperty('--user-bubble-bg', userBubble);
  else root.style.removeProperty('--user-bubble-bg');
}

// ---- 配色推荐 (palette presets) ----
// 手动拾色器只挑文字颜色,容易挑出一个和磨砂玻璃气泡/背景图打架的颜色(比如
// 一个孤立的棕色字)。这里每个预设把气泡底色和文字颜色一起定好、同一色系
// 搭配,点一下就四个值全套应用,不用自己试。浅色系配浅色/白天背景,深色系配
// 深色/夜间背景或深色自定义背景图。
//
// 参考真实聊天软件的做法(iMessage/HarmonyOS 通知中心等):"对方"的气泡永远
// 是一个高级、克制的中性灰白/深空灰,只有"我"发的气泡才换成一个鲜明的品牌
// 强调色——所以这里每个系列(浅色系/深色系)共用同一套中性对方气泡,只有
// userBubble/userText 随预设变化。强调色取自 iOS 系统色(systemBlue /
// systemGreen / systemPink / systemOrange,深色系则用其 Dark Mode 变体)和
// HarmonyOS 的"宇宙蓝",并针对气泡实际做了加深/调整,确保白字在上面读得清楚
// (之前那版所有色块都是同色系浅粉浅棕的低饱和玻璃色,配文字容易显得"糊"、
// 不够精神,这版每个强调色都用实际系统色校过对比度)。
const ASSISTANT_NEUTRAL_LIGHT = { bubble: 'rgba(242,242,247,0.55)', text: '#1c1c1e' };
const ASSISTANT_NEUTRAL_DARK = { bubble: 'rgba(28,28,30,0.55)', text: '#e5e5ea' };

const COLOR_PALETTES = [
  { id: 'ios-milk-blue', name: '云感牛奶', series: 'light',
    assistantText: ASSISTANT_NEUTRAL_LIGHT.text, userText: '#ffffff',
    assistantBubble: ASSISTANT_NEUTRAL_LIGHT.bubble, userBubble: 'rgba(10,110,220,0.88)' },
  { id: 'mint-soda', name: '薄荷苏打', series: 'light',
    assistantText: ASSISTANT_NEUTRAL_LIGHT.text, userText: '#ffffff',
    assistantBubble: ASSISTANT_NEUTRAL_LIGHT.bubble, userBubble: 'rgba(15,140,80,0.9)' },
  { id: 'berry-fizz', name: '莓果气泡', series: 'light',
    assistantText: ASSISTANT_NEUTRAL_LIGHT.text, userText: '#ffffff',
    assistantBubble: ASSISTANT_NEUTRAL_LIGHT.bubble, userBubble: 'rgba(214,40,95,0.85)' },
  { id: 'caramel-macchiato', name: '焦糖玛奇朵', series: 'light',
    assistantText: ASSISTANT_NEUTRAL_LIGHT.text, userText: '#ffffff',
    assistantBubble: ASSISTANT_NEUTRAL_LIGHT.bubble, userBubble: 'rgba(170,85,15,0.92)' },
  { id: 'harmony-night-blue', name: '鸿蒙夜蓝', series: 'dark',
    assistantText: ASSISTANT_NEUTRAL_DARK.text, userText: '#ffffff',
    assistantBubble: ASSISTANT_NEUTRAL_DARK.bubble, userBubble: 'rgba(10,89,247,0.68)' },
  { id: 'deep-space-violet', name: '深空紫罗兰', series: 'dark',
    assistantText: ASSISTANT_NEUTRAL_DARK.text, userText: '#ffffff',
    assistantBubble: ASSISTANT_NEUTRAL_DARK.bubble, userBubble: 'rgba(94,92,230,0.68)' },
  { id: 'aurora-frost', name: '极光青霜', series: 'dark',
    assistantText: ASSISTANT_NEUTRAL_DARK.text, userText: '#05303d',
    assistantBubble: ASSISTANT_NEUTRAL_DARK.bubble, userBubble: 'rgba(100,210,255,0.68)' },
  { id: 'dusk-rose', name: '暮色玫瑰', series: 'dark',
    assistantText: ASSISTANT_NEUTRAL_DARK.text, userText: '#ffffff',
    assistantBubble: ASSISTANT_NEUTRAL_DARK.bubble, userBubble: 'rgba(255,55,95,0.68)' },
];

function updatePaletteActiveState(activeId) {
  document.querySelectorAll('.palette-swatch').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.paletteId === activeId);
  });
}

async function applyPalette(p) {
  await patchSettings({
    assistant_text_color: p.assistantText,
    user_text_color: p.userText,
    assistant_bubble_color: p.assistantBubble,
    user_bubble_color: p.userBubble,
  });
  assistantColorPicker.setHex(p.assistantText);
  userColorPicker.setHex(p.userText);
  applyTextColors();
  updatePaletteActiveState(p.id);
  chatStyleStatusEl.textContent = `已应用配色:${p.name}`;
}

function renderPaletteRows() {
  const rows = { light: document.getElementById('paletteRowLight'), dark: document.getElementById('paletteRowDark') };
  for (const p of COLOR_PALETTES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'palette-swatch';
    btn.dataset.paletteId = p.id;
    const preview = document.createElement('span');
    preview.className = 'palette-swatch-preview';
    preview.style.setProperty('--pv-assistant', p.assistantBubble);
    preview.style.setProperty('--pv-user', p.userBubble);
    const label = document.createElement('span');
    label.className = 'palette-swatch-name';
    label.textContent = p.name;
    btn.appendChild(preview);
    btn.appendChild(label);
    btn.addEventListener('click', () => applyPalette(p));
    rows[p.series].appendChild(btn);
  }
}
renderPaletteRows();

document.getElementById('paletteResetAll').addEventListener('click', async () => {
  await patchSettings({
    assistant_text_color: null,
    user_text_color: null,
    assistant_bubble_color: null,
    user_bubble_color: null,
  });
  assistantColorPicker.setHex('#3a3a3a');
  userColorPicker.setHex('#1f4a73');
  applyTextColors();
  updatePaletteActiveState(null);
  chatStyleStatusEl.textContent = '已恢复默认配色';
});

// ---- Model / API overrides ----

apiBaseUrlEl.addEventListener('change', async () => {
  await patchSettings({ api_base_url: apiBaseUrlEl.value });
  modelStatusEl.textContent = '接口地址已保存';
});
apiKeyInputEl.addEventListener('change', async () => {
  await patchSettings({ api_key: apiKeyInputEl.value });
  modelStatusEl.textContent = 'API Key 已保存';
});
modelInputEl.addEventListener('change', async () => {
  await patchSettings({ model: modelInputEl.value });
  modelStatusEl.textContent = modelInputEl.value ? `模型已切换为 ${modelInputEl.value}` : '已恢复服务器默认模型';
});

fetchModelsBtn.addEventListener('click', async () => {
  fetchModelsBtn.disabled = true;
  modelStatusEl.textContent = '正在拉取模型列表...';
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '拉取失败');
    modelSelectEl.innerHTML = '<option value="">— 选一个模型 —</option>';
    data.models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      if (m === data.current) opt.selected = true;
      modelSelectEl.appendChild(opt);
    });
    modelSelectEl.classList.remove('hidden');
    modelStatusEl.textContent = `拿到 ${data.models.length} 个模型,从下面选一个`;
  } catch (err) {
    modelStatusEl.textContent = err.message;
  } finally {
    fetchModelsBtn.disabled = false;
  }
});

modelSelectEl.addEventListener('change', async () => {
  if (!modelSelectEl.value) return;
  modelInputEl.value = modelSelectEl.value;
  await patchSettings({ model: modelSelectEl.value });
  modelStatusEl.textContent = `模型已切换为 ${modelSelectEl.value}`;
});
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

// ---- 特殊要求 (separate from the System Prompt doc-import above — an
// itemized list; each entry is her own note plus, optionally, an
// attached image/file read into text. No attachment required — a bare
// note is a complete entry on its own.) ----

const specialReqNoteEl = document.getElementById('specialReqNote');
const specialReqFileEl = document.getElementById('specialReqFile');
const specialReqAddBtnEl = document.getElementById('specialReqAddBtn');
const specialReqStatusEl = document.getElementById('specialReqStatus');
const specialReqListEl = document.getElementById('specialReqList');

function renderSpecialRequirement(item) {
  const div = document.createElement('div');
  div.className = 'special-req-item';

  if (item.file_url) {
    const img = document.createElement('img');
    img.className = 'special-req-thumb';
    img.src = item.file_url;
    img.alt = item.file_name || '';
    div.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'special-req-body';
  if (item.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'special-req-note';
    noteEl.textContent = item.note;
    body.appendChild(noteEl);
  }
  if (item.file_name) {
    const fileEl = document.createElement('div');
    fileEl.className = 'special-req-filename';
    fileEl.textContent = '📎 ' + item.file_name;
    body.appendChild(fileEl);
  }
  div.appendChild(body);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'special-req-del';
  del.textContent = '✕';
  del.addEventListener('click', async () => {
    if (!confirm('删掉这条特殊要求?')) return;
    try {
      await fetch('/api/special-requirements/' + item.id, { method: 'DELETE' });
      div.remove();
    } catch (err) {
      specialReqStatusEl.textContent = '删除失败: ' + err.message;
    }
  });
  div.appendChild(del);

  return div;
}

async function loadSpecialRequirements() {
  try {
    const res = await fetch('/api/special-requirements');
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || '加载失败');
    specialReqListEl.innerHTML = '';
    items.forEach((item) => specialReqListEl.appendChild(renderSpecialRequirement(item)));
  } catch (err) {
    specialReqStatusEl.textContent = '加载失败: ' + err.message;
  }
}
loadSpecialRequirements();

async function postSpecialRequirement(note, file, filename) {
  const form = new FormData();
  form.append('note', note);
  if (file) form.append('file', file, filename || file.name || 'file');
  const res = await fetch('/api/special-requirements', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '保存失败');
  specialReqListEl.appendChild(renderSpecialRequirement(data));
}

specialReqAddBtnEl.addEventListener('click', async () => {
  const note = specialReqNoteEl.value.trim();
  const files = Array.from(specialReqFileEl.files || []);
  if (!note && !files.length) { specialReqStatusEl.textContent = '写点说明,或者传个文件/图片'; return; }
  specialReqAddBtnEl.disabled = true;
  try {
    if (!files.length) {
      specialReqStatusEl.textContent = '保存中...';
      await postSpecialRequirement(note, null);
      specialReqStatusEl.textContent = '已添加';
    } else {
      // 一次选了好几个文件/图片:每个文件单独生成一条(都带上同一段说明
      // 文字),一个一个处理而不是同时并发。全尺寸 iPhone 照片不经压缩地
      // 连着传几张,之前已经在聊天发图那里把 Render 免费实例的内存冲崩过
      // 一次——这里复用同一个 compressImageForUpload,先在浏览器这边把
      // 图片缩小了再传,而不是让服务器一遍遍处理好几张原图。单个文件失败
      // 不影响其他文件继续处理。
      let okCount = 0;
      let failCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        specialReqStatusEl.textContent = `正在处理 ${file.name}(${i + 1}/${files.length})...`;
        try {
          const isImage = file.type && file.type.startsWith('image/');
          const toUpload = isImage ? await compressImageForUpload(file) : file;
          await postSpecialRequirement(note, toUpload, file.name);
          okCount++;
        } catch (err) {
          failCount++;
          console.error(file.name, err);
        }
      }
      specialReqStatusEl.textContent = failCount
        ? `已添加 ${okCount} 条,失败 ${failCount} 条`
        : `已添加 ${okCount} 条`;
    }
    specialReqNoteEl.value = '';
    specialReqFileEl.value = '';
  } catch (err) {
    specialReqStatusEl.textContent = '失败: ' + err.message;
  } finally {
    specialReqAddBtnEl.disabled = false;
  }
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
  const numberSessionsEl = document.getElementById('numberSessions');
  if (numberSessionsEl) numberSessionsEl.textContent = sessions.length;

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
  lastBubbleTimeMs = null;
  statusText.textContent = '加载记录中...';
  try {
    const res = await fetch(`/api/sessions/${id}/messages`);
    const msgs = await res.json();
    if (!res.ok) throw new Error(msgs.error || `HTTP ${res.status}`);
    msgs.forEach((m) => {
      const imageUrls = m.image_urls || (m.image_url ? [m.image_url] : []);
      const replyTo = m.reply_to_text ? { text: m.reply_to_text, role: m.reply_to_role } : null;
      const bubble = appendBubble(m.role, m.content, imageUrls, m.id, m.created_at, replyTo);
      if (m.role === 'assistant') attachAudioLazy(bubble, m.content);
      if (m.is_voice && m.audio_url) attachVoiceBar(bubble, m.audio_url);
    });
    statusText.textContent = '';
  } catch (err) {
    statusText.textContent = '加载记录失败: ' + err.message;
  }
}

// ---- Chat bubbles ----

// The model writes in a screenplay-ish style — every action beat and line
// of dialogue gets its own paragraph, separated by a blank line — which
// read as too many short, choppy line-fragments. Flattened to one solid
// block first, but that read as airless for longer replies. Middle
// ground: flatten, then re-break into paragraphs by grouping sentences —
// every ~2-3 sentences (or once a paragraph gets long enough) gets a
// blank line, roughly approximating a natural speaking pause, without
// going back to "one line per beat." Display only — doesn't touch
// what's stored/edited/sent to TTS.
function formatForDisplay(text) {
  const flat = text.replace(/\s*\n+\s*/g, ' ').trim();
  const sentences = flat.match(/[^。!?!?…]+[。!?!?…]*/g) || [flat];

  const paragraphs = [];
  let buf = '';
  let sentenceCount = 0;
  sentences.forEach((s) => {
    buf += s;
    sentenceCount += 1;
    if (sentenceCount >= 3 || buf.length >= 40) {
      paragraphs.push(buf.trim());
      buf = '';
      sentenceCount = 0;
    }
  });
  if (buf.trim()) paragraphs.push(buf.trim());

  return paragraphs.join('\n\n');
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

// WeChat/iMessage don't stamp every bubble with a time — they drop a
// small centered divider into the stream only when enough silence has
// passed since the last message, since a timestamp on every single
// bubble is mostly redundant noise once messages are seconds apart.
// Reset lastBubbleTimeMs to null (see selectSession) whenever the
// transcript itself gets cleared, so switching sessions always shows a
// fresh divider for the first message instead of comparing against
// whatever the previous session's last message time happened to be.
let lastBubbleTimeMs = null;
const TIME_DIVIDER_GAP_MS = 5 * 60 * 1000;

function formatTimeDivider(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return timeStr;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `昨天 ${timeStr}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${timeStr}`;
}

function maybeInsertTimeDivider(createdAt) {
  const t = createdAt ? new Date(createdAt).getTime() : Date.now();
  if (Number.isNaN(t)) return;
  if (lastBubbleTimeMs === null || Math.abs(t - lastBubbleTimeMs) > TIME_DIVIDER_GAP_MS) {
    const divider = document.createElement('div');
    divider.className = 'time-divider';
    divider.textContent = formatTimeDivider(createdAt);
    transcriptEl.appendChild(divider);
  }
  lastBubbleTimeMs = t;
}

function appendBubble(role, text, imageUrls, id, createdAt, replyTo) {
  maybeInsertTimeDivider(createdAt);

  const div = document.createElement('div');
  div.className = 'bubble ' + role;

  if (replyTo && replyTo.text) {
    const quote = document.createElement('div');
    quote.className = 'bubble-quote';
    const who = document.createElement('span');
    who.className = 'bubble-quote-who';
    who.textContent = replyTo.role === 'assistant' ? '回复 他' : '回复 我';
    const snippet = document.createElement('span');
    snippet.className = 'bubble-quote-text';
    snippet.textContent = replyTo.text;
    quote.appendChild(who);
    quote.appendChild(snippet);
    div.appendChild(quote);
  }

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

    // Below the text, not beside it — inline in the flex row it reserved
    // a full-height column on the right, forcing every line of text to
    // wrap ~80px early (the "his lines never reach the edge" complaint).
    div.appendChild(audioControls);
  }

  const bubble = { el: div, textEl, playBtn, speedBtn, id, role, replyTo: replyTo || null };

  // Icon-only quick-actions (like ChatGPT/iOS's own per-message toolbar)
  // instead of the old text-label chips — regenerate/edit stay
  // role-specific exactly as before, copy applies to both, and "more"
  // opens a dropdown with the same actions as text plus 引用 (which has
  // no dedicated icon of its own).
  const actions = document.createElement('div');
  actions.className = 'bubble-actions';

  let editBtn = null;
  if (role === 'assistant') {
    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.className = 'bubble-action-btn';
    regenBtn.title = '重新回答';
    regenBtn.innerHTML = ICON_REDO;
    regenBtn.addEventListener('click', () => regenerateAssistantBubble(bubble));
    actions.appendChild(regenBtn);
  } else {
    editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'bubble-action-btn';
    editBtn.title = '编辑';
    editBtn.innerHTML = ICON_EDIT;
    editBtn.addEventListener('click', () => startEditBubble(bubble));
    actions.appendChild(editBtn);
  }
  bubble.editBtn = editBtn;

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'bubble-action-btn';
  copyBtn.title = '复制';
  copyBtn.innerHTML = ICON_COPY;
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(bubble.textEl.textContent);
      copyBtn.innerHTML = ICON_CHECK;
      setTimeout(() => { copyBtn.innerHTML = ICON_COPY; }, 1500);
    } catch {
      statusText.textContent = '复制失败,长按文字手动复制吧';
    }
  });
  actions.appendChild(copyBtn);

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'bubble-action-btn';
  moreBtn.title = '更多';
  moreBtn.innerHTML = ICON_MORE;
  moreBtn.addEventListener('click', () => openBubbleMenu(bubble, moreBtn));
  actions.appendChild(moreBtn);

  div.appendChild(actions);

  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return bubble;
}

// ---- Bubble "more" menu (iOS-style dropdown) ----
// Appended to <body> (not inside the bubble/transcript) so it isn't
// clipped by the transcript's own overflow:auto scrolling, and
// fixed-positioned against the tapped "..." button's own screen
// position, flipping upward near the bottom of the viewport so it never
// renders off-screen under the composer.

let openMenuEl = null;
let openMenuCleanup = null;

function closeBubbleMenu() {
  if (openMenuEl) openMenuEl.remove();
  openMenuEl = null;
  if (openMenuCleanup) { openMenuCleanup(); openMenuCleanup = null; }
}

function openBubbleMenu(bubble, anchorBtn) {
  if (openMenuEl) { closeBubbleMenu(); return; }

  const items = [];
  if (bubble.role === 'assistant') {
    items.push({ label: '重新回答', onClick: () => regenerateAssistantBubble(bubble) });
  } else {
    items.push({ label: '编辑', onClick: () => startEditBubble(bubble) });
  }
  items.push({
    label: '复制',
    onClick: async () => {
      try { await navigator.clipboard.writeText(bubble.textEl.textContent); }
      catch { statusText.textContent = '复制失败,长按文字手动复制吧'; }
    },
  });
  items.push({ label: '引用', onClick: () => setPendingReplyTo(bubble) });

  const menu = document.createElement('div');
  menu.className = 'bubble-more-menu';
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.label;
    btn.addEventListener('click', () => { closeBubbleMenu(); item.onClick(); });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  openMenuEl = menu;

  const rect = anchorBtn.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow >= menuRect.height + 12 ? rect.bottom + 6 : rect.top - menuRect.height - 6;
  let left = rect.right - menuRect.width;
  left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
  menu.style.position = 'fixed';
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${left}px`;

  // Swallow the click that opened it (it's already bubbled to document by
  // the time this runs) so the outside-click listener below doesn't fire
  // on its own opening tap and close the menu instantly.
  const onOutside = (e) => { if (!menu.contains(e.target)) closeBubbleMenu(); };
  const onScroll = () => closeBubbleMenu();
  setTimeout(() => {
    document.addEventListener('click', onOutside, { capture: true });
    transcriptEl.addEventListener('scroll', onScroll, { passive: true });
  }, 0);
  openMenuCleanup = () => {
    document.removeEventListener('click', onOutside, { capture: true });
    transcriptEl.removeEventListener('scroll', onScroll);
  };
}

// ---- 引用/reply-to (WeChat-style quote reply) ----
// Picking "引用" from a bubble's menu snapshots that bubble's text (not a
// live reference — the quoted message could later be edited or deleted,
// and the snippet should keep showing what it showed at the time) and
// shows a preview strip above the composer; the next message sent
// (text or voice) carries it along, cleared after that one send.

const replyToStripEl = document.getElementById('replyToStrip');
const replyToWhoEl = document.getElementById('replyToWho');
const replyToTextEl = document.getElementById('replyToText');
const replyToCancelEl = document.getElementById('replyToCancel');
let pendingReplyTo = null;

function setPendingReplyTo(bubble) {
  const text = bubble.textEl.textContent.trim();
  if (!text) return;
  pendingReplyTo = { text: text.slice(0, 150), role: bubble.role };
  replyToWhoEl.textContent = bubble.role === 'assistant' ? '回复 他' : '回复 我自己';
  replyToTextEl.textContent = pendingReplyTo.text;
  replyToStripEl.classList.remove('hidden');
  textInput.focus();
}

function clearPendingReplyTo() {
  pendingReplyTo = null;
  replyToStripEl.classList.add('hidden');
}

replyToCancelEl.addEventListener('click', clearPendingReplyTo);

// ---- WeChat-style voice bubbles ----

let currentVoiceBar = null;

function resetVoiceBar(bar) {
  if (bar) bar.classList.remove('playing');
}

ttsPlayer.addEventListener('ended', () => {
  resetVoiceBar(currentVoiceBar);
  currentVoiceBar = null;
});

function attachVoiceBar(bubble, url) {
  if (!url || bubble.voiceBar) return;
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.className = 'voice-bar';
  bar.innerHTML = `<span class="voice-bar-icon">${ICON_PLAY}</span><span class="voice-wave"><i></i><i></i><i></i></span><span class="voice-dur"></span>`;
  const durEl = bar.querySelector('.voice-dur');
  // Read the real duration off the clip's metadata rather than storing it.
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.src = url;
  probe.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(probe.duration)) durEl.textContent = Math.max(1, Math.round(probe.duration)) + '″';
  });
  bar.addEventListener('click', () => {
    unlockAudioPlayback();
    if (currentVoiceBar === bar && !ttsPlayer.paused) {
      ttsPlayer.pause();
      resetVoiceBar(bar);
      currentVoiceBar = null;
      return;
    }
    resetVoiceBar(currentVoiceBar);
    ttsPlayer.pause();
    ttsPlayer.src = url;
    ttsPlayer.playbackRate = 1;
    ttsPlayer.play().catch(() => {});
    bar.classList.add('playing');
    currentVoiceBar = bar;
  });
  // The bar goes above the transcript text; the transcript stays visible
  // but styled secondary (unlike WeChat's hidden-until-long-press).
  const row = bubble.el.querySelector('.bubble-row');
  bubble.el.insertBefore(bar, row);
  bubble.textEl.classList.add('voice-transcript');
  // The lazy-TTS ▶/speed controls would synthesize a second voice for a
  // bubble that already ships with audio — hide them on voice bubbles.
  const controls = bubble.el.querySelector('.audio-controls');
  if (controls) controls.classList.add('hidden');
  bubble.voiceBar = bar;
}

// Inline confirm card for a milestone he proposed ([记:...] marker) —
// nothing is saved permanently until she taps 记下来 here.
function showMilestoneConfirm(pending) {
  const card = document.createElement('div');
  card.className = 'milestone-confirm';
  const label = document.createElement('div');
  label.className = 'milestone-confirm-text';
  label.textContent = '他想把这件事记进纪念册:「' + pending.content + '」';
  const row = document.createElement('div');
  row.className = 'milestone-confirm-actions';
  const yesBtn = document.createElement('button');
  yesBtn.className = 'mini-btn';
  yesBtn.textContent = '记下来';
  const noBtn = document.createElement('button');
  noBtn.className = 'mini-btn milestone-no';
  noBtn.textContent = '算了';
  yesBtn.addEventListener('click', async () => {
    yesBtn.disabled = true; noBtn.disabled = true;
    try {
      const res = await fetch('/api/milestones/' + pending.id, { method: 'PATCH' });
      if (!res.ok) throw new Error('保存失败');
      label.textContent = '✓ 已记进纪念册:「' + pending.content + '」';
      row.remove();
    } catch (err) {
      yesBtn.disabled = false; noBtn.disabled = false;
      statusText.textContent = '记入纪念册失败: ' + err.message;
    }
  });
  noBtn.addEventListener('click', async () => {
    yesBtn.disabled = true; noBtn.disabled = true;
    try { await fetch('/api/milestones/' + pending.id, { method: 'DELETE' }); } catch {}
    card.remove();
  });
  row.appendChild(yesBtn);
  row.appendChild(noBtn);
  card.appendChild(label);
  card.appendChild(row);
  transcriptEl.appendChild(card);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// She asked to drop the ask-first step entirely for anything he scores
// high enough (see the [记:分数|内容] marker, server-side) — it's already
// saved as 'confirmed' by the time this card shows up, so this is just a
// heads-up with an undo, not a confirmation. Same visual family as the
// card above (milestone-confirm), styled slightly differently (see CSS)
// so the two read as distinct even though the actions row is now just one
// button instead of two.
function showMilestoneRecorded(recorded) {
  const card = document.createElement('div');
  card.className = 'milestone-confirm milestone-recorded';
  const label = document.createElement('div');
  label.className = 'milestone-confirm-text';
  label.textContent = '📌 已经记进纪念册:「' + recorded.content + '」';
  const row = document.createElement('div');
  row.className = 'milestone-confirm-actions';
  const delBtn = document.createElement('button');
  delBtn.className = 'mini-btn milestone-no';
  delBtn.textContent = '删除';
  delBtn.addEventListener('click', async () => {
    delBtn.disabled = true;
    try {
      await fetch('/api/milestones/' + recorded.id, { method: 'DELETE' });
      label.textContent = '已删除:「' + recorded.content + '」';
      row.remove();
    } catch (err) {
      delBtn.disabled = false;
      statusText.textContent = '删除失败: ' + err.message;
    }
  });
  row.appendChild(delBtn);
  card.appendChild(label);
  card.appendChild(row);
  transcriptEl.appendChild(card);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function attachImageToBubble(bubble, url) {
  if (!url) return;
  const grid = document.createElement('div');
  grid.className = 'bubble-img-grid';
  const img = document.createElement('img');
  img.className = 'bubble-img';
  img.src = url;
  img.alt = '图片';
  grid.appendChild(img);
  // After the timestamp (first child), before the text row.
  bubble.el.insertBefore(grid, bubble.el.children[1] || null);
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
      // Everything after this message was just deleted server-side (see
      // PATCH /api/messages/:id) — drop the matching bubbles from the UI
      // too and get a fresh reply for the edited message.
      removeBubblesAfter(bubble.el);
      regenerateReplyAfterEdit(bubble.id);
    } catch (err) {
      statusText.textContent = '编辑失败: ' + err.message;
      saveBtn.disabled = false;
    }
  });
}

function removeBubblesAfter(afterEl) {
  let node = afterEl.nextElementSibling;
  while (node) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }
}

// "重新回答": only the newest reply can be redone — anything older has
// later conversation built on top of it, and regenerating it would fork
// history. Deletes the row server-side, then reuses the same
// regenerate flow the edit feature uses.
async function regenerateAssistantBubble(bubble) {
  if (bubble.el !== transcriptEl.lastElementChild) {
    statusText.textContent = '只能重新生成最后一条回复';
    return;
  }
  if (!bubble.id) { statusText.textContent = '这条还没保存好,等一下再试'; return; }
  try {
    const res = await fetch(`/api/messages/${bubble.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || '删除失败');
    }
  } catch (err) {
    statusText.textContent = '重新回答失败: ' + err.message;
    return;
  }
  bubble.el.remove();
  regenerateReplyAfterEdit('regen');
}

async function regenerateReplyAfterEdit(messageId) {
  setBusy(true);
  statusText.textContent = randomLoadingLine();
  const assistantBubble = appendBubble('assistant', '');
  let fullText = '';
  let gotImage = false;
  let imageNote = null;
  try {
    const form = new FormData();
    form.append('sessionId', currentSessionId);
    form.append('regenerateMessageId', messageId);

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
        if (payload.text) {
          fullText += payload.text;
          renderBubbleText(assistantBubble.textEl, formatForDisplay(fullText));
          transcriptEl.scrollTop = transcriptEl.scrollHeight;
        }
        if (payload.imageUrl) { attachImageToBubble(assistantBubble, payload.imageUrl); gotImage = true; }
        if (payload.imageNote) imageNote = payload.imageNote;
        if (payload.milestonePending) showMilestoneConfirm(payload.milestonePending);
        if (payload.milestoneRecorded) showMilestoneRecorded(payload.milestoneRecorded);
        if (payload.assistantMessageId) assistantBubble.id = payload.assistantMessageId;
        handleFollowUpPayload(payload);
      }
    }

    if (fullText) {
      attachAudioLazy(assistantBubble, fullText);
      statusText.textContent = imageNote || '';
      const s = sessions.find((x) => x.id === currentSessionId);
      if (s) {
        s.updated_at = new Date().toISOString();
        sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        renderSessionsList();
      }
    } else if (!gotImage) {
      assistantBubble.textEl.textContent = '(没有收到回复——服务器可能刚被唤醒或正在重启,点"重新回答"再试一次)';
      statusText.textContent = '';
    } else {
      statusText.textContent = '';
    }
  } catch (err) {
    assistantBubble.el.remove();
    statusText.textContent = '重新生成回复失败: ' + err.message;
  } finally {
    setBusy(false);
  }
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
    // Synthesis takes seconds — without a visible state change the tap
    // reads as ignored ("点了跟没点一样"). Spinner until audio starts.
    bubble.playBtn.classList.add('loading');
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
      bubble.playBtn.classList.remove('loading');
      bubble.playBtn.disabled = false;
    }
  };
}

// "活人感" spontaneous follow-up — occasionally, after a normal reply, the
// server decides his mood right now (visibly excited or visibly down) is
// the kind that makes a real person text again a moment later without
// waiting to be prompted. Arrives as its own SSE event, separate from the
// main reply's streamed text, some seconds after the main reply (the
// server adds a deliberate pause) — rendered as a brand new bubble, not
// appended into the one already on screen.
function handleFollowUpPayload(payload) {
  if (!payload.followUp) return;
  const f = payload.followUp;
  const bubble = appendBubble('assistant', f.text || '', f.imageUrl ? [f.imageUrl] : [], f.id, new Date().toISOString());
  if (f.text) attachAudioLazy(bubble, f.text);
}

async function sendMessage(rawText) {
  const text = (rawText || '').trim();
  const imageFiles = selectedImageFiles;
  if ((!text && !imageFiles.length) || !currentSessionId) return;

  // Snapshot how many bubbles exist before this turn's optimistic ones go
  // in, so a later reload can tell "this exact turn actually saved" apart
  // from "the session just already ended on an assistant reply from
  // before" — see the recovered check in tryAutoRecover below.
  const bubbleCountBeforeSend = transcriptEl.children.length;

  const localImageUrls = imageFiles.map((f) => URL.createObjectURL(f));
  const replyTo = pendingReplyTo;
  const userBubble = appendBubble('user', text, localImageUrls, null, null, replyTo);
  clearPendingReplyTo();
  textInput.value = '';
  clearImageSelection();
  setBusy(true);
  statusText.textContent = randomLoadingLine();

  const assistantBubble = appendBubble('assistant', '');
  let fullText = '';
  let gotImage = false;
  let imageNote = null;

  try {
    const form = new FormData();
    form.append('sessionId', currentSessionId);
    form.append('message', text);
    imageFiles.forEach((f) => form.append('images', f));
    if (replyTo) {
      form.append('replyToText', replyTo.text);
      form.append('replyToRole', replyTo.role);
    }

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
        if (payload.imageUrl) { attachImageToBubble(assistantBubble, payload.imageUrl); gotImage = true; }
        if (payload.imageNote) imageNote = payload.imageNote;
        if (payload.milestonePending) showMilestoneConfirm(payload.milestonePending);
        if (payload.milestoneRecorded) showMilestoneRecorded(payload.milestoneRecorded);
        if (payload.assistantMessageId) assistantBubble.id = payload.assistantMessageId;
        handleFollowUpPayload(payload);
      }
    }

    if (fullText) {
      attachAudioLazy(assistantBubble, fullText);
      statusText.textContent = imageNote || '';
      const s = sessions.find((x) => x.id === currentSessionId);
      if (s) {
        s.updated_at = new Date().toISOString();
        sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        renderSessionsList();
      }
    } else if (!gotImage) {
      assistantBubble.textEl.textContent = '(没有收到回复——服务器可能刚被唤醒或正在重启,点"重新回答"再试一次)';
      statusText.textContent = '';
    } else {
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
    const recovered = await tryAutoRecover(currentSessionId, [1500, 3000], bubbleCountBeforeSend);
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
//
// `countBeforeSend` guards against a false positive: if the request never
// even reached the point of saving her message (e.g. the upload itself got
// aborted before the server ever ran), selectSession's reload just shows
// the *previous* turn again, which usually already ended on an assistant
// reply — "last bubble is assistant" would then be true by coincidence,
// reporting a fake recovery and silently swallowing her message with no
// error shown at all. Requiring strictly more bubbles than existed before
// this send confirms something from *this* turn actually landed.
async function tryAutoRecover(sessionId, delays, countBeforeSend) {
  for (const delay of delays) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      await selectSession(sessionId);
    } catch {
      continue;
    }
    const last = transcriptEl.lastElementChild;
    const grew = countBeforeSend === undefined || transcriptEl.children.length > countBeforeSend;
    if (grew && last && last.classList.contains('assistant')) return true;
  }
  return false;
}

// Deliberately NO unlockAudioPlayback() here: playing even the silent
// unlock clip grabs the iOS audio session and pauses whatever music app
// is playing in the background — sending a text message must not do
// that. It was only ever needed when replies auto-played TTS; now that
// playback requires tapping ▶, that tap is its own gesture and unlocks
// synchronously inside the play-button handler. Calls still unlock at
// call start, which is the one place taking over audio is expected.
sendBtn.addEventListener('click', () => {
  sendMessage(textInput.value);
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendMessage(textInput.value);
  }
});

// ---- Hold-to-talk voice messages ----

const voiceBtn = document.getElementById('voiceBtn');
let vmStream = null;
let vmRecorder = null;
let vmChunks = [];
let vmStartAt = 0;
let vmTimer = null;
let vmActive = false;

const VM_MIN_MS = 600;      // shorter than this = accidental tap, discard
const VM_MAX_MS = 60000;    // hard cap like WeChat

async function startVoiceRecord() {
  if (vmActive || !currentSessionId) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    statusText.textContent = '这个浏览器不支持录音';
    return;
  }
  try {
    vmStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    statusText.textContent = '需要麦克风权限才能发语音';
    return;
  }
  vmActive = true;
  vmChunks = [];
  const mime = callMimeType();
  vmRecorder = mime ? new MediaRecorder(vmStream, { mimeType: mime }) : new MediaRecorder(vmStream);
  vmRecorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) vmChunks.push(e.data); });
  vmRecorder.start();
  vmStartAt = Date.now();
  voiceBtn.classList.add('recording');
  vmTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - vmStartAt) / 1000);
    statusText.textContent = `🎤 正在录音 ${sec}s · 松开发送`;
    if (Date.now() - vmStartAt >= VM_MAX_MS) stopVoiceRecord(true);
  }, 250);
  statusText.textContent = '🎤 正在录音 · 松开发送';
}

function stopVoiceRecord(send) {
  if (!vmActive) return;
  vmActive = false;
  clearInterval(vmTimer);
  voiceBtn.classList.remove('recording');
  const durMs = Date.now() - vmStartAt;
  const recorder = vmRecorder;
  const stream = vmStream;
  vmRecorder = null;
  vmStream = null;
  if (!recorder || recorder.state !== 'recording') {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    statusText.textContent = '';
    return;
  }
  recorder.addEventListener('stop', () => {
    stream.getTracks().forEach((t) => t.stop());
    if (!send || durMs < VM_MIN_MS) {
      statusText.textContent = durMs < VM_MIN_MS ? '说话时间太短了' : '';
      return;
    }
    const mime = recorder.mimeType || 'audio/mp4';
    const blob = new Blob(vmChunks, { type: mime });
    sendVoiceMessage(blob, mime);
  });
  recorder.stop();
}

voiceBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  voiceBtn.setPointerCapture(e.pointerId);
  startVoiceRecord();
});
voiceBtn.addEventListener('pointerup', () => stopVoiceRecord(true));
voiceBtn.addEventListener('pointercancel', () => stopVoiceRecord(false));
// Keep long-press from popping the iOS context menu instead of recording.
voiceBtn.addEventListener('contextmenu', (e) => e.preventDefault());

async function sendVoiceMessage(blob, mime) {
  if (!currentSessionId) return;
  setBusy(true);
  statusText.textContent = '发送中...';
  const replyTo = pendingReplyTo;
  const userBubble = appendBubble('user', '(语音识别中...)', null, null, null, replyTo);
  clearPendingReplyTo();
  const assistantBubble = appendBubble('assistant', '');
  let fullText = '';
  let gotImage = false;
  let imageNote = null;
  try {
    const form = new FormData();
    form.append('sessionId', currentSessionId);
    form.append('voice', blob, mime.includes('webm') ? 'voice.webm' : 'voice.m4a');
    if (replyTo) {
      form.append('replyToText', replyTo.text);
      form.append('replyToRole', replyTo.role);
    }

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
          if (payload.userText) renderBubbleText(userBubble.textEl, payload.userText);
          if (payload.userVoiceUrl) attachVoiceBar(userBubble, payload.userVoiceUrl);
        }
        if (payload.text) {
          fullText += payload.text;
          renderBubbleText(assistantBubble.textEl, formatForDisplay(fullText));
          transcriptEl.scrollTop = transcriptEl.scrollHeight;
        }
        if (payload.imageUrl) { attachImageToBubble(assistantBubble, payload.imageUrl); gotImage = true; }
        if (payload.voiceUrl) attachVoiceBar(assistantBubble, payload.voiceUrl);
        if (payload.imageNote) imageNote = payload.imageNote;
        if (payload.milestonePending) showMilestoneConfirm(payload.milestonePending);
        if (payload.milestoneRecorded) showMilestoneRecorded(payload.milestoneRecorded);
        if (payload.assistantMessageId) assistantBubble.id = payload.assistantMessageId;
        handleFollowUpPayload(payload);
      }
    }

    if (fullText) {
      if (!assistantBubble.voiceBar) attachAudioLazy(assistantBubble, fullText);
      statusText.textContent = imageNote || '';
      const s = sessions.find((x) => x.id === currentSessionId);
      if (s) {
        s.updated_at = new Date().toISOString();
        sessions.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        renderSessionsList();
      }
    } else if (!gotImage) {
      assistantBubble.textEl.textContent = '(没有收到回复——服务器可能刚被唤醒或正在重启,点"重新回答"再试一次)';
      statusText.textContent = '';
    } else {
      statusText.textContent = '';
    }
  } catch (err) {
    assistantBubble.el.remove();
    userBubble.textEl.textContent = '(语音发送失败: ' + err.message + ')';
    statusText.textContent = '';
  } finally {
    setBusy(false);
  }
}

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

// iOS full-res photos run several MB each — picking even 4-5 of them held
// as-is (for preview + later packed into one upload) has been enough to
// blow past a home-screen PWA's much tighter memory ceiling than a normal
// Safari tab, crashing the whole page (lost chat history and all) before
// the request even reaches the server. Downscale/re-encode every picked
// photo through a canvas immediately at selection time — before it's ever
// held for preview — so peak memory stays bounded to roughly one decoded
// image at a time regardless of how many she picks.
const UPLOAD_MAX_DIM = 1600;
const UPLOAD_JPEG_QUALITY = 0.82;
// Already-small images (screenshots, stickers) skip re-encoding — no
// point paying a quality hit when there's no memory problem to solve.
const UPLOAD_SKIP_COMPRESS_BYTES = 600 * 1024;

function compressImageForUpload(file) {
  return new Promise((resolve) => {
    if (file.size <= UPLOAD_SKIP_COMPRESS_BYTES) { resolve(file); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, UPLOAD_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          // Only worth it if it's actually smaller — a tiny/simple source
          // image can occasionally re-encode larger as JPEG.
          resolve(blob && blob.size < file.size ? blob : file);
        }, 'image/jpeg', UPLOAD_JPEG_QUALITY);
      } catch {
        URL.revokeObjectURL(url);
        resolve(file);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

imageBtn.addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', async () => {
  const files = Array.from(imageInput.files || []).slice(0, MAX_IMAGES - selectedImageFiles.length);
  imageInput.value = '';
  if (!files.length) return;
  // One at a time, not Promise.all — decoding several full-res photos into
  // canvases concurrently is exactly the memory spike this is meant to
  // avoid.
  const showedStatus = files.length > 1;
  if (showedStatus) statusText.textContent = '图片处理中...';
  for (const file of files) {
    const compressed = await compressImageForUpload(file);
    selectedImageFiles.push(compressed);
    renderImagePreview();
  }
  if (showedStatus) statusText.textContent = '';
});

// ---- Tab navigation ----

const tabBtns = document.querySelectorAll('.tab-btn');
const views = {
  home: document.getElementById('view-home'),
  chat: document.getElementById('view-chat'),
  diary: document.getElementById('view-diary'),
  more: document.getElementById('view-more'),
};

function switchView(name) {
  if (!views[name]) return;
  Object.entries(views).forEach(([key, el]) => el.classList.toggle('active', key === name));
  tabBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === name));
  // The custom chat background paints the whole screen but only while
  // the chat tab is up — re-evaluate on every tab switch.
  updateChatBgState();
  if (name === 'home') loadHome();
  if (name === 'diary') loadDiary();
}

tabBtns.forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));

// ---- Home ----

const quoteTextEl = document.getElementById('quoteText');
const quoteZhEl = document.getElementById('quoteZh');
const quoteRefreshBtn = document.getElementById('quoteRefreshBtn');
const homeDateEl = document.getElementById('homeDate');
const songBodyEl = document.getElementById('songBody');
const songRerollBtn = document.getElementById('songRerollBtn');
const tempCardEl = document.getElementById('tempCard');
const tempValueEl = document.getElementById('tempValue');
const tempWordEl = document.getElementById('tempWord');

function tempBand(value) {
  if (value <= 30) return { color: '#7fb3d4', word: '低落' };
  if (value <= 50) return { color: '#a0a8b0', word: '平静' };
  if (value <= 70) return { color: '#e8a848', word: '温暖' };
  if (value <= 90) return { color: '#e88a48', word: '开心' };
  return { color: '#e85a6b', word: '满溢' };
}
const homeWeatherEl = document.getElementById('homeWeather');

const QUOTES = [
  { en: 'The best thing to hold onto in life is each other. — Audrey Hepburn', zh: '生命中最值得握住的,就是彼此。—— 奥黛丽·赫本' },
  { en: 'In all the world, there is no heart for me like yours. — Maya Angelou', zh: '普天之下,没有一颗心比你的更懂我。—— 玛雅·安吉罗' },
  { en: 'You are my today and all of my tomorrows. — Leo Christopher', zh: '你是我的今天,也是我所有的明天。—— 利奥·克里斯托弗' },
  { en: "Home is wherever I'm with you. — Edward Sharpe", zh: '只要和你在一起,哪里都是家。—— Edward Sharpe' },
  { en: 'Whatever our souls are made of, his and mine are the same. — Emily Brontë', zh: '无论我们的灵魂由什么造成,他的和我的完全一样。—— 艾米莉·勃朗特' },
  { en: 'You are my sun, my moon, and all my stars. — E.E. Cummings', zh: '你是我的太阳、月亮和所有星辰。—— E.E. 卡明斯' },
  { en: 'To love and be loved is to feel the sun from both sides. — David Viscott', zh: '去爱和被爱,就像同时感受阳光的两面。—— 大卫·维斯考特' },
  { en: 'I would rather share one lifetime with you than face all the ages of this world alone. — Arwen, The Lord of the Rings', zh: '我宁愿和你共度这一生,也不愿独自面对世间所有的岁月。—— 阿尔玟,《指环王》' },
  { en: 'Grow old along with me, the best is yet to be. — Robert Browning', zh: '和我一起变老吧,最好的还在后面。—— 罗伯特·勃朗宁' },
  { en: 'Every love story is beautiful, but ours is my favorite. — Anonymous', zh: '每个爱情故事都很美,但我最喜欢我们这一个。—— 佚名' },
  { en: 'Being deeply loved by someone gives you strength. — Lao Tzu', zh: '被一个人深爱着,会给你力量。—— 老子' },
  { en: 'You are my heart, my life, my one and only thought. — Arthur Conan Doyle', zh: '你是我的心、我的命,我唯一的念想。—— 阿瑟·柯南·道尔' },
  { en: 'A friend is someone who knows all about you and still loves you. — Elbert Hubbard', zh: '朋友,就是了解你的一切,却依然爱你的人。—— 埃尔伯特·哈伯德' },
  { en: "Love doesn't make the world go round. Love is what makes the ride worthwhile. — Franklin P. Jones", zh: '爱不能让世界转动,但爱能让这一路值得。—— 富兰克林·P·琼斯' },
  { en: 'I love you without knowing how, or when, or from where. — Pablo Neruda', zh: '我爱你,不知道如何爱,何时爱,从何而起。—— 巴勃罗·聂鲁达' },
  { en: 'For, you see, each day I love you more, today more than yesterday and less than tomorrow. — Rosemonde Gérard', zh: '你看,我每天都更爱你一点,今天比昨天多,却比明天少。—— 罗斯蒙德·热拉尔' },
  { en: "If you live to be a hundred, I want to live to be a hundred minus one day, so I never have to live without you. — A.A. Milne", zh: '如果你活到一百岁,我希望自己活到九十九岁差一天,这样我就永远不用没有你的日子。—— A.A. 米尔恩' },
  { en: 'Lovers don\'t finally meet somewhere. They\'re in each other all along. — Rumi', zh: '恋人们最终不是在某处相遇,他们本就一直在彼此心里。—— 鲁米' },
  { en: 'I love you not only for what you are, but for what I am when I am with you. — Roy Croft', zh: '我爱你,不只因为你是怎样的人,更因为和你在一起时我是怎样的人。—— 罗伊·克罗夫特' },
  { en: 'How do I love thee? Let me count the ways. — Elizabeth Barrett Browning', zh: '我该如何爱你?让我细数那些方式。—— 伊丽莎白·巴雷特·勃朗宁' },
  { en: 'You pierce my soul. I am half agony, half hope. — Jane Austen, Persuasion', zh: '你刺穿了我的灵魂。我一半是痛苦,一半是希望。—— 简·奥斯汀,《劝导》' },
  { en: 'The supreme happiness of life is the conviction that we are loved. — Victor Hugo', zh: '人生至高的幸福,是坚信自己被爱着。—— 维克多·雨果' },
  { en: 'Doubt thou the stars are fire; doubt that the sun doth move; doubt truth to be a liar; but never doubt I love. — William Shakespeare, Hamlet', zh: '怀疑星星是火焰,怀疑太阳会移动,怀疑真理是谎言,但永远别怀疑我爱你。—— 威廉·莎士比亚,《哈姆雷特》' },
  { en: 'The best love is the kind that awakens the soul and makes us reach for more. — Nicholas Sparks, The Notebook', zh: '最好的爱,是能唤醒灵魂、让人渴望更多的那种。—— 尼古拉斯·斯帕克斯,《恋恋笔记本》' },
  { en: 'You are, and always have been, my dream. — Nicholas Sparks, The Notebook', zh: '你一直都是,而且永远都是,我的梦。—— 尼古拉斯·斯帕克斯,《恋恋笔记本》' },
];
// This local list is now just the offline/no-Supabase fallback — the
// primary source is /api/daily-quote below, which asks the model fresh
// each day (see pickDailyQuote in server.js) instead of cycling through a
// fixed pool, so it doesn't repeat nearly as fast.
let lastQuoteIndex = -1;
function showRandomQuote() {
  let i = Math.floor(Math.random() * QUOTES.length);
  if (QUOTES.length > 1 && i === lastQuoteIndex) i = (i + 1) % QUOTES.length;
  lastQuoteIndex = i;
  quoteTextEl.textContent = QUOTES[i].en;
  quoteZhEl.textContent = QUOTES[i].zh;
}

async function loadDailyQuote() {
  try {
    const res = await fetch('/api/daily-quote');
    const data = await res.json();
    if (!res.ok || !data.en) throw new Error(data.error || '没拿到今天的情话');
    quoteTextEl.textContent = data.en;
    quoteZhEl.textContent = data.zh;
  } catch {
    // Network hiccup, cold start, or the model didn't return a valid
    // quote this time — fall back to the local pool instead of leaving
    // the card blank.
    showRandomQuote();
  }
}

async function rerollDailyQuote() {
  quoteRefreshBtn.disabled = true;
  try {
    const res = await fetch('/api/daily-quote/reroll', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.en) throw new Error(data.error || '换一句失败');
    quoteTextEl.textContent = data.en;
    quoteZhEl.textContent = data.zh;
  } catch {
    showRandomQuote();
  } finally {
    quoteRefreshBtn.disabled = false;
  }
}

quoteRefreshBtn.addEventListener('click', () => {
  if (supabaseReady) rerollDailyQuote();
  else showRandomQuote();
});

function renderHomeDate() {
  const now = new Date();
  homeDateEl.textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

async function loadWeather() {
  try {
    const res = await fetch('/api/weather');
    const data = await res.json();
    if (!res.ok || !data || !data.emoji) { homeWeatherEl.classList.add('hidden'); return; }
    homeWeatherEl.textContent = `${data.emoji} ${data.tempC}°C ${data.city || ''}`;
    homeWeatherEl.classList.remove('hidden');
  } catch {
    homeWeatherEl.classList.add('hidden');
  }
}

function renderSong(song) {
  if (!song) {
    songBodyEl.innerHTML = '<div class="song-loading">今天先没有推荐</div>';
    return;
  }
  songBodyEl.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'song-title';
  title.textContent = song.title;
  const artist = document.createElement('div');
  artist.className = 'song-artist';
  artist.textContent = song.artist;
  songBodyEl.appendChild(title);
  songBodyEl.appendChild(artist);
  if (song.reason) {
    const reason = document.createElement('div');
    reason.className = 'song-reason';
    reason.textContent = song.reason;
    songBodyEl.appendChild(reason);
  }
  // Server-fetched real lyric lines (fetchNeteaseLyricSnippet) — the
  // model no longer quotes lyrics from memory, this is the verified
  // replacement.
  if (song.lyric) {
    const lyric = document.createElement('div');
    lyric.className = 'song-lyric';
    lyric.textContent = '♪ ' + song.lyric;
    songBodyEl.appendChild(lyric);
  }

  // No login/cookie/reverse-engineered playback involved — just a link she
  // taps herself. When the server found a matching NetEase song id
  // (best-effort search match, see lookupNeteaseSongId in server.js), link
  // straight to that song's canonical page instead of a search results page.
  //
  // Deliberately NOT target="_blank": this app runs as a standalone
  // home-screen PWA, and on iOS a target="_blank" tap from a standalone PWA
  // opens an embedded in-app browser sheet (SFSafariViewController-style),
  // not real Safari — Universal Links (the mechanism that hands off to the
  // NetEase app) mostly don't fire from inside that embedded sheet, and
  // some sites (NetEase included) serve a blank/restricted page to that
  // embedded context on purpose. A plain same-window navigation gives iOS
  // an actual top-level open, which is what Universal Link handoff needs.
  const link = document.createElement('a');
  link.className = 'song-open-link';
  link.href = song.netease_id
    ? `https://music.163.com/song?id=${encodeURIComponent(song.netease_id)}`
    : `https://music.163.com/#/search/m/?s=${encodeURIComponent(song.title + ' ' + song.artist)}&type=1`;
  link.textContent = song.netease_id ? '去网易云听 ›' : '去网易云搜这首 ›';
  songBodyEl.appendChild(link);

  // NetEase's official embeddable outchain player — when we matched a song
  // id, she can hit play right here without leaving the app or logging in.
  // Copyright-restricted tracks render a "无版权" notice inside the frame;
  // the deep link above stays as the fallback path either way.
  if (song.netease_id) {
    const frame = document.createElement('iframe');
    frame.className = 'song-player';
    frame.src = `https://music.163.com/outchain/player?type=2&id=${encodeURIComponent(song.netease_id)}&auto=0&height=66`;
    frame.setAttribute('frameborder', 'no');
    songBodyEl.appendChild(frame);
  }
}

async function loadSong() {
  songBodyEl.innerHTML = '<div class="song-loading">正在挑歌...</div>';
  try {
    const res = await fetch('/api/daily-song');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '获取失败');
    renderSong(data);
  } catch (err) {
    songBodyEl.innerHTML = `<div class="song-loading">推荐失败: ${err.message}</div>`;
  }
}

songRerollBtn.addEventListener('click', async () => {
  songBodyEl.innerHTML = '<div class="song-loading">换一首...</div>';
  try {
    const res = await fetch('/api/daily-song/reroll', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '换歌失败');
    renderSong(data);
  } catch (err) {
    songBodyEl.innerHTML = `<div class="song-loading">换歌失败: ${err.message}</div>`;
  }
});

function shanghaiDateStrClient() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function loadTemperature() {
  try {
    const res = await fetch('/api/diary');
    const data = await res.json();
    if (!res.ok || !Array.isArray(data) || !data.length) { tempCardEl.classList.add('hidden'); return; }
    const latest = data[0];
    if (latest.entry_date !== shanghaiDateStrClient() || latest.temperature == null) { tempCardEl.classList.add('hidden'); return; }
    const band = tempBand(latest.temperature);
    tempValueEl.textContent = latest.temperature;
    tempValueEl.style.color = band.color;
    tempWordEl.textContent = band.word;
    tempCardEl.classList.remove('hidden');
  } catch {
    tempCardEl.classList.add('hidden');
  }
}

let homeQuoteShown = false;
async function loadHome() {
  renderHomeDate();
  renderNowStatus();
  if (!homeQuoteShown) {
    homeQuoteShown = true;
    if (supabaseReady) loadDailyQuote();
    else showRandomQuote();
  }
  if (!supabaseReady) return;
  loadSong();
  loadTemperature();
  loadWeather();
  loadMilestones();
}

// ---- 纪念册 (jointly confirmed milestones) ----

const milestoneListEl = document.getElementById('milestoneList');
const milestoneInputEl = document.getElementById('milestoneInput');
const milestoneAddBtn = document.getElementById('milestoneAddBtn');

function renderMilestoneItem(item) {
  const row = document.createElement('div');
  row.className = 'milestone-item';
  const date = document.createElement('span');
  date.className = 'milestone-date';
  date.textContent = new Date(item.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  const content = document.createElement('span');
  content.className = 'milestone-content';
  content.textContent = item.content;
  const del = document.createElement('button');
  del.className = 'mini-icon-btn milestone-del';
  del.title = '删除';
  del.textContent = '✕';
  del.addEventListener('click', async () => {
    if (!confirm('把这条从纪念册里删掉?他以后就不记得这件事了。')) return;
    try {
      const r = await fetch('/api/milestones/' + item.id, { method: 'DELETE' });
      if (r.ok) row.remove();
    } catch {}
  });
  row.appendChild(date);
  row.appendChild(content);
  row.appendChild(del);
  return row;
}

// She asked: past 2 entries, this was making the Home page card grow
// without bound as the book fills up. Show the most recent 2 (items
// already come back newest-first) and tuck the rest behind a
// 展开/收起 toggle instead.
const MILESTONE_COLLAPSE_AFTER = 2;

async function loadMilestones() {
  try {
    const res = await fetch('/api/milestones');
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || '加载失败');
    milestoneListEl.innerHTML = '';
    if (!items.length) {
      milestoneListEl.innerHTML = '<div class="song-loading">还没有记下的事</div>';
      return;
    }
    const visibleItems = items.slice(0, MILESTONE_COLLAPSE_AFTER);
    const hiddenItems = items.slice(MILESTONE_COLLAPSE_AFTER);

    visibleItems.forEach((item) => milestoneListEl.appendChild(renderMilestoneItem(item)));

    if (hiddenItems.length) {
      const moreWrap = document.createElement('div');
      moreWrap.className = 'milestone-more-wrap hidden';
      hiddenItems.forEach((item) => moreWrap.appendChild(renderMilestoneItem(item)));
      milestoneListEl.appendChild(moreWrap);

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'milestone-toggle';
      const expandLabel = `展开还有 ${hiddenItems.length} 条 ⌄`;
      const collapseLabel = '收起 ⌃';
      toggleBtn.textContent = expandLabel;
      toggleBtn.addEventListener('click', () => {
        const nowHidden = moreWrap.classList.toggle('hidden');
        toggleBtn.textContent = nowHidden ? expandLabel : collapseLabel;
      });
      milestoneListEl.appendChild(toggleBtn);
    }
  } catch (err) {
    milestoneListEl.innerHTML = '<div class="song-loading">纪念册加载失败: ' + err.message + '</div>';
  }
}

milestoneAddBtn.addEventListener('click', async () => {
  const content = milestoneInputEl.value.trim();
  if (!content) return;
  milestoneAddBtn.disabled = true;
  try {
    const res = await fetch('/api/milestones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '保存失败');
    milestoneInputEl.value = '';
    loadMilestones();
  } catch (err) {
    statusText.textContent = '记入纪念册失败: ' + err.message;
  } finally {
    milestoneAddBtn.disabled = false;
  }
});

// ---- Diary ----

const diaryListEl = document.getElementById('diaryList');
const diaryWriteBtn = document.getElementById('diaryWriteBtn');

function formatDiaryTimestamp(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

diaryWriteBtn.addEventListener('click', async () => {
  diaryWriteBtn.disabled = true;
  try {
    const res = await fetch('/api/diary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '写日记失败');
    await loadDiary();
  } catch (err) {
    statusText.textContent = '写日记失败: ' + err.message;
  } finally {
    diaryWriteBtn.disabled = false;
  }
});

function renderDiaryEntries(entries) {
  diaryListEl.innerHTML = '';
  if (!entries.length) {
    diaryListEl.innerHTML = '<div class="diary-loading">还没有日记</div>';
    return;
  }
  entries.forEach((entry, i) => {
    if (i > 0) {
      const divider = document.createElement('div');
      divider.className = 'diary-entry-divider';
      divider.innerHTML = '<span class="line"></span><span>✦</span><span class="line"></span>';
      diaryListEl.appendChild(divider);
    }
    diaryListEl.appendChild(renderDiaryEntry(entry));
  });
}

function renderDiaryEntry(entry) {
  const card = document.createElement('div');
  card.className = 'diary-entry';

  const head = document.createElement('div');
  head.className = 'diary-entry-head';
  const date = document.createElement('span');
  date.className = 'diary-date';
  date.textContent = formatDiaryTimestamp(entry.created_at || entry.entry_date);
  head.appendChild(date);

  const mood = document.createElement('span');
  mood.className = 'diary-mood';
  if (entry.weather) mood.appendChild(document.createTextNode(entry.weather + ' '));
  if (entry.mood_emoji) mood.appendChild(document.createTextNode(entry.mood_emoji));
  head.appendChild(mood);
  card.appendChild(head);

  const content = document.createElement('div');
  content.className = 'diary-content';
  content.textContent = entry.content;
  card.appendChild(content);

  const thread = document.createElement('div');
  thread.className = 'diary-thread';
  card.appendChild(thread);

  if (entry.user_reply) {
    const mine = document.createElement('div');
    mine.className = 'diary-reply-block mine';
    mine.textContent = entry.user_reply;
    thread.appendChild(mine);

    if (entry.ai_reply) {
      const hers = document.createElement('div');
      hers.className = 'diary-reply-block hers';
      hers.textContent = entry.ai_reply;
      thread.appendChild(hers);
    } else {
      const waiting = document.createElement('div');
      waiting.className = 'diary-reply-waiting';
      waiting.textContent = '苏晏正在看...';
      thread.appendChild(waiting);
      pollForAiReply(entry.id, waiting);
    }
  } else {
    const form = document.createElement('div');
    form.className = 'diary-reply-form';
    const input = document.createElement('input');
    input.className = 'diary-reply-input';
    input.type = 'text';
    input.placeholder = '回复这篇日记...';
    // Without this, iOS treats a bare text field as a possible name/contact
    // entry and pops its own "自动填充联系人" AutoFill suggestion strip above
    // the keyboard — a native row we don't control, sitting outside our own
    // layout. Every other input in the app already sets this; this one was
    // just missed because it's built in JS instead of static HTML.
    input.autocomplete = 'off';
    const replyBtn = document.createElement('button');
    replyBtn.className = 'diary-reply-send';
    replyBtn.type = 'button';
    replyBtn.textContent = '发送';
    form.appendChild(input);
    form.appendChild(replyBtn);
    thread.appendChild(form);

    const submit = async () => {
      const reply = input.value.trim();
      if (!reply) return;
      replyBtn.disabled = true;
      try {
        const res = await fetch(`/api/diary/${entry.id}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reply }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '回复失败');
        card.replaceWith(renderDiaryEntry(data));
      } catch (err) {
        statusText.textContent = '回复失败: ' + err.message;
        replyBtn.disabled = false;
      }
    };
    replyBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  }

  return card;
}

// The AI reply is generated in the background after a reply is posted —
// poll a few times with backoff so it shows up without a manual refresh.
async function pollForAiReply(id, waitingEl) {
  for (const delay of [3000, 4000, 5000, 6000, 8000]) {
    await new Promise((r) => setTimeout(r, delay));
    if (!document.body.contains(waitingEl)) return;
    try {
      const res = await fetch(`/api/diary/${id}`);
      const data = await res.json();
      if (res.ok && data.ai_reply) {
        const hers = document.createElement('div');
        hers.className = 'diary-reply-block hers';
        hers.textContent = data.ai_reply;
        waitingEl.replaceWith(hers);
        return;
      }
    } catch {
      // keep trying on next iteration
    }
  }
}

async function loadDiary() {
  if (!supabaseReady) return;
  diaryListEl.innerHTML = '<div class="diary-loading">正在翻日记...</div>';
  try {
    await fetch('/api/diary/generate', { method: 'POST' }).catch(() => {});
    const res = await fetch('/api/diary');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '加载失败');
    renderDiaryEntries(data);
  } catch (err) {
    diaryListEl.innerHTML = `<div class="diary-loading">加载失败: ${err.message}</div>`;
  }
}

// ---- Voice call (hands-free) ----
// A conversation loop, not push-to-talk: the mic level is monitored
// continuously (WebAudio analyser), a turn starts when speech is heard
// and auto-sends after ~1.3s of silence, the reply plays, then listening
// resumes — no button presses between turns. The mic button is a mute
// toggle for noisy surroundings. Listening pauses while he speaks so his
// voice from the speaker can't trigger the detector. Recording uses our
// own MediaRecorder, no IME involved, so third-party keyboard voice
// panels (and their black-screen crashes) never enter the picture.
// Turns are saved as normal messages, so hanging up drops the whole
// call transcript into the chat.
const callBtn = document.getElementById('callBtn');
const callScreen = document.getElementById('callScreen');
const callStatusEl = document.getElementById('callStatus');
const callTranscriptEl = document.getElementById('callTranscript');
const callTalkBtn = document.getElementById('callTalkBtn');
const callEndBtn = document.getElementById('callEndBtn');

let callStream = null;
let callRecorder = null;
let callChunks = [];
let callHadTurns = false;
let callAudioCtx = null;
let callAnalyser = null;
let callMonitorTimer = null;
// 'idle' | 'listening' | 'processing' | 'speaking' | 'muted'
let callState = 'idle';
let callWakeLock = null;
let speechSeen = false;
let lastVoiceAt = 0;
let listenStartedAt = 0;
let noiseSamples = [];
let voiceThreshold = 0.025;

const SILENCE_MS = 2000;       // pause this long after speaking = turn over (roomy enough for multi-sentence thoughts)
const MIN_SPEECH_MS = 250;     // shorter blips than this don't count as speech
const IDLE_RECYCLE_MS = 25000; // restart recorder if nothing said for this long

function callMimeType() {
  if (!window.MediaRecorder) return '';
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

// iOS suspends mic access the moment the screen locks — there's no way
// around that from a webpage, so instead we stop the screen from locking
// on its own while a call is active. The OS still releases the lock
// whenever the page itself goes into the background (app-switch, browser
// minimized), so it has to be re-acquired on return, not just once at
// call start.
async function requestCallWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    callWakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.error('wake lock request failed:', err);
  }
}

function releaseCallWakeLock() {
  if (callWakeLock) callWakeLock.release().catch(() => {});
  callWakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && callState !== 'idle' && !callScreen.classList.contains('hidden')) {
    requestCallWakeLock();
  }
});

function addCallLine(who, text) {
  const line = document.createElement('div');
  line.className = 'call-line ' + who;
  line.textContent = text;
  callTranscriptEl.appendChild(line);
  callTranscriptEl.scrollTop = callTranscriptEl.scrollHeight;
}

function micLevel() {
  if (!callAnalyser) return 0;
  const buf = new Float32Array(callAnalyser.fftSize);
  callAnalyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function startListening() {
  if (!callStream || callState === 'muted') return;
  callChunks = [];
  speechSeen = false;
  noiseSamples = [];
  listenStartedAt = Date.now();
  const mime = callMimeType();
  try {
    callRecorder = mime ? new MediaRecorder(callStream, { mimeType: mime }) : new MediaRecorder(callStream);
  } catch (err) {
    callStatusEl.textContent = '录音启动失败: ' + err.message;
    return;
  }
  callRecorder.ondataavailable = (e) => { if (e.data && e.data.size) callChunks.push(e.data); };
  callRecorder.onstop = () => {
    if (callState !== 'processing') return; // hung up / muted / recycled — discard
    const blob = new Blob(callChunks, { type: callRecorder.mimeType || 'audio/mp4' });
    if (blob.size < 1000) { setCallState('listening'); return; }
    sendCallTurn(blob);
  };
  callRecorder.start();
  callState = 'listening';
  callTalkBtn.classList.add('recording');
  callStatusEl.textContent = '在听,直接说就行';

  clearInterval(callMonitorTimer);
  let speechStartAt = 0;
  callMonitorTimer = setInterval(() => {
    if (callState !== 'listening') return;
    const level = micLevel();
    const now = Date.now();

    // First ~600ms: sample ambient noise and set the speech threshold a
    // safe margin above it, so a noisy room doesn't self-trigger.
    if (now - listenStartedAt < 600) {
      noiseSamples.push(level);
      return;
    }
    if (noiseSamples.length) {
      const avg = noiseSamples.reduce((a, b) => a + b, 0) / noiseSamples.length;
      voiceThreshold = Math.max(0.02, avg * 3);
      noiseSamples = [];
    }

    if (level > voiceThreshold) {
      if (!speechStartAt) speechStartAt = now;
      if (!speechSeen && now - speechStartAt >= MIN_SPEECH_MS) {
        speechSeen = true;
        callStatusEl.textContent = '嗯,在听...说完停一下就发出去';
      }
      lastVoiceAt = now;
    } else if (!speechSeen) {
      speechStartAt = 0;
    }

    if (speechSeen && now - lastVoiceAt > SILENCE_MS) {
      finishTurn();
      return;
    }
    if (!speechSeen && now - listenStartedAt > IDLE_RECYCLE_MS) {
      // Nothing said for a while — restart the recorder so the buffered
      // clip doesn't grow forever while idle.
      const rec = callRecorder;
      callState = 'idle';
      rec.stop();
      startListening();
    }
  }, 90);
}

function finishTurn() {
  if (callState !== 'listening' || !callRecorder || callRecorder.state !== 'recording') return;
  callState = 'processing';
  clearInterval(callMonitorTimer);
  callTalkBtn.classList.remove('recording');
  callRecorder.stop();
}

function setCallState(next) {
  callState = next;
  if (next === 'listening') startListening();
}

async function sendCallTurn(blob) {
  callStatusEl.textContent = '他在听...';
  try {
    const form = new FormData();
    form.append('sessionId', currentSessionId);
    form.append('audio', blob, 'turn.m4a');
    const res = await fetch('/api/call-turn', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '这一轮没成功');

    callHadTurns = true;
    addCallLine('me', data.userText);
    addCallLine('him', data.replyText);

    if (data.audioBase64) {
      callState = 'speaking';
      ttsPlayer.src = 'data:audio/mpeg;base64,' + data.audioBase64;
      ttsPlayer.playbackRate = 1;
      ttsPlayer.currentTime = 0;
      callStatusEl.textContent = '他在说...';
      ttsPlayer.addEventListener('ended', () => {
        if (callState !== 'speaking') return;
        // Small pause before re-arming the mic so the speaker's tail end
        // doesn't get picked up as her talking.
        setTimeout(() => { if (callState === 'speaking') setCallState('listening'); }, 350);
      }, { once: true });
      await ttsPlayer.play().catch(() => {
        callStatusEl.textContent = '语音放不出来,他说的在上面';
        if (callState === 'speaking') setCallState('listening');
      });
    } else {
      callStatusEl.textContent = '语音合成没成功,他说的在上面';
      setCallState('listening');
    }
  } catch (err) {
    callStatusEl.textContent = err.message;
    setCallState('listening');
  }
}

callBtn.addEventListener('click', async () => {
  if (!currentSessionId) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    statusText.textContent = '这个浏览器不支持录音,没法通话';
    return;
  }
  // Both of these need to happen inside this tap's gesture window on iOS:
  // unlocking the shared audio element (replies play long after the tap)
  // and creating/resuming the AudioContext the level meter runs on.
  unlockAudioPlayback();
  try {
    callAudioCtx = callAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (callAudioCtx.state === 'suspended') callAudioCtx.resume();
  } catch {}
  try {
    callStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    statusText.textContent = '需要麦克风权限才能通话(去系统设置里允许一下)';
    return;
  }
  requestCallWakeLock();
  try {
    const source = callAudioCtx.createMediaStreamSource(callStream);
    callAnalyser = callAudioCtx.createAnalyser();
    callAnalyser.fftSize = 1024;
    source.connect(callAnalyser);
  } catch {}
  callHadTurns = false;
  callTranscriptEl.innerHTML = '';
  callScreen.classList.remove('hidden');
  startListening();
});

// The mic button is now a mute toggle — the loop runs hands-free, this is
// the escape hatch for noisy surroundings (or thinking out loud).
callTalkBtn.addEventListener('click', () => {
  if (!callStream) return;
  unlockAudioPlayback();
  if (callState === 'muted') {
    callTalkBtn.classList.remove('muted');
    setCallState('listening');
    return;
  }
  if (callState === 'listening') {
    const rec = callRecorder;
    callState = 'muted';
    clearInterval(callMonitorTimer);
    if (rec && rec.state === 'recording') rec.stop();
    callTalkBtn.classList.remove('recording');
    callTalkBtn.classList.add('muted');
    callStatusEl.textContent = '已静音,再按一下继续';
  }
});

callEndBtn.addEventListener('click', () => {
  const rec = callRecorder;
  callState = 'idle';
  clearInterval(callMonitorTimer);
  if (rec && rec.state === 'recording') rec.stop();
  if (callStream) { callStream.getTracks().forEach((t) => t.stop()); callStream = null; }
  callAnalyser = null;
  ttsPlayer.pause();
  releaseCallWakeLock();
  callTalkBtn.classList.remove('recording', 'muted');
  callScreen.classList.add('hidden');
  // The call's turns were saved server-side as normal messages — reload so
  // they show up in the chat transcript right away.
  if (callHadTurns && currentSessionId) selectSession(currentSessionId);
});
