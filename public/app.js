(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'xiaowu-token';
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let oldestId = null;
  let sending = false;
  let lastShownTs = 0;
  let abortCtl = null;
  let settings = { model: 'claude-opus-5-5', effort: 'low' };
  const MODEL_NAMES = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };
  const EFFORT_NAMES = { low: '低', medium: '中等', high: '高' };
  const ICON_COPY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h.5"/></svg>';
  const ICON_SPEAK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  const isDesktop = matchMedia('(pointer: fine)').matches;

  // ---------- 工具 ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...(opts.headers || {}) },
    });
    if (res.status === 401) { showLogin('密码不对，重新输一下'); throw new Error('401'); }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '出错了（' + res.status + '）');
    }
    return res;
  }

  let toastTimer;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function inline(s) {
    return s
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  }

  // 简单的 Markdown：段落、列表、引用、标题、代码块
  function renderMarkdown(src) {
    const out = [];
    const parts = escapeHtml(src).split(/```/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const code = part.replace(/^[^\n]*\n/, '');
        out.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
        return;
      }
      const blocks = part.split(/\n{2,}/);
      for (const block of blocks) {
        const b = block.replace(/^\n+|\n+$/g, '');
        if (!b) continue;
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          out.push('<ul>' + lines.map((l) => '<li>' + inline(l.replace(/^\s*[-*•]\s+/, '')) + '</li>').join('') + '</ul>');
        } else if (lines.every((l) => /^\s*\d+[.)、]\s*/.test(l))) {
          out.push('<ol>' + lines.map((l) => '<li>' + inline(l.replace(/^\s*\d+[.)、]\s*/, '')) + '</li>').join('') + '</ol>');
        } else if (lines.every((l) => /^&gt;\s?/.test(l))) {
          out.push('<blockquote>' + lines.map((l) => inline(l.replace(/^&gt;\s?/, ''))).join('<br>') + '</blockquote>');
        } else if (lines.length === 1 && /^#{1,4}\s+/.test(b)) {
          out.push('<h4>' + inline(b.replace(/^#{1,4}\s+/, '')) + '</h4>');
        } else {
          out.push('<p>' + lines.map(inline).join('<br>') + '</p>');
        }
      }
    });
    return out.join('');
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const sameDay = d.toDateString() === now.toDateString();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay) return hm;
    if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return '这么晚还没睡呀';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }

  // ---------- 视图切换 ----------
  function showLogin(msg) {
    $('chat').classList.add('hidden');
    $('memory').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('login-error').textContent = msg || '';
    setTimeout(() => $('login-password').focus(), 50);
  }

  async function showChat() {
    $('login').classList.add('hidden');
    $('chat').classList.remove('hidden');
    $('greeting').textContent = greeting();
    await loadMessages();
    refreshHeader();
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    token = $('login-password').value;
    localStorage.setItem(TOKEN_KEY, token);
    try {
      await api('/api/messages?limit=1');
      $('login-password').value = '';
      await showChat();
    } catch (err) {
      if (err.message !== '401') $('login-error').textContent = err.message;
    }
  });

  // ---------- 消息 ----------
  const scroller = $('scroller');
  const list = $('messages');

  function atBottom() {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }
  function scrollToBottom() {
    scroller.scrollTop = scroller.scrollHeight;
  }

  function makeMsg(m) {
    const el = document.createElement('div');
    el.className = 'msg ' + m.role;
    el.dataset.id = m.id || '';
    el.dataset.ts = m.created_at || Date.now();
    el._raw = m.content;
    if (m.role === 'assistant') {
      el.innerHTML = renderMarkdown(m.content);
      addActions(el);
    } else el.textContent = m.content;
    attachPress(el);
    return el;
  }

  function addActions(el) {
    const bar = document.createElement('div');
    bar.className = 'msg-actions';
    const copy = document.createElement('button');
    copy.innerHTML = ICON_COPY;
    copy.setAttribute('aria-label', '复制');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(el._raw || ''); toast('复制好了'); } catch { toast('复制不了'); }
    });
    bar.appendChild(copy);
    if ('speechSynthesis' in window) {
      const speak = document.createElement('button');
      speak.innerHTML = ICON_SPEAK;
      speak.setAttribute('aria-label', '读出来');
      speak.addEventListener('click', () => toggleSpeak(el._raw || '', speak));
      bar.appendChild(speak);
    }
    el.appendChild(bar);
  }

  // 用手机自带的声音读出来（免费）
  let speakingBtn = null;
  function toggleSpeak(text, btn) {
    const synth = window.speechSynthesis;
    const wasMe = speakingBtn === btn;
    synth.cancel();
    if (speakingBtn) speakingBtn.classList.remove('on');
    speakingBtn = null;
    if (wasMe) return;
    const plain = text.replace(/```[\s\S]*?```/g, '').replace(/[*_`#>~]/g, '');
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = 'zh-CN';
    const voice = synth.getVoices().find((v) => /zh[-_]CN/i.test(v.lang));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => { btn.classList.remove('on'); if (speakingBtn === btn) speakingBtn = null; };
    btn.classList.add('on');
    speakingBtn = btn;
    synth.speak(u);
  }

  function timeSep(ts) {
    const el = document.createElement('div');
    el.className = 'time-sep';
    el.textContent = fmtTime(ts);
    return el;
  }

  // 把一批消息渲染成节点（间隔超过一小时插入时间）
  function buildNodes(msgs, prevTs) {
    const frag = document.createDocumentFragment();
    let last = prevTs;
    for (const m of msgs) {
      if (!last || m.created_at - last > 3600e3) frag.appendChild(timeSep(m.created_at));
      frag.appendChild(makeMsg(m));
      last = m.created_at;
    }
    return { frag, last };
  }

  function updateEmpty() {
    $('empty').classList.toggle('hidden', list.children.length > 0);
  }

  async function loadMessages() {
    list.innerHTML = '';
    const data = await (await api('/api/messages?limit=60')).json();
    const { frag, last } = buildNodes(data.messages, 0);
    list.appendChild(frag);
    lastShownTs = last || 0;
    oldestId = data.messages.length ? data.messages[0].id : null;
    $('load-more').classList.toggle('hidden', !data.hasMore);
    updateEmpty();
    requestAnimationFrame(scrollToBottom);
  }

  $('load-more').addEventListener('click', async () => {
    if (!oldestId) return;
    const data = await (await api('/api/messages?limit=60&before=' + oldestId)).json();
    if (!data.messages.length) { $('load-more').classList.add('hidden'); return; }
    const h = scroller.scrollHeight;
    // 删掉原来第一条时间分隔，重新按顺序算
    if (list.firstChild && list.firstChild.classList.contains('time-sep')) list.firstChild.remove();
    const { frag } = buildNodes(data.messages, 0);
    const firstMsg = list.querySelector('.msg');
    list.insertBefore(frag, list.firstChild);
    if (firstMsg) {
      const lastOld = data.messages[data.messages.length - 1].created_at;
      const firstTs = Number(firstMsg.dataset.ts || 0);
      if (!firstTs || firstTs - lastOld > 3600e3) list.insertBefore(timeSep(firstTs || Date.now()), firstMsg);
    }
    oldestId = data.messages[0].id;
    $('load-more').classList.toggle('hidden', !data.hasMore);
    scroller.scrollTop = scroller.scrollHeight - h;
  });

  // ---------- 发送 ----------
  const input = $('input');
  const sendBtn = $('send');

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    sendBtn.disabled = !sending && !input.value.trim();
  }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (isDesktop && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('composer').requestSubmit();
    }
  });

  $('composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) { if (abortCtl) abortCtl.abort(); return; }
    const text = input.value.trim();
    if (!text) return;
    sending = true;
    abortCtl = new AbortController();
    sendBtn.classList.add('stop');
    input.value = '';
    autosize();

    const now = Date.now();
    if (!lastShownTs || now - lastShownTs > 3600e3) list.appendChild(timeSep(now));
    lastShownTs = now;
    const userEl = makeMsg({ role: 'user', content: text });
    list.appendChild(userEl);
    const botEl = document.createElement('div');
    botEl.className = 'msg assistant';
    botEl.innerHTML = '<span class="typing"></span>';
    list.appendChild(botEl);
    updateEmpty();
    scrollToBottom();

    let full = '';
    let pending = false;
    const paint = () => {
      pending = false;
      const stick = atBottom();
      botEl.innerHTML = renderMarkdown(full) + '<span class="typing"></span>';
      if (stick) scrollToBottom();
    };

    try {
      const res = await api('/api/chat', { method: 'POST', body: JSON.stringify({ text }), signal: abortCtl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let finished = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.t) {
            full += ev.t;
            if (!pending) { pending = true; requestAnimationFrame(paint); }
          }
          if (ev.userId) userEl.dataset.id = ev.userId;
          if (ev.done) { botEl.dataset.id = ev.id; finished = true; }
          if (ev.error) throw new Error(ev.error);
        }
      }
      if (!finished) throw new Error('连接断了，回复可能没说完');
      botEl._raw = full;
      botEl.innerHTML = renderMarkdown(full);
      addActions(botEl);
      attachPress(botEl);
    } catch (err) {
      if (err.message === '401') return;
      const stopped = err.name === 'AbortError';
      botEl._raw = full;
      botEl.innerHTML = full ? renderMarkdown(full) : '';
      if (!stopped) {
        const errEl = document.createElement('div');
        errEl.className = 'error-msg';
        errEl.textContent = err.message;
        list.appendChild(errEl);
      }
      if (full) { addActions(botEl); attachPress(botEl); } else botEl.remove();
    } finally {
      sending = false;
      abortCtl = null;
      sendBtn.classList.remove('stop');
      autosize();
      if (atBottom()) scrollToBottom();
    }
  });

  // ---------- 长按消息 ----------
  let pressTarget = null;
  function attachPress(el) {
    if (el._pressBound) return;
    el._pressBound = true;
    let timer;
    const start = () => {
      el.classList.add('pressing');
      timer = setTimeout(() => { el.classList.remove('pressing'); openActions(el); }, 480);
    };
    const cancel = () => { clearTimeout(timer); el.classList.remove('pressing'); };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchmove', cancel, { passive: true });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); openActions(el); });
  }

  function showActions(items) {
    const box = $('action-list');
    box.innerHTML = '';
    for (const [act, label, cls] of items) {
      const b = document.createElement('button');
      b.dataset.act = act;
      b.textContent = label;
      if (cls) b.className = cls;
      box.appendChild(b);
    }
    $('sheet-backdrop').classList.remove('hidden');
    $('action-sheet').classList.remove('hidden');
  }
  function openActions(el) {
    if (window.getSelection) window.getSelection().removeAllRanges();
    pressTarget = el;
    showActions([['copy', '复制'], ['remember', '记进记忆'], ['delete', '删除这条', 'danger']]);
  }
  function closeSheets() {
    for (const id of ['sheet-backdrop', 'action-sheet', 'edit-sheet', 'model-sheet']) $(id).classList.add('hidden');
  }

  $('open-menu').addEventListener('click', () => {
    pressTarget = null;
    showActions([['memory', '记忆'], ['model', '换模型'], ['logout', '退出登录', 'danger']]);
  });
  $('sheet-backdrop').addEventListener('click', closeSheets);

  $('action-sheet').addEventListener('click', async (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const el = pressTarget;
    closeSheets();
    if (act === 'cancel') return;
    if (act === 'memory') return openMemory();
    if (act === 'model') return openModelSheet();
    if (act === 'logout') return logout();
    if (!el) return;
    const raw = el._raw || el.textContent;
    try {
      if (act === 'copy') {
        await navigator.clipboard.writeText(raw);
        toast('复制好了');
      } else if (act === 'remember') {
        openEditor(null, raw.length > 300 ? raw.slice(0, 300) : raw);
      } else if (act === 'delete') {
        if (!el.dataset.id) { el.remove(); return; }
        await api('/api/messages/' + el.dataset.id, { method: 'DELETE' });
        el.remove();
        updateEmpty();
      }
    } catch (err) {
      if (err.message !== '401') toast(err.message);
    }
  });

  // ---------- 记忆页 ----------
  const page = $('memory');
  function openMemory() {
    page.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('open')));
    loadMemoryPage();
  }
  $('open-memory').addEventListener('click', openMemory);
  $('close-memory').addEventListener('click', () => {
    page.classList.remove('open');
    setTimeout(() => page.classList.add('hidden'), 320);
  });

  const money = (v) => (v == null ? '-' : '$' + (v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)));
  let memories = [];

  async function loadMemoryPage() {
    try {
      const [s, m] = await Promise.all([
        api('/api/settings').then((r) => r.json()),
        api('/api/memories').then((r) => r.json()),
      ]);
      $('persona').value = s.persona;
      $('summary').value = s.summary;
      $('unsummarized').textContent = `还有 ${s.unsummarized} 条没整理`;
      $('cost-month').textContent = money(s.cost.month);
      $('cost-total').textContent = money(s.cost.total);
      $('cost-last').textContent = money(s.cost.last);
      settings = s;
      memories = m.memories;
      updateHeader();
      renderMemories();
    } catch (err) {
      if (err.message !== '401') toast(err.message);
    }
  }

  function renderMemories() {
    const box = $('memory-list');
    box.innerHTML = '';
    $('mem-sub').textContent = memories.length ? `记得 ${memories.length} 件事` : '还没有记忆';
    updateHeader();
    if (!memories.length) {
      box.innerHTML = '<div class="mem-empty">还没有。可以手动添加，也可以在聊天里长按一句话记下来。</div>';
      return;
    }
    for (const mem of memories.slice().reverse()) {
      const row = document.createElement('button');
      row.className = 'mem-row';
      const t = document.createElement('span');
      t.className = 'mem-text';
      t.textContent = mem.content;
      row.appendChild(t);
      if (mem.source === 'auto') {
        const tag = document.createElement('span');
        tag.className = 'mem-tag';
        tag.textContent = '自动';
        row.appendChild(tag);
      }
      row.addEventListener('click', () => openEditor(mem));
      box.appendChild(row);
    }
  }

  function setSeg(id, value) {
    for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === value);
  }
  function updateHeader() {
    $('pill-model').textContent = MODEL_NAMES[settings.model] || settings.model;
    $('pill-effort').textContent = EFFORT_NAMES[settings.effort] || settings.effort;
    $('nav-sub').textContent = memories.length ? `记得 ${memories.length} 件事` : (MODEL_NAMES[settings.model] || '');
  }
  async function refreshHeader() {
    try {
      const [s, m] = await Promise.all([
        api('/api/settings').then((r) => r.json()),
        api('/api/memories').then((r) => r.json()),
      ]);
      settings = s;
      memories = m.memories;
      updateHeader();
    } catch {}
  }
  function openModelSheet() {
    setSeg('model-options', settings.model);
    setSeg('effort-seg', settings.effort);
    $('sheet-backdrop').classList.remove('hidden');
    $('model-sheet').classList.remove('hidden');
  }
  $('model-pill').addEventListener('click', openModelSheet);
  for (const [id, key] of [['model-options', 'model'], ['effort-seg', 'effort']]) {
    $(id).addEventListener('click', async (e) => {
      const v = e.target.closest('button')?.dataset.v;
      if (!v) return;
      setSeg(id, v);
      settings[key] = v;
      updateHeader();
      try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({ [key]: v }) });
      } catch (err) { if (err.message !== '401') toast(err.message); }
    });
  }

  $('save-persona').addEventListener('click', async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ persona: $('persona').value }) });
      toast('保存好了');
    } catch (err) { if (err.message !== '401') toast(err.message); }
  });
  $('save-summary').addEventListener('click', async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ summary: $('summary').value }) });
      toast('保存好了');
    } catch (err) { if (err.message !== '401') toast(err.message); }
  });
  $('compact-now').addEventListener('click', async () => {
    const btn = $('compact-now');
    btn.disabled = true;
    btn.textContent = '整理中';
    try {
      const r = await (await api('/api/settings', { method: 'POST' })).json();
      toast(r.compacted ? `整理好了，新记下 ${r.added} 条` : '聊天还不多，不用整理');
      await loadMemoryPage();
    } catch (err) {
      if (err.message !== '401') toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '现在整理';
    }
  });

  // 记忆编辑
  let editing = null;
  function openEditor(mem, prefill) {
    editing = mem;
    $('edit-title').textContent = mem ? '修改记忆' : '新记忆';
    $('edit-text').value = mem ? mem.content : prefill || '';
    $('edit-delete').classList.toggle('hidden', !mem);
    $('sheet-backdrop').classList.remove('hidden');
    $('edit-sheet').classList.remove('hidden');
    setTimeout(() => $('edit-text').focus(), 60);
  }
  $('add-memory').addEventListener('click', () => openEditor(null));
  $('edit-cancel').addEventListener('click', closeSheets);
  $('edit-save').addEventListener('click', async () => {
    const content = $('edit-text').value.trim();
    if (!content) return;
    try {
      if (editing) {
        const r = await (await api('/api/memories/' + editing.id, { method: 'PUT', body: JSON.stringify({ content }) })).json();
        Object.assign(editing, r.memory);
      } else {
        const r = await (await api('/api/memories', { method: 'POST', body: JSON.stringify({ content }) })).json();
        memories.push(r.memory);
      }
      closeSheets();
      renderMemories();
      toast('记住了');
    } catch (err) { if (err.message !== '401') toast(err.message); }
  });
  $('edit-delete').addEventListener('click', async () => {
    if (!editing || !confirm('删掉这条记忆？')) return;
    try {
      await api('/api/memories/' + editing.id, { method: 'DELETE' });
      memories = memories.filter((m) => m.id !== editing.id);
      closeSheets();
      renderMemories();
    } catch (err) { if (err.message !== '401') toast(err.message); }
  });

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    token = '';
    page.classList.remove('open');
    page.classList.add('hidden');
    showLogin();
  }
  $('logout').addEventListener('click', logout);
  $('plus-btn').addEventListener('click', () => openEditor(null));

  // 输入框高度 -> 消息区留白
  const wrap = $('composer-wrap');
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--composer-h', wrap.offsetHeight + 12 + 'px');
  }).observe(wrap);

  // 回到底部按钮
  scroller.addEventListener('scroll', () => {
    $('to-bottom').classList.toggle('hidden', atBottom());
  }, { passive: true });
  $('to-bottom').addEventListener('click', () => scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }));

  // 语音输入（浏览器支持才显示）
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const mic = $('mic-btn');
    mic.classList.remove('hidden');
    let rec = null;
    mic.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      const base = input.value;
      rec.onresult = (e) => {
        let t = '';
        for (const r of e.results) t += r[0].transcript;
        input.value = base + t;
        autosize();
      };
      rec.onend = rec.onerror = () => { mic.classList.remove('on'); rec = null; };
      mic.classList.add('on');
      rec.start();
    });
  }

  // ---------- 启动 ----------
  if (token) showChat().catch(() => {});
  else showLogin();
})();
