/* Anonyms frontend — Google Apps Script API only. No Supabase SDK or credentials. */
(() => {
  'use strict';
  // Paste the deployed Apps Script Web App URL ending in /exec here.
  const API_URL = 'PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE';
  const $ = id => document.getElementById(id);
  const state = { token: sessionStorage.getItem('anonyms_token') || '', user: sessionStorage.getItem('anonyms_user') || '', messages: [], newest: '', before: '', gallery: [], busy: false };
  const EMOJIS = ['❤️','😀','😃','😄','😁','😆','😂','🤣','😊','😉','😍','🥰','😘','😎','🥳','😏','😔','🥺','😢','😭','😤','😡','🤯','😳','😱','🤗','🤔','😶','🙄','😮','😴','🤒','🫠','🫡','🫣','🫤','👍','🙏','✨','💖','💗','💞','🌹','🫶','🔥','🎉'];
  let pollTimer = null, statusTimer = null;

  function banner(message) { $('banner').textContent = message; $('banner').hidden = !message; }
  function loginError(message) { $('login-error').textContent = message; $('login-error').hidden = !message; }
  function apiConfigured() { return API_URL.startsWith('https://script.google.com/macros/s/') && API_URL.endsWith('/exec'); }

  // Apps Script web apps have cross-origin restrictions. Submit POST requests to a hidden iframe;
  // the iframe responds with a nonce-tagged postMessage. Only the exact iframe source is accepted.
  function post(action, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!apiConfigured()) return reject(new Error('Set API_URL in script.js to your deployed Google Apps Script URL first.'));
      const nonce = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^a-zA-Z0-9_-]/g, '');
      const frame = document.createElement('iframe');
      frame.name = 'anonyms-frame-' + nonce;
      frame.title = 'Anonyms secure API request';
      frame.hidden = true;
      const form = document.createElement('form');
      form.method = 'POST'; form.action = API_URL; form.target = frame.name; form.hidden = true;
      const fields = { action, nonce, payload: JSON.stringify(payload) };
      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.appendChild(input);
      });
      let finished = false;
      const cleanup = () => { window.removeEventListener('message', onMessage); form.remove(); frame.remove(); clearTimeout(timeout); };
      const timeout = setTimeout(() => { if (!finished) { finished = true; cleanup(); reject(new Error('Google backend timed out. Check the Web App deployment and try again.')); } }, 30000);
      const onMessage = event => {
        if (event.source !== frame.contentWindow || event.data?.type !== 'anonyms-api' || event.data?.nonce !== nonce) return;
        if (finished) return;
        finished = true; cleanup();
        const result = event.data.result;
        if (!result?.ok) reject(new Error(result?.error || 'Request failed.'));
        else resolve(result);
      };
      window.addEventListener('message', onMessage);
      document.body.append(frame, form);
      form.submit();
    });
  }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); loginError('');
    const username = $('username').value.trim(), password = $('password').value;
    $('login-btn').disabled = true;
    try {
      const result = await post('login', { username, password });
      state.token = result.token; state.user = result.user;
      sessionStorage.setItem('anonyms_token', state.token); sessionStorage.setItem('anonyms_user', state.user);
      $('password').value = ''; await openApp();
    } catch (error) { loginError(error.message); }
    finally { $('login-btn').disabled = false; }
  });

  async function openApp() {
    $('login-screen').hidden = true; $('app-screen').hidden = false;
    $('conn-status').textContent = 'Connected as ' + state.user; $('conn-status').dataset.state = 'online';
    await Promise.all([loadMessages(true), loadGallery(), loadStatus()]);
    clearInterval(pollTimer); clearInterval(statusTimer);
    pollTimer = setInterval(() => { if (!document.hidden) loadMessages(false).catch(showApiError); }, 4000);
    statusTimer = setInterval(() => { if (!document.hidden) { post('touch', {token: state.token}).catch(()=>{}); loadStatus().catch(()=>{}); } }, 15000);
  }

  function showApiError(error) { banner(error.message || 'Something went wrong.'); }
  async function logout() {
    clearInterval(pollTimer); clearInterval(statusTimer);
    try { await post('logout', { token: state.token }); } catch (_) {}
    state.token = ''; state.user = ''; state.messages = []; state.gallery = []; state.newest = ''; state.before = '';
    sessionStorage.removeItem('anonyms_token'); sessionStorage.removeItem('anonyms_user');
    $('app-screen').hidden = true; $('login-screen').hidden = false; $('message-list').replaceChildren(); $('gallery-grid').replaceChildren(); banner('');
  }
  $('logout-btn').addEventListener('click', logout);

  async function loadMessages(initial) {
    const result = await post('messages', { token: state.token, limit: 200, before: '' });
    if (initial) {
      state.messages = result.messages || []; state.newest = state.messages.length ? state.messages[state.messages.length - 1].created_at : '';
      state.before = state.messages.length ? state.messages[0].created_at : '';
      renderMessages(); return;
    }
    const fresh = (result.messages || []).filter(m => !state.messages.some(old => old.id === m.id));
    if (!fresh.length) return;
    const scroller = $('messages'), nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
    state.messages.push(...fresh); state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    state.newest = state.messages[state.messages.length - 1].created_at; state.before = state.messages[0].created_at;
    renderMessages();
    if (nearBottom || fresh.some(m => m.username === state.user)) scroller.scrollTop = scroller.scrollHeight;
  }
  $('load-earlier').addEventListener('click', async () => {
    if (!state.before) return;
    $('load-earlier').disabled = true;
    try {
      const result = await post('messages', { token: state.token, limit: 200, before: state.before });
      const old = result.messages || [];
      const ids = new Set(state.messages.map(m => m.id));
      const unique = old.filter(m => !ids.has(m.id));
      if (unique.length) { state.messages.unshift(...unique); state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at)); state.before = state.messages[0].created_at; renderMessages(); }
      if (old.length < 200) $('load-earlier').hidden = true;
    } catch (e) { banner(e.message); } finally { $('load-earlier').disabled = false; }
  });

  function dayKey(value) { const d = new Date(value); return [d.getFullYear(), d.getMonth(), d.getDate()].join('-'); }
  function dateLabel(value) {
    const d = new Date(value), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    if (dayKey(value) === dayKey(today)) return 'Today';
    if (dayKey(value) === dayKey(tomorrow)) return 'Tomorrow';
    if (dayKey(value) === dayKey(yesterday)) return 'Yesterday';
    return d.toLocaleDateString([], {weekday:'short', day:'numeric', month:'short', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined});
  }
  function timeLabel(value) { return new Date(value).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); }
  function separator(label, cls) { const wrap = document.createElement('div'); wrap.className = cls; const span = document.createElement('span'); span.textContent = label; wrap.append(span); return wrap; }
  function renderMessages() {
    const list = $('message-list'); list.replaceChildren();
    let previous = null;
    state.messages.forEach(m => {
      if (!previous || dayKey(m.created_at) !== dayKey(previous.created_at)) list.append(separator(dateLabel(m.created_at), 'day-sep'));
      else if ((new Date(m.created_at) - new Date(previous.created_at)) >= 5 * 60 * 1000) list.append(separator(timeLabel(m.created_at), 'time-gap-sep'));
      const row = document.createElement('div');
      row.className = 'row ' + (m.username === state.user ? 'mine' : 'theirs') + (!previous || previous.username !== m.username || dayKey(m.created_at) !== dayKey(previous.created_at) ? ' first' : '');
      row.dataset.id = m.id;
      const bubble = document.createElement('div'); bubble.className = 'bubble';
      const text = document.createElement('p'); text.className = 'text'; text.textContent = m.message;
      const time = document.createElement('time'); time.className = 'time'; time.dateTime = m.created_at; time.textContent = timeLabel(m.created_at);
      bubble.append(text, time); row.append(bubble); list.append(row); previous = m;
    });
    $('empty-state').hidden = state.messages.length > 0;
    $('load-earlier').hidden = state.messages.length < 200;
  }

  $('composer').addEventListener('submit', async event => {
    event.preventDefault(); const input = $('message-input'), message = input.value.trim();
    if (!message || state.busy) return;
    state.busy = true; $('send-btn').disabled = true;
    try { await post('sendMessage', {token:state.token, message}); input.value = ''; input.style.height = 'auto'; await loadMessages(false); $('messages').scrollTop = $('messages').scrollHeight; banner(''); }
    catch (error) { banner(error.message); }
    finally { state.busy = false; $('send-btn').disabled = false; input.focus(); }
  });
  $('message-input').addEventListener('input', () => { const el = $('message-input'); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; });
  $('message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
  $('emoji-btn').addEventListener('click', () => {
    const panel = $('emoji-panel'); panel.hidden = !panel.hidden;
    if (!panel.childElementCount) EMOJIS.forEach(emoji => { const b = document.createElement('button'); b.type = 'button'; b.textContent = emoji; b.addEventListener('click', () => { const input = $('message-input'); input.value += emoji; input.dispatchEvent(new Event('input')); input.focus(); }); panel.append(b); });
  });
  document.addEventListener('click', event => { if (!event.target.closest('#emoji-panel') && !event.target.closest('#emoji-btn')) $('emoji-panel').hidden = true; });

  $('chat-tab').addEventListener('click', () => setView('chat'));
  $('gallery-tab').addEventListener('click', () => { setView('gallery'); loadGallery().catch(showApiError); });
  function setView(which) {
    const gallery = which === 'gallery'; $('chat-view').hidden = gallery; $('gallery-view').hidden = !gallery;
    $('chat-tab').classList.toggle('active', !gallery); $('gallery-tab').classList.toggle('active', gallery);
  }
  async function loadStatus() {
    const result = await post('status', {token:state.token});
    const peer = result.peer || {};
    $('conn-status').textContent = peer.username + (peer.online ? ' · online' : peer.last_seen ? ' · last seen ' + timeLabel(peer.last_seen) : ' · offline');
    $('conn-status').dataset.state = peer.online ? 'online' : 'idle';
  }

  async function loadGallery() {
    $('gallery-message').textContent = 'Loading your memories…';
    const result = await post('gallery', {token:state.token});
    state.gallery = result.items || []; $('gallery-count').textContent = state.gallery.length;
    renderGallery();
  }
  function renderGallery() {
    const grid = $('gallery-grid'); grid.replaceChildren();
    $('gallery-message').textContent = state.gallery.length ? state.gallery.length + ' shared memories' : 'Your gallery is waiting for its first memory.';
    state.gallery.forEach(item => {
      const card = document.createElement('article'); card.className = 'gallery-card';
      const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'gallery-preview'; preview.setAttribute('aria-label', 'Open ' + (item.title || 'media'));
      if (item.source === 'youtube') {
        const img = document.createElement('img'); img.loading = 'lazy'; img.alt = ''; img.src = 'https://img.youtube.com/vi/' + encodeURIComponent(item.youtube_id) + '/hqdefault.jpg'; preview.append(img);
        const badge = document.createElement('span'); badge.className = 'media-type-badge'; badge.textContent = '▶ VIDEO'; preview.append(badge);
      } else if (item.media_type === 'image') {
        const img = document.createElement('img'); img.loading = 'lazy'; img.alt = item.title || 'Shared photo'; img.src = item.media_url || ('https://drive.google.com/uc?export=view&id=' + encodeURIComponent(item.drive_file_id)); preview.append(img);
      } else {
        const cover = document.createElement('div'); cover.className = 'video-placeholder'; cover.textContent = '▶'; preview.append(cover);
        const badge = document.createElement('span'); badge.className = 'media-type-badge'; badge.textContent = '▶ VIDEO'; preview.append(badge);
      }
      preview.addEventListener('click', () => openMedia(item));
      const details = document.createElement('div'); details.className = 'gallery-card-details';
      const title = document.createElement('h3'); title.textContent = item.title || (item.media_type === 'image' ? 'Photo' : 'Video');
      const caption = document.createElement('p'); caption.textContent = item.caption || '';
      const meta = document.createElement('small'); meta.textContent = (item.uploader || '') + ' · ' + new Date(item.created_at).toLocaleDateString();
      details.append(title, caption, meta); card.append(preview, details); grid.append(card);
    });
  }
  function openMedia(item) {
    const stage = $('media-stage'); stage.replaceChildren(); $('media-caption').textContent = (item.title || '') + (item.caption ? ' — ' + item.caption : '');
    if (item.source === 'youtube') {
      const frame = document.createElement('iframe'); frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(item.youtube_id) + '?autoplay=1&playsinline=1'; frame.title = item.title || 'YouTube video'; frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; frame.allowFullscreen = true; stage.append(frame);
    } else if (item.media_type === 'image') {
      const img = document.createElement('img'); img.src = item.media_url || ('https://drive.google.com/uc?export=view&id=' + encodeURIComponent(item.drive_file_id)); img.alt = item.title || 'Shared image'; stage.append(img);
    } else {
      const frame = document.createElement('iframe'); frame.src = item.preview_url || ('https://drive.google.com/file/d/' + encodeURIComponent(item.drive_file_id) + '/preview'); frame.title = item.title || 'Shared video'; frame.allow = 'autoplay'; frame.allowFullscreen = true; stage.append(frame);
    }
    $('media-modal').hidden = false;
  }
  function closeMedia() { $('media-modal').hidden = true; $('media-stage').replaceChildren(); }
  $('close-media').addEventListener('click', closeMedia);
  $('media-modal').addEventListener('click', event => { if (event.target === $('media-modal')) closeMedia(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMedia(); });
  $('refresh-gallery').addEventListener('click', () => loadGallery().catch(showApiError));
  $('open-upload').addEventListener('click', () => { $('upload-panel').hidden = !$('upload-panel').hidden; });

  async function uploadFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { $('upload-status').textContent = 'Only photos and videos are supported.'; continue; }
      if (file.size > 8 * 1024 * 1024) { $('upload-status').textContent = file.name + ' is over the 8 MB limit.'; continue; }
      $('upload-status').textContent = 'Uploading ' + file.name + '…';
      try {
        const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read file.')); reader.readAsDataURL(file); });
        await post('uploadMedia', {token:state.token, filename:file.name, mime_type:file.type, base64, title:file.name.replace(/\.[^.]+$/, '')});
        $('upload-status').textContent = 'Uploaded ' + file.name;
      } catch (error) { $('upload-status').textContent = error.message; }
    }
    $('media-files').value = ''; await loadGallery();
  }
  $('media-files').addEventListener('change', event => uploadFiles(Array.from(event.target.files || [])));
  const drop = $('drop-zone');
  ['dragenter','dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', event => uploadFiles(Array.from(event.dataTransfer.files || [])));
  $('save-youtube').addEventListener('click', async () => {
    const url = $('youtube-url').value.trim(); if (!url) { $('upload-status').textContent = 'Paste a YouTube link first.'; return; }
    $('save-youtube').disabled = true; $('upload-status').textContent = 'Adding video…';
    try { await post('addYoutube', {token:state.token, url, title:$('youtube-title').value.trim(), caption:$('youtube-caption').value.trim()}); $('youtube-url').value = ''; $('youtube-title').value = ''; $('youtube-caption').value = ''; $('upload-status').textContent = 'Added to gallery.'; await loadGallery(); }
    catch (error) { $('upload-status').textContent = error.message; }
    finally { $('save-youtube').disabled = false; }
  });

  // Restore session only after the backend verifies it.
  if (state.token && state.user) {
    post('whoami', {token:state.token}).then(openApp).catch(() => { state.token = ''; state.user = ''; sessionStorage.removeItem('anonyms_token'); sessionStorage.removeItem('anonyms_user'); });
  }
})();