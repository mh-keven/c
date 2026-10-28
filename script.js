/* Anonyms chat: direct Supabase RPC and signed Storage upload when configured. No service-role key in the browser. */
(() => {
  'use strict';
  // Paste the deployed Apps Script Web App URL ending in /exec here.
  const API_URL = 'https://script.google.com/macros/s/AKfycbyW_06rlpggyk054n43VbwYhgJarWsoV7CRR8iRm43Lvi_ghUKzSJeOJoM7t5pF6KcsAQ/exec';
  const $ = id => document.getElementById(id);
  const state = { token: sessionStorage.getItem('anonyms_token') || '', user: sessionStorage.getItem('anonyms_user') || '', supabaseUrl: sessionStorage.getItem('anonyms_supabase_url') || '', supabaseAnonKey: sessionStorage.getItem('anonyms_supabase_anon_key') || '', fastChatDisabled: false, messages: [], newest: '', before: '', gallery: [], busy: false, messagePolling: false, lastChatActivity: Date.now(), peerOnline: false, peerStatusInitialized: false, peerUsername: '', systemEvents: (() => { try { const saved = JSON.parse(localStorage.getItem('anonyms_system_events') || '[]'); return Array.isArray(saved) ? saved.filter(event => event && event.system && event.created_at).slice(-100) : []; } catch (_) { return []; } })(), recorder: null, recordingChunks: [], recordingStartedAt: 0, pendingGalleryFiles: [], localVoiceUrls: [] };
  const EMOJI_GROUPS = {
    smileys: [
      '❤️','😀','😃','😄','😁','😆','😅','😂','🤣','🥲','☺️','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🫣','🤭','🫢','🫡','🤫','🫠','🤥','😶','🫥','😐','🫤','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','😵‍💫','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','💀','☠️','🤡','👻','👽','🤖'
    ],
    hands: [
      '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🙏','✍️','💅','🤳','💪','🫶','🫂'
    ],
    hearts: [
      '🧡','💛','💚','💙','💜','🤎','🖤','🩶','🤍','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','♥️','❣️','🌹','🥀','💐','🌷','🌸','🌺','🌻','🌼','🪷','🪻'
    ],
    celebration: [
      '✨','⭐','🌟','💫','🔥','🎉','🎊','🎈','🎂','🎁','🏆','🥇','💯','✅','❣️','💋','👑','💍','💎','🪄','🎶','🎵','🎤','🎧','📸','📷','🎬','🎮','⚽','🏀','🏏','🚀','🌈','☀️','🌙','☕','🍰','🍕','🍟','🍫','🍓','🍉'
    ]
  };
  const EMOJI_RECENTS_KEY = 'anonyms_recent_emojis';
  let recentEmojis = [];
  try {
    const savedRecents = JSON.parse(localStorage.getItem(EMOJI_RECENTS_KEY) || '[]');
    if (Array.isArray(savedRecents)) recentEmojis = savedRecents.filter(item => typeof item === 'string').slice(0, 24);
  } catch (_) {}
  let emojiCategory = 'smileys';
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
      const timeout = setTimeout(() => { if (!finished) { finished = true; cleanup(); reject(new Error('Anonyms backend timed out. Please try again.')); } }, 20000);
      const onMessage = event => {
        if (event.data?.type !== 'anonyms-api' || event.data?.nonce !== nonce) return;
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

  function applySupabaseConfig(result) {
    state.supabaseUrl = String(result?.supabase_url || '').replace(/\/+$/, '');
    state.supabaseAnonKey = String(result?.supabase_anon_key || '');
    state.fastChatDisabled = false;
    if (state.supabaseUrl) sessionStorage.setItem('anonyms_supabase_url', state.supabaseUrl);
    else sessionStorage.removeItem('anonyms_supabase_url');
    if (state.supabaseAnonKey) sessionStorage.setItem('anonyms_supabase_anon_key', state.supabaseAnonKey);
    else sessionStorage.removeItem('anonyms_supabase_anon_key');
  }

  function hasDirectSupabaseConfig() {
    return !!(state.supabaseUrl && state.supabaseAnonKey && !state.fastChatDisabled);
  }

  async function sessionTokenHash() {
    if (!state.token || !crypto.subtle) throw new Error('Secure session hashing is not available in this browser.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state.token));
    let binary = '';
    new Uint8Array(digest).forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function fastSupabaseRpc(name, args) {
    const response = await fetch(state.supabaseUrl + '/rest/v1/rpc/' + encodeURIComponent(name), {
      method: 'POST',
      headers: {
        apikey: state.supabaseAnonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args),
      cache: 'no-store'
    });
    const body = await response.text();
    if (!response.ok) throw new Error('Direct Supabase request failed (' + response.status + ').');
    return body ? JSON.parse(body) : null;
  }

  async function fetchChatMessages(options = {}) {
    if (hasDirectSupabaseConfig()) {
      try {
        const rows = await fastSupabaseRpc('anonyms_fast_messages', {
          p_token_hash: await sessionTokenHash(),
          p_before: options.before || null,
          p_after: options.after || null,
          p_limit: options.limit || 200
        });
        return (Array.isArray(rows) ? rows : []).map(row => ({
          id: row.id, username: row.username, message: row.message || '',
          created_at: row.created_at, media_type: row.media_type || 'text',
          media_id: row.media_path || '', media_url: '', media_mime: '',
          duration_seconds: row.duration_seconds || ''
        }));
      } catch (error) {
        // Don't double every poll if SQL setup or public-key configuration isn't ready yet.
        state.fastChatDisabled = true;
        console.warn('Direct Supabase chat is unavailable; using the existing backend path.', error);
      }
    }
    const result = await post('messages', {
      token: state.token, limit: options.limit || 200,
      before: options.before || '', after: options.after || ''
    });
    return result.messages || [];
  }

  async function sendChatMessage(message) {
    if (hasDirectSupabaseConfig()) {
      try {
        const row = await fastSupabaseRpc('anonyms_fast_send', {
          p_token_hash: await sessionTokenHash(),
          p_message: message
        });
        return {ok:true, message:row};
      } catch (error) {
        state.fastChatDisabled = true;
        console.warn('Direct Supabase send is unavailable; using the existing backend path.', error);
      }
    }
    return post('sendMessage', {token:state.token, message});
  }

  async function hydrateAudioUrls(messages) {
    const paths = Array.from(new Set(messages
      .filter(message => message.media_type === 'audio' && message.media_id && !message.media_url)
      .map(message => message.media_id)));
    for (let i = 0; i < paths.length; i += 50) {
      const result = await post('signAudioPaths', {token:state.token, paths:paths.slice(i, i + 50)});
      const urls = result.urls || {};
      messages.forEach(message => {
        if (urls[message.media_id]) message.media_url = urls[message.media_id];
      });
    }
    return messages;
  }

  async function sendVoiceBlob(blob, filename, duration) {
    const mime = blob.type || 'audio/webm';
    if (state.supabaseUrl && state.supabaseAnonKey) {
      // Browser uploads audio bytes straight to private Supabase Storage; the
      // signed URL is short-lived and scoped to a single object path.
      const prepared = await post('createVoiceUpload', {
        token:state.token, filename, mime_type:mime, duration_seconds:duration
      });
      // Supabase signed uploads expect the audio file bytes as the request body.
      // Wrapping the blob in FormData stores multipart boundaries alongside the audio,
      // which can break playback and adds unnecessary transfer overhead.
      const response = await fetch(prepared.upload_url, {
        method:'PUT',
        headers:{apikey:state.supabaseAnonKey, 'Content-Type':mime.split(';')[0], 'x-upsert':'false'},
        body:blob,
        cache:'no-store'
      });
      if (!response.ok) throw new Error('Supabase Storage upload failed (' + response.status + ').');
      try {
        const result = await fastSupabaseRpc('anonyms_fast_send_voice', {
          p_token_hash: await sessionTokenHash(),
          p_media_path: prepared.path,
          p_mime_type: mime.split(';')[0].toLowerCase(),
          p_duration_seconds: duration
        });
        return {ok:true, message:result?.message || result};
      } catch (error) {
        // Compatibility fallback if the optional fast-voice SQL migration has not been applied yet.
        if (!String(error.message || '').includes('(404)')) throw error;
        console.warn('Fast voice RPC is not installed; using the Apps Script finalizer.', error);
        return post('finalizeVoiceNote', {token:state.token, path:prepared.path, mime_type:mime, duration_seconds:duration});
      }
    }

    // Safe compatibility path for deployments that have not configured the public anon key yet.
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read the voice note.'));
      reader.readAsDataURL(blob);
    });
    return post('sendVoiceNote', {token:state.token, filename, mime_type:mime, size:blob.size, base64, duration_seconds:duration});
  }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); loginError('');
    const enteredUsername = $('username').value.trim();
    const password = $('password').value;
    const normalizedUsername = enteredUsername.toLowerCase();
    const username = normalizedUsername === 'zek123' ? 'Keven' : normalizedUsername === 'zubii' ? 'Zubii' : enteredUsername;
    $('login-btn').disabled = true;
    try {
      const result = await post('login', { username, password });
      state.token = result.token; state.user = result.user;
      applySupabaseConfig(result);
      sessionStorage.setItem('anonyms_token', state.token); sessionStorage.setItem('anonyms_user', state.user);
      $('password').value = ''; await openApp();
    } catch (error) { loginError(error.message); }
    finally { $('login-btn').disabled = false; }
  });

  async function openApp() {
    // Paint the app shell immediately; Sheets-backed data can hydrate afterward.
    $('login-screen').hidden = true;
    $('app-screen').hidden = false;
    $('conn-status').textContent = 'Connected as ' + state.user;
    $('conn-status').dataset.state = 'online';
    addSystemEvent(state.user);
    $('gallery-message').textContent = 'Loading your memories…';
    $('messages').setAttribute('aria-busy', 'true');
    clearTimeout(pollTimer); clearInterval(statusTimer);
    // Sync the Supabase session after displaying the app; avoid blocking login on that network call.
    post('syncSession', {token:state.token}).then(() => { state.fastChatDisabled = false; if (state.token) { scheduleMessagePoll(50); loadMessages(true).catch(showApiError); } }).catch(error => { console.warn('Supabase session sync unavailable; using Apps Script chat.', error); scheduleMessagePoll(50); loadMessages(true).catch(showApiError); });
    statusTimer = setInterval(async () => {
      if (!document.hidden && state.token) {
        try { await post('touch', {token: state.token}); await loadStatus(); } catch (_) {}
      }
    }, 8000);
    // Do not block the visible page on slow Google Sheets calls.
    // Message hydration starts after background session sync.
    loadGallery().catch(error => {
      $('gallery-message').textContent = 'Could not load gallery. Tap Refresh to retry.';
      console.warn('Gallery load failed', error);
    });
    loadStatus().catch(() => {});
  }

  function showApiError(error) { banner(error.message || 'Something went wrong.'); }

  function scheduleMessagePoll(delay = 500) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!state.token) return;
      if (document.hidden) { scheduleMessagePoll(1500); return; }
      try {
        await loadMessages(false);
        scheduleMessagePoll(500);
      } catch (error) {
        // Back off briefly on transient errors rather than hammering the backend.
        scheduleMessagePoll(1600);
      }
    }, delay);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.token) scheduleMessagePoll(50);
  });

  function syncComposerActions() {
    const hasText = !!$('message-input').value.trim();
    $('send-btn').hidden = !hasText;
    $('voice-note-btn').hidden = hasText;
  }
  async function logout() {
    clearTimeout(pollTimer); clearInterval(statusTimer);
    const oldToken = state.token;
    // Leave the app instantly; server-side session cleanup is best-effort in the background.
    state.token = ''; state.user = ''; state.messages = []; state.systemEvents = []; state.peerStatusInitialized = false; state.peerOnline = false; state.gallery = []; state.newest = ''; state.before = '';
    sessionStorage.removeItem('anonyms_token'); sessionStorage.removeItem('anonyms_user');
    sessionStorage.removeItem('anonyms_supabase_url'); sessionStorage.removeItem('anonyms_supabase_anon_key');
    state.supabaseUrl = ''; state.supabaseAnonKey = ''; state.fastChatDisabled = false;
    $('app-screen').hidden = true; $('login-screen').hidden = false;
    $('message-list').replaceChildren(); $('gallery-grid').replaceChildren(); banner('');
    if (oldToken) post('logout', { token: oldToken }).catch(() => {});
  }
  $('logout-btn').addEventListener('click', logout);
  syncComposerActions();

  function hydrateAudioInBackground(messages) {
    const pending = messages.filter(message => message.media_type === 'audio' && message.media_id && !message.media_url);
    if (!pending.length) return;
    hydrateAudioUrls(pending).then(() => {
      const hydratedIds = new Set(pending.filter(message => message.media_url).map(message => message.id));
      if (!hydratedIds.size || !state.messages.some(message => hydratedIds.has(message.id))) return;
      const scroller = $('messages');
      const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
      const previousHeight = scroller.scrollHeight;
      const previousTop = scroller.scrollTop;
      renderMessages();
      if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
      else scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
    }).catch(error => console.warn('Could not load voice-note playback links yet.', error));
  }

  function scrollChatToLatest() {
    const scroller = $('messages');
    const previousBehavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = 'auto';
    scroller.scrollTop = scroller.scrollHeight;
    requestAnimationFrame(() => { scroller.style.scrollBehavior = previousBehavior; });
  }

  async function loadMessages(initial) {
    if (!initial && state.messagePolling) return false;
    state.messagePolling = true;
    try {
      const received = await fetchChatMessages({
        limit:200,
        before:initial ? '' : '',
        after:initial ? '' : state.newest
      });
      if (initial) {
        state.messages = received;
        state.newest = state.messages.length ? state.messages[state.messages.length - 1].created_at : '';
        state.before = state.messages.length ? state.messages[0].created_at : '';
        renderMessages();
        // WhatsApp-style initial view: show the newest message instead of the top of history.
        scrollChatToLatest();
        hydrateAudioInBackground(received);
        return false;
      }

      // Move the cursor from persisted server rows only—not optimistic local messages.
      for (const message of received) {
        if (!state.newest || String(message.created_at) > String(state.newest)) state.newest = message.created_at;
      }
      const known = new Set(state.messages.map(old => old.id));
      const fresh = received.filter(message => !known.has(message.id));
      if (!fresh.length) return false;

      const scroller = $('messages');
      const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
      state.messages.push(...fresh);
      state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
      state.before = state.messages.length ? state.messages[0].created_at : '';
      state.lastChatActivity = Date.now();
      renderMessages();
      if (nearBottom || fresh.some(message => message.username === state.user)) scroller.scrollTop = scroller.scrollHeight;
      hydrateAudioInBackground(fresh);
      return true;
    } finally { state.messagePolling = false; }
  }
  $('load-earlier').addEventListener('click', async () => {
    if (!state.before) return;
    $('load-earlier').disabled = true;
    try {
      const scroller = $('messages');
      const previousHeight = scroller.scrollHeight;
      const previousTop = scroller.scrollTop;
      const old = await fetchChatMessages({before:state.before, limit:200});
      const ids = new Set(state.messages.map(m => m.id));
      const unique = old.filter(m => !ids.has(m.id));
      if (unique.length) {
        state.messages.unshift(...unique);
        state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
        state.before = state.messages[0].created_at;
        renderMessages();
        const previousBehavior = scroller.style.scrollBehavior;
        scroller.style.scrollBehavior = 'auto';
        scroller.scrollTop = previousTop + (scroller.scrollHeight - previousHeight);
        requestAnimationFrame(() => { scroller.style.scrollBehavior = previousBehavior; });
        hydrateAudioInBackground(unique);
      }
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
  function addSystemEvent(username) {
    state.systemEvents.push({id:'system-' + Date.now() + '-' + Math.random().toString(36).slice(2), system:true, username, message:username + ' is online', created_at:new Date().toISOString()});
    state.systemEvents = state.systemEvents.slice(-100);
    try { localStorage.setItem('anonyms_system_events', JSON.stringify(state.systemEvents)); } catch (_) {}
    renderMessages();
    $('empty-state').hidden = true;
    $('messages').scrollTop = $('messages').scrollHeight;
  }
  function renderMessages() {
    const list = $('message-list'); list.replaceChildren();
    let previous = null;
    const displayMessages = [...state.messages, ...state.systemEvents].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    displayMessages.forEach(m => {
      if (m.system) {
        const noticeRow = document.createElement('div');
        noticeRow.className = 'system-event-row';
        const notice = separator(m.message + ' · ' + timeLabel(m.created_at), 'system-event');
        noticeRow.append(notice);
        list.append(noticeRow);
        previous = m;
        return;
      }
      if (!previous || dayKey(m.created_at) !== dayKey(previous.created_at)) list.append(separator(dateLabel(m.created_at), 'day-sep'));
      else if ((new Date(m.created_at) - new Date(previous.created_at)) >= 5 * 60 * 1000) list.append(separator(timeLabel(m.created_at), 'time-gap-sep'));
      const row = document.createElement('div');
      row.className = 'row ' + (m.username === state.user ? 'mine' : 'theirs') + (!previous || previous.username !== m.username || dayKey(m.created_at) !== dayKey(previous.created_at) ? ' first' : '') + (m.pending ? ' pending' : '');
      row.dataset.id = m.id;
      const bubble = document.createElement('div'); bubble.className = 'bubble';
      if (m.media_type === 'audio' && m.media_url) {
        const label = document.createElement('p'); label.className = 'text'; label.textContent = 'Voice note';
        const voice = document.createElement('div'); voice.className = 'voice';
        const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = m.media_url; audio.setAttribute('aria-label', 'Voice note from ' + m.username);
        voice.append(audio); bubble.append(label, voice);
      } else {
        const text = document.createElement('p'); text.className = 'text'; text.textContent = m.message;
        bubble.append(text);
      }
      const time = document.createElement('time'); time.className = 'time'; time.dateTime = m.created_at; time.textContent = timeLabel(m.created_at);
      bubble.append(time);
      if (m.username === state.user && !m.pending && m.id) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-message-btn';
        deleteBtn.textContent = '🗑';
        deleteBtn.title = 'Delete message';
        deleteBtn.setAttribute('aria-label', 'Delete your message');
        deleteBtn.addEventListener('click', async () => {
          const deletedMessage = m;
          state.messages = state.messages.filter(message => String(message.id) !== String(deletedMessage.id));
          renderMessages();
          try {
            if (hasDirectSupabaseConfig()) {
              try {
                const deleted = await fastSupabaseRpc('anonyms_fast_delete', {p_token_hash: await sessionTokenHash(), p_message_id: deletedMessage.id});
                // PostgreSQL returns false when no row matched the session/user/message.
                // Treat that as a failed delete so the authenticated backend fallback runs.
                if (deleted !== true) throw new Error('Supabase did not confirm message deletion.');
              } catch (directError) {
                // Keep deletion working even before the optional direct-chat SQL migration is applied.
                await post('deleteMessage', {token:state.token, message_id:deletedMessage.id});
              }
            } else {
              await post('deleteMessage', {token:state.token, message_id:deletedMessage.id});
            }
            banner('');
          } catch (error) {
            state.messages.push(deletedMessage);
            state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
            renderMessages();
            banner('Could not delete message: ' + error.message + '. If fast-chat SQL was just updated, run the latest migration in Supabase.');
          }
        });
        row.append(deleteBtn);
      }
      row.append(bubble); list.append(row); previous = m;
    });
    $('empty-state').hidden = state.messages.length + state.systemEvents.length > 0;
    $('load-earlier').hidden = state.messages.length < 200;
  }

  $('composer').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('message-input'), message = input.value.trim();
    if (!message || state.busy) return;
    state.busy = true; $('send-btn').disabled = true;
    const pendingId = 'pending-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    state.messages.push({id:pendingId,username:state.user,message,created_at:new Date().toISOString(),media_type:'text'});
    state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    input.value = ''; input.style.height = 'auto'; syncComposerActions(); renderMessages(); $('messages').scrollTop = $('messages').scrollHeight;
    try {
      const result = await sendChatMessage(message);
      state.messages = state.messages.filter(m => m.id !== pendingId);
      if (result.message && !state.messages.some(m => m.id === result.message.id)) state.messages.push(result.message);
      state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
      state.lastChatActivity = Date.now();
      renderMessages(); $('messages').scrollTop = $('messages').scrollHeight; banner('');
      scheduleMessagePoll(50);
    } catch (error) {
      state.messages = state.messages.filter(m => m.id !== pendingId);
      if (!input.value) input.value = message;
      syncComposerActions(); renderMessages(); banner(error.message);
    } finally { state.busy = false; $('send-btn').disabled = false; input.focus(); }
  });
  $('message-input').addEventListener('input', () => { const el = $('message-input'); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; state.lastChatActivity = Date.now(); syncComposerActions(); });
  $('message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
  function insertEmoji(emoji) {
    const input = $('message-input');
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.setRangeText(emoji, start, end, 'end');
    input.dispatchEvent(new Event('input'));
    input.focus();
    recentEmojis = [emoji, ...recentEmojis.filter(item => item !== emoji)].slice(0, 24);
    try { localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(recentEmojis)); } catch (_) {}
    renderEmojiPanel();
  }
  function makeEmojiButton(emoji, extraClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = extraClass || '';
    button.textContent = emoji;
    button.setAttribute('aria-label', 'Insert ' + emoji);
    button.addEventListener('click', () => insertEmoji(emoji));
    return button;
  }
  function renderEmojiPanel() {
    const panel = $('emoji-panel');
    panel.replaceChildren();

    const recentSection = document.createElement('section');
    recentSection.className = 'emoji-recent';
    const recentTitle = document.createElement('p');
    recentTitle.className = 'emoji-section-title';
    recentTitle.textContent = 'RECENT';
    const recentGrid = document.createElement('div');
    recentGrid.className = 'emoji-recent-list';
    recentGrid.setAttribute('aria-label', 'Recently used emojis');
    if (recentEmojis.length) recentEmojis.forEach(emoji => recentGrid.append(makeEmojiButton(emoji)));
    else {
      const hint = document.createElement('span');
      hint.className = 'emoji-empty';
      hint.textContent = 'Emojis you use will appear here';
      recentGrid.append(hint);
    }
    recentSection.append(recentTitle, recentGrid);
    panel.append(recentSection);

    const tabs = document.createElement('div');
    tabs.className = 'emoji-tabs';
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Emoji categories');
    const categories = [
      ['Smileys', 'smileys'], ['Hands', 'hands'], ['Hearts & flowers', 'hearts'], ['Fun', 'celebration']
    ];
    categories.forEach(([label, key]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'emoji-tab' + (emojiCategory === key ? ' active' : '');
      button.textContent = label;
      button.setAttribute('aria-pressed', String(emojiCategory === key));
      button.addEventListener('click', () => { emojiCategory = key; renderEmojiPanel(); });
      tabs.append(button);
    });
    panel.append(tabs);

    const grid = document.createElement('div');
    grid.className = 'emoji-grid';
    grid.setAttribute('aria-label', categories.find(item => item[1] === emojiCategory)?.[0] || 'Emojis');
    (EMOJI_GROUPS[emojiCategory] || EMOJI_GROUPS.smileys).forEach(emoji => grid.append(makeEmojiButton(emoji)));
    panel.append(grid);
  }
  $('emoji-btn').addEventListener('click', () => {
    const panel = $('emoji-panel');
    panel.hidden = !panel.hidden;
    $('emoji-btn').setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) renderEmojiPanel();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#emoji-panel') && !event.target.closest('#emoji-btn')) {
      $('emoji-panel').hidden = true;
      $('emoji-btn').setAttribute('aria-expanded', 'false');
    }
  });

  $('voice-note-btn').addEventListener('click', async () => {
    const button = $('voice-note-btn');
    if (state.recorder && state.recorder.state === 'recording') {
      state.recorder.stop();
      button.disabled = true;
      button.textContent = '…';
      button.title = 'Sending voice note';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      banner('Voice notes are not supported by this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      state.recordingChunks = [];
      state.recordingStartedAt = Date.now();
      state.recorder = new MediaRecorder(stream, { ...(mimeType ? {mimeType} : {}), audioBitsPerSecond: 24000 });
      state.recorder.ondataavailable = event => { if (event.data?.size) state.recordingChunks.push(event.data); };
      state.recorder.onerror = () => { stream.getTracks().forEach(track => track.stop()); button.disabled = false; button.classList.remove('recording'); button.textContent = '🎙️'; banner('Could not record voice note.'); };
      state.recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const duration = Math.max(1, Math.round((Date.now() - state.recordingStartedAt) / 1000));
        const blob = new Blob(state.recordingChunks, {type: state.recorder.mimeType || 'audio/webm'});
        state.recordingChunks = [];
        button.disabled = true;
        const localUrl = blob.size ? URL.createObjectURL(blob) : '';
        const pendingId = 'pending-voice-' + Date.now();
        try {
          const maxVoiceBytes = 8 * 1024 * 1024;
          if (!blob.size || blob.size > maxVoiceBytes) throw new Error('Voice note is too large. Please record a shorter note and try again.');
          const pendingMessage = {
            id:pendingId, username:state.user, message:'Voice note', created_at:new Date().toISOString(),
            media_type:'audio', media_id:'', media_url:localUrl, media_mime:blob.type || 'audio/webm',
            duration_seconds:duration, pending:true
          };
          state.localVoiceUrls.push(localUrl);
          state.messages.push(pendingMessage);
          state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
          renderMessages();
          $('messages').scrollTop = $('messages').scrollHeight;
          banner('Sending voice note…');
          const filename = 'voice-note-' + Date.now() + (blob.type.includes('ogg') ? '.ogg' : blob.type.includes('mp4') ? '.m4a' : '.webm');
          const result = await sendVoiceBlob(blob, filename, duration);
          state.messages = state.messages.filter(message => message.id !== pendingId);
          if (result.message) {
            result.message.media_url = localUrl;
            result.message.media_id = result.message.media_id || result.message.media_path || '';
            result.message.pending = false;
            if (!state.messages.some(message => message.id === result.message.id)) state.messages.push(result.message);
          }
          state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
          state.lastChatActivity = Date.now();
          renderMessages();
          $('messages').scrollTop = $('messages').scrollHeight;
          banner('');
          scheduleMessagePoll(50);
        } catch (error) {
          state.messages = state.messages.filter(message => message.id !== pendingId);
          if (localUrl) { URL.revokeObjectURL(localUrl); state.localVoiceUrls = state.localVoiceUrls.filter(url => url !== localUrl); }
          renderMessages();
          banner(error.message || 'Voice note failed to send.');
        } finally {
          button.disabled = false; button.classList.remove('recording'); button.textContent = '🎙️'; button.title = 'Record voice note'; button.setAttribute('aria-label','Record voice note'); state.recorder = null; syncComposerActions();
        }
      };
      state.recorder.start();
      button.classList.add('recording'); button.textContent = '■';
      button.title = 'Finish and send voice note';
      button.setAttribute('aria-label','Finish and send voice note');
      banner('Recording… Tap ■ to finish and send.');
    } catch (error) { banner(error.name === 'NotAllowedError' ? 'Allow microphone access to record a voice note.' : (error.message || 'Could not start recording.')); }
  });

  $('chat-tab').addEventListener('click', () => setView('chat'));
  $('gallery-tab').addEventListener('click', () => { setView('gallery'); loadGallery().catch(showApiError); });
  function setView(which) {
    const gallery = which === 'gallery'; $('chat-view').hidden = gallery; $('gallery-view').hidden = !gallery;
    $('chat-tab').classList.toggle('active', !gallery); $('gallery-tab').classList.toggle('active', gallery);
  }
  async function loadStatus() {
    const result = await post('status', {token:state.token});
    const peer = result.peer || {};
    state.peerUsername = peer.username || (state.user === 'Keven' ? 'Zubii' : 'Keven');
    const wasOnline = state.peerOnline;
    const isOnline = !!peer.online;
    if ((!state.peerStatusInitialized && isOnline) || (state.peerStatusInitialized && !wasOnline && isOnline)) addSystemEvent(state.peerUsername);
    state.peerOnline = isOnline;
    state.peerStatusInitialized = true;
    $('conn-status').textContent = state.peerUsername + (peer.online ? ' · online' : peer.last_seen ? ' · last seen ' + timeLabel(peer.last_seen) : ' · offline');
    $('conn-status').dataset.state = peer.online ? 'online' : 'offline';
  }


  // WebRTC video calls: only the other person's video is rendered. No mute/camera toggles.
  window.addEventListener('beforeunload', () => { state.localVoiceUrls.forEach(url => URL.revokeObjectURL(url)); });

  async function loadGallery() {
    $('gallery-message').textContent = 'Loading your memories…';
    const result = await post('gallery', {token:state.token});
    state.gallery = result.items || []; 
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
        const img = document.createElement('img'); img.loading = 'lazy'; img.alt = item.title || 'Shared photo'; const driveId = item.drive_file_id || '';
        // Prefer Drive's thumbnail endpoint for embedded gallery images; the uc=view
        // endpoint can return a non-image response for some Drive files.
        const imageSources = [
          'https://drive.google.com/thumbnail?id=' + encodeURIComponent(driveId) + '&sz=w1600',
          'https://lh3.googleusercontent.com/d/' + encodeURIComponent(driveId),
          'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(driveId)
        ];
        let imageSourceIndex = 0;
        img.src = imageSources[imageSourceIndex];
        img.addEventListener('error', () => {
          imageSourceIndex += 1;
          if (imageSourceIndex < imageSources.length) {
            img.src = imageSources[imageSourceIndex];
            return;
          }
          img.remove();
          const unavailable = document.createElement('span');
          unavailable.className = 'gallery-image-unavailable';
          unavailable.textContent = 'Photo unavailable — check Drive link sharing';
          preview.append(unavailable);
        });
        preview.append(img);
      } else {
        const cover = document.createElement('div'); cover.className = 'video-placeholder'; cover.textContent = '▶'; preview.append(cover);
        const badge = document.createElement('span'); badge.className = 'media-type-badge'; badge.textContent = '▶ VIDEO'; preview.append(badge);
      }
      preview.addEventListener('click', () => {
        if (item.media_type === 'image') {
          const driveId = item.drive_file_id || '';
          const imageUrl = driveId
            ? 'https://drive.google.com/file/d/' + encodeURIComponent(driveId) + '/view'
            : (item.media_url || item.preview_url || '');
          if (imageUrl) window.open(imageUrl, '_blank', 'noopener,noreferrer');
          else banner('This photo does not have an openable link.');
          return;
        }
        openMedia(item);
      });
      const details = document.createElement('div'); details.className = 'gallery-card-details';
      const title = document.createElement('h3'); title.textContent = item.title || (item.media_type === 'image' ? 'Photo' : 'Video');
      const caption = document.createElement('p'); caption.textContent = item.caption || '';
      const meta = document.createElement('small'); meta.textContent = (item.uploader || '') + ' · ' + new Date(item.created_at).toLocaleDateString();
      const actions = document.createElement('div'); actions.className = 'gallery-social';
      const likeBtn = document.createElement('button'); likeBtn.type = 'button'; likeBtn.className = 'like-button' + (item.liked_by_me ? ' liked' : '');
      likeBtn.textContent = (item.liked_by_me ? '♥ Liked · ' : '♡ Like · ') + ((item.likes || []).length);
      likeBtn.setAttribute('aria-label', 'Like this item');
      const paintLikeUI = () => {
        likeBtn.classList.toggle('liked', !!item.liked_by_me);
        likeBtn.textContent = (item.liked_by_me ? '♥ Liked · ' : '♡ Like · ') + ((item.likes || []).length);
        whoBtn.textContent = (item.likes || []).length ? 'Liked by ' + item.likes.join(', ') : 'No likes yet';
      };
      likeBtn.addEventListener('click', () => {
        // Optimistic UI: update the visible state immediately, then sync in order.
        item.liked_by_me = !item.liked_by_me;
        const names = new Set(item.likes || []);
        if (item.liked_by_me) names.add(state.user);
        else names.delete(state.user);
        item.likes = Array.from(names);
        paintLikeUI();

        item._pendingLikeCount = (item._pendingLikeCount || 0) + 1;
        item._likeSyncQueue = (item._likeSyncQueue || Promise.resolve()).then(async () => {
          try {
            const result = await post('toggleLike', {token:state.token, gallery_id:item.id});
            item._pendingLikeCount = Math.max(0, (item._pendingLikeCount || 1) - 1);
            // Only reconcile when all rapid clicks have finished syncing.
            if (!item._pendingLikeCount && typeof result.liked === 'boolean' && result.liked !== item.liked_by_me) {
              item.liked_by_me = result.liked;
              const latestNames = new Set(item.likes || []);
              if (result.liked) latestNames.add(state.user); else latestNames.delete(state.user);
              item.likes = Array.from(latestNames);
              paintLikeUI();
            }
          } catch (error) {
            item._pendingLikeCount = 0;
            banner('Like is shown instantly, but could not sync to the server: ' + error.message);
          }
        });
      });
      const whoBtn = document.createElement('button'); whoBtn.type = 'button'; whoBtn.className = 'text-button who-liked';
      whoBtn.textContent = (item.likes || []).length ? 'Liked by ' + item.likes.join(', ') : 'No likes yet';
      whoBtn.addEventListener('click', () => { const names = (item.likes || []).join(', '); alert(names ? 'Liked by: ' + names : 'No one has liked this yet.'); });
      const commentBtn = document.createElement('button'); commentBtn.type = 'button'; commentBtn.className = 'comment-toggle';
      commentBtn.textContent = '💬 Comments (' + (item.comment_count || 0) + ')';
      const commentArea = document.createElement('div'); commentArea.className = 'comment-area'; commentArea.hidden = true;
      const commentList = document.createElement('div'); commentList.className = 'comment-list';
      const commentForm = document.createElement('form'); commentForm.className = 'comment-form';
      const commentInput = document.createElement('input'); commentInput.type = 'text'; commentInput.maxLength = 1000; commentInput.placeholder = 'Write a comment…'; commentInput.setAttribute('aria-label', 'Write a comment');
      const commentSend = document.createElement('button'); commentSend.type = 'submit'; commentSend.textContent = 'Send';
      commentForm.append(commentInput, commentSend); commentArea.append(commentList, commentForm);
      function appendComment(comment, pending) {
        const p = document.createElement('p'); p.className = 'gallery-comment' + (pending ? ' comment-pending' : '');
        const strong = document.createElement('strong'); strong.textContent = comment.username + ': ';
        const body = document.createElement('span'); body.textContent = comment.comment;
        const time = document.createElement('small');
        time.textContent = pending ? 'Sending…' : new Date(comment.created_at).toLocaleString();
        p.append(strong, body, time); commentList.append(p);
        return p;
      }
      async function fetchComments() {
        const result = await post('galleryComments', {token:state.token, gallery_id:item.id});
        item.comment_count = (result.comments || []).length;
        commentBtn.textContent = '💬 Comments (' + item.comment_count + ')';
        commentList.replaceChildren();
        (result.comments || []).forEach(comment => appendComment(comment, false));
        if (!result.comments?.length) { const empty = document.createElement('p'); empty.className = 'comment-empty'; empty.textContent = 'No comments yet.'; commentList.append(empty); }
      }
      commentBtn.addEventListener('click', async () => {
        commentArea.hidden = !commentArea.hidden;
        if (!commentArea.hidden) { try { await fetchComments(); } catch (error) { banner(error.message); } }
      });
      commentForm.addEventListener('submit', event => {
        event.preventDefault();
        const comment = commentInput.value.trim();
        if (!comment) return;

        // Put the comment on screen and clear the input before contacting the backend.
        const optimistic = {username:state.user, comment:comment, created_at:new Date().toISOString()};
        const empty = commentList.querySelector('.comment-empty');
        if (empty) empty.remove();
        const optimisticNode = appendComment(optimistic, true);
        commentInput.value = '';
        item.comment_count = (Number(item.comment_count) || 0) + 1;
        commentBtn.textContent = '💬 Comments (' + item.comment_count + ')';
        commentSend.disabled = false;

        // Keep the UI responsive; let the backend catch up in the background.
        post('addComment', {token:state.token, gallery_id:item.id, comment}).then(async () => {
          if (!commentArea.hidden) {
            try { await fetchComments(); } catch (_) {
              optimisticNode.classList.remove('comment-pending');
              optimisticNode.querySelector('small').textContent = 'Saved';
            }
          }
        }).catch(error => {
          optimisticNode.classList.remove('comment-pending');
          optimisticNode.classList.add('comment-failed');
          optimisticNode.querySelector('small').textContent = 'Not synced';
          banner('Comment is visible locally, but could not sync to the server: ' + error.message);
        });
      });
      actions.append(likeBtn, whoBtn, commentBtn); details.append(title, caption, meta, actions, commentArea); card.append(preview, details); grid.append(card);
    });
  }
  function openMedia(item) {
    // Photos are opened directly in Google Drive in a new tab. The embedded
    // Drive image endpoints can fail for shared files, so don't trap users in the modal.
    if (item.media_type === 'image') {
      const driveId = item.drive_file_id || '';
      const imageUrl = driveId
        ? 'https://drive.google.com/file/d/' + encodeURIComponent(driveId) + '/view'
        : (item.media_url || item.preview_url || '');
      if (imageUrl) window.open(imageUrl, '_blank', 'noopener,noreferrer');
      else banner('This photo does not have an openable link.');
      return;
    }
    const stage = $('media-stage');
    stage.replaceChildren();
    $('media-caption').textContent = (item.title || '') + (item.caption ? ' — ' + item.caption : '');
    if (item.source === 'youtube') {
      const frame = document.createElement('iframe');
      frame.src = 'https://www.youtube.com/embed/' + encodeURIComponent(item.youtube_id) + '?autoplay=1&playsinline=1&rel=0';
      frame.title = item.title || 'YouTube video';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      stage.append(frame);
    } else {
      const frame = document.createElement('iframe');
      frame.src = item.preview_url || ('https://drive.google.com/file/d/' + encodeURIComponent(item.drive_file_id) + '/preview');
      frame.title = item.title || 'Shared video';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      stage.append(frame);
    }
    $('media-modal').hidden = false;
  }
  function closeMedia() { $('media-modal').hidden = true; $('media-stage').replaceChildren(); }
  $('close-media').addEventListener('click', closeMedia);
  $('media-modal').addEventListener('click', event => { if (event.target === $('media-modal')) closeMedia(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMedia(); });
  $('refresh-gallery').addEventListener('click', () => loadGallery().catch(showApiError));
  $('open-upload').addEventListener('click', () => { $('upload-panel').hidden = !$('upload-panel').hidden; });
  $('choose-files').addEventListener('click', () => $('media-files').click());

  function renderSelectedFiles() {
    const files = state.pendingGalleryFiles;
    $('selected-upload').hidden = files.length === 0;
    $('selected-upload-count').textContent = files.length + (files.length === 1 ? ' file selected' : ' files selected');
    const list = $('selected-files-list');
    list.replaceChildren();
    files.forEach(file => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = file.name;
      const size = document.createElement('small');
      size.textContent = file.size < 1024 * 1024 ? Math.max(1, Math.round(file.size / 1024)) + ' KB' : (file.size / 1024 / 1024).toFixed(1) + ' MB';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-selected-file';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Deselect ' + file.name);
      remove.addEventListener('click', () => {
        state.pendingGalleryFiles = state.pendingGalleryFiles.filter(pending => pending !== file);
        if (!state.pendingGalleryFiles.length) {
          $('file-upload-title').value = '';
          $('file-upload-caption').value = '';
        }
        renderSelectedFiles();
        $('media-files').value = '';
      });
      item.append(name, size, remove);
      list.append(item);
    });
  }

  function queueSelectedFiles(files) {
    const chosen = Array.from(files || []).filter(file => file && file.name);
    if (!chosen.length) return;
    state.pendingGalleryFiles.push(...chosen);
    $('file-upload-title').value = state.pendingGalleryFiles.length === 1 ? state.pendingGalleryFiles[0].name.replace(/\.[^.]+$/, '') : '';
    renderSelectedFiles();
    $('upload-status').textContent = 'Add a title and description if you like, then press Upload to gallery.';
    $('media-files').value = '';
  }

  async function uploadSelectedFiles() {
    if (!state.pendingGalleryFiles.length) {
      $('upload-status').textContent = 'Choose or drop at least one photo or video first.';
      return;
    }
    const button = $('upload-files-btn');
    button.disabled = true;
    $('choose-files').disabled = true;
    const description = $('file-upload-caption').value.trim().slice(0, 500);
    const customTitle = $('file-upload-title').value.trim().slice(0, 120);
    try {
      for (const file of [...state.pendingGalleryFiles]) {
        const extension = file.name.split('.').pop().toLowerCase();
        const inferred = ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',jfif:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',avif:'image/avif',heic:'image/heic',heif:'image/heif',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff',ico:'image/vnd.microsoft.icon',mp4:'video/mp4',m4v:'video/x-m4v',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',mpeg:'video/mpeg',mpg:'video/mpeg','3gp':'video/3gpp',ogv:'video/ogg',ts:'video/mp2t'})[extension] || '';
        const mimeType = file.type && file.type !== 'application/octet-stream' ? file.type : inferred;
        if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) throw new Error(file.name + ': unsupported file type. Choose an image or video.');
        $('upload-status').textContent = 'Preparing ' + file.name + '…';
        const title = customTitle || file.name.replace(/\.[^.]+$/, '');
        const started = await post('uploadStart', {token:state.token, filename:file.name, mime_type:mimeType, size:file.size, title, caption:description});
        const uploadId = started.upload_id;
        const chunkSize = 1024 * 1024;
        for (let offset = 0; offset < file.size; offset += chunkSize) {
          const end = Math.min(offset + chunkSize, file.size);
          const chunk = file.slice(offset, end);
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('Could not read file chunk.'));
            reader.readAsDataURL(chunk);
          });
          $('upload-status').textContent = 'Uploading ' + file.name + ' · ' + Math.round(end / file.size * 100) + '%';
          await post('uploadChunk', {token:state.token, upload_id:uploadId, start:offset, end:end - 1, total:file.size, base64});
        }
        state.pendingGalleryFiles = state.pendingGalleryFiles.filter(pending => pending !== file);
        renderSelectedFiles();
        $('upload-status').textContent = 'Uploaded ' + file.name + '.';
      }
      $('file-upload-title').value = '';
      $('file-upload-caption').value = '';
      $('upload-status').textContent = 'All selected media uploaded successfully.';
    } catch (error) {
      $('upload-status').textContent = error.message || 'Upload failed. Your remaining selection is kept so you can retry.';
    } finally {
      button.disabled = false;
      $('choose-files').disabled = false;
      $('media-files').value = '';
      await loadGallery().catch(error => console.warn('Gallery refresh after upload failed.', error));
    }
  }

  $('upload-files-btn').addEventListener('click', uploadSelectedFiles);
  $('clear-selected-files').addEventListener('click', () => {
    state.pendingGalleryFiles = [];
    $('file-upload-title').value = '';
    $('file-upload-caption').value = '';
    $('upload-status').textContent = '';
    renderSelectedFiles();
    $('media-files').value = '';
  });
  $('media-files').addEventListener('change', event => queueSelectedFiles(Array.from(event.target.files || [])));
  const drop = $('drop-zone');
  ['dragenter','dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('dragover');
    queueSelectedFiles(Array.from(event.dataTransfer.files || []));
  });
  $('toggle-link-form').addEventListener('click', () => {
    const pane = $('upload-link-pane');
    pane.hidden = !pane.hidden;
    $('toggle-link-form').setAttribute('aria-expanded', String(!pane.hidden));
    $('toggle-link-form').textContent = pane.hidden ? 'Or add a video using a YouTube link' : 'Hide YouTube link uploader';
    if (!pane.hidden) $('youtube-url').focus();
  });
  $('save-youtube').addEventListener('click', async () => {
    const url = $('youtube-url').value.trim(); if (!url) { $('upload-status').textContent = 'Paste a YouTube link first.'; return; }
    $('save-youtube').disabled = true; $('upload-status').textContent = 'Adding video…';
    try { await post('addYoutube', {token:state.token, url, title:$('youtube-title').value.trim(), caption:$('youtube-caption').value.trim()}); $('youtube-url').value = ''; $('youtube-title').value = ''; $('youtube-caption').value = ''; $('upload-status').textContent = 'Added to gallery.'; await loadGallery(); }
    catch (error) { $('upload-status').textContent = error.message; }
    finally { $('save-youtube').disabled = false; }
  });

  // Restore session only after the backend verifies it.
  if (state.token && state.user) {
    post('whoami', {token:state.token}).then(result => { applySupabaseConfig(result); return openApp(); }).catch(() => { state.token = ''; state.user = ''; sessionStorage.removeItem('anonyms_token'); sessionStorage.removeItem('anonyms_user'); });
  }
})();