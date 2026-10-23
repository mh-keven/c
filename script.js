/* Anonyms frontend — Google Apps Script API only. No Supabase SDK or credentials. */
(() => {
  'use strict';
  // Paste the deployed Apps Script Web App URL ending in /exec here.
  const API_URL = 'https://script.google.com/macros/s/AKfycbyW_06rlpggyk054n43VbwYhgJarWsoV7CRR8iRm43Lvi_ghUKzSJeOJoM7t5pF6KcsAQ/exec';
  const $ = id => document.getElementById(id);
  const state = { token: sessionStorage.getItem('anonyms_token') || '', user: sessionStorage.getItem('anonyms_user') || '', supabaseUrl: sessionStorage.getItem('anonyms_supabase_url') || '', supabaseAnonKey: sessionStorage.getItem('anonyms_supabase_anon_key') || '', fastChatDisabled: false, messages: [], newest: '', before: '', gallery: [], busy: false, messagePolling: false, lastChatActivity: Date.now(), peerOnline: false, peerUsername: '', call: null, callCursor: 0, lastCallId: '', lastCallStatus: '', callPolling: false, callTimer: null, recorder: null, recordingChunks: [], recordingStartedAt: 0 };
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
        Authorization: 'Bearer ' + state.supabaseAnonKey,
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
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', blob, filename);
      const response = await fetch(prepared.upload_url, {
        method:'PUT',
        headers:{apikey:state.supabaseAnonKey, 'x-upsert':'false'},
        body:form
      });
      if (!response.ok) throw new Error('Supabase Storage upload failed (' + response.status + ').');
      return post('finalizeVoiceNote', {
        token:state.token, path:prepared.path, mime_type:mime, duration_seconds:duration
      });
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
    $('login-screen').hidden = true; $('app-screen').hidden = false;
    $('conn-status').textContent = 'Connected as ' + state.user; $('conn-status').dataset.state = 'online';
    await Promise.all([loadMessages(true), loadGallery(), loadStatus()]);
    clearTimeout(pollTimer); clearInterval(statusTimer); clearInterval(state.callTimer);
    // Poll only after the previous request finishes; while the chat is visible,
    // a short delay after each response keeps delivery responsive without overlap.
    scheduleMessagePoll(100);
    statusTimer = setInterval(async () => { if (!document.hidden) { try { await post('touch', {token: state.token}); await loadStatus(); } catch (_) {} } }, 8000);
    state.callTimer = setInterval(() => { if (!document.hidden) pollCallState().catch(() => {}); }, 1400);
    pollCallState().catch(() => {});
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
    await endCall(true);
    clearInterval(pollTimer); clearInterval(statusTimer); clearInterval(state.callTimer);
    try { await post('logout', { token: state.token }); } catch (_) {}
    state.token = ''; state.user = ''; state.messages = []; state.gallery = []; state.newest = ''; state.before = '';
    sessionStorage.removeItem('anonyms_token'); sessionStorage.removeItem('anonyms_user');
    sessionStorage.removeItem('anonyms_supabase_url'); sessionStorage.removeItem('anonyms_supabase_anon_key');
    state.supabaseUrl = ''; state.supabaseAnonKey = ''; state.fastChatDisabled = false;
    $('app-screen').hidden = true; $('login-screen').hidden = false; $('message-list').replaceChildren(); $('gallery-grid').replaceChildren(); banner('');
  }
  $('logout-btn').addEventListener('click', logout);
  syncComposerActions();

  async function loadMessages(initial) {
    if (!initial && state.messagePolling) return false;
    state.messagePolling = true;
    try {
      const received = await fetchChatMessages({
        limit:200,
        before:initial ? '' : '',
        after:initial ? '' : state.newest
      });
      await hydrateAudioUrls(received);
      if (initial) {
        state.messages = received;
        state.newest = state.messages.length ? state.messages[state.messages.length - 1].created_at : '';
        state.before = state.messages.length ? state.messages[0].created_at : '';
        renderMessages();
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
      return true;
    } finally { state.messagePolling = false; }
  }
  $('load-earlier').addEventListener('click', async () => {
    if (!state.before) return;
    $('load-earlier').disabled = true;
    try {
      const old = await fetchChatMessages({before:state.before, limit:200});
      await hydrateAudioUrls(old);
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
      bubble.append(time); row.append(bubble); list.append(row); previous = m;
    });
    $('empty-state').hidden = state.messages.length > 0;
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
  $('emoji-btn').addEventListener('click', () => {
    const panel = $('emoji-panel'); panel.hidden = !panel.hidden;
    if (!panel.childElementCount) EMOJIS.forEach(emoji => { const b = document.createElement('button'); b.type = 'button'; b.textContent = emoji; b.addEventListener('click', () => { const input = $('message-input'); input.value += emoji; input.dispatchEvent(new Event('input')); input.focus(); }); panel.append(b); });
  });
  document.addEventListener('click', event => { if (!event.target.closest('#emoji-panel') && !event.target.closest('#emoji-btn')) $('emoji-panel').hidden = true; });

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
      state.recorder = new MediaRecorder(stream, { ...(mimeType ? {mimeType} : {}), audioBitsPerSecond: 32000 });
      state.recorder.ondataavailable = event => { if (event.data?.size) state.recordingChunks.push(event.data); };
      state.recorder.onerror = () => { stream.getTracks().forEach(track => track.stop()); button.disabled = false; button.classList.remove('recording'); button.textContent = '🎙️'; banner('Could not record voice note.'); };
      state.recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const duration = Math.max(1, Math.round((Date.now() - state.recordingStartedAt) / 1000));
        const blob = new Blob(state.recordingChunks, {type: state.recorder.mimeType || 'audio/webm'});
        state.recordingChunks = [];
        button.disabled = true;
        try {
          const maxVoiceBytes = 8 * 1024 * 1024;
          if (!blob.size || blob.size > maxVoiceBytes) throw new Error('Voice note is too large. Please record a shorter note and try again.');
          const filename = 'voice-note-' + Date.now() + (blob.type.includes('ogg') ? '.ogg' : blob.type.includes('mp4') ? '.m4a' : '.webm');
          const result = await sendVoiceBlob(blob, filename, duration);
          if (result.message && !state.messages.some(message => message.id === result.message.id)) state.messages.push(result.message);
          state.messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
          state.lastChatActivity = Date.now();
          renderMessages(); $('messages').scrollTop = $('messages').scrollHeight; banner('');
          scheduleMessagePoll(50);
        } catch (error) { banner(error.message || 'Voice note failed to send.'); }
        finally { button.disabled = false; button.classList.remove('recording'); button.textContent = '🎙️'; button.title = 'Record voice note'; button.setAttribute('aria-label','Record voice note'); state.recorder = null; syncComposerActions(); }
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
    state.peerOnline = !!peer.online;
    $('conn-status').textContent = state.peerUsername + (peer.online ? ' · online' : peer.last_seen ? ' · last seen ' + timeLabel(peer.last_seen) : ' · offline');
    $('conn-status').dataset.state = peer.online ? 'online' : 'offline';
    renderVideoPanel();
  }


  // WebRTC video calls: only the other person's video is rendered. No mute/camera toggles.
  function renderVideoPanel() {
    const peerName = state.peerUsername || (state.user === 'Keven' ? 'Zubii' : 'Keven');
    const call = state.call;
    const active = !!call && ['pending','accepted'].includes(call.status);
    $('request-video-btn').hidden = active;
    $('request-video-btn').disabled = !state.peerOnline || !!state.call;
    $('request-video-btn').textContent = state.peerOnline ? 'See face' : peerName + ' is offline';
    $('video-panel-title').textContent = active ? (call.status === 'accepted' ? 'See face' : 'See face') : 'See the face';
    $('incoming-call-actions').hidden = !(active && call.status === 'pending' && call.role === 'callee');
    $('end-video-btn').hidden = !active;
    $('remote-video-wrap').hidden = !(active && call.status === 'accepted');
    if (active && call.status === 'pending' && call.role === 'callee') $('video-call-status').textContent = call.caller + ' is requesting to start video.';
    else if (active && call.status === 'pending' && call.role === 'caller') $('video-call-status').textContent = 'Waiting for them to accept…';
    else if (active && call.status === 'accepted') $('video-call-status').textContent = call.connected ? 'Connected' : 'Connecting…';
    else $('video-call-status').textContent = state.peerOnline ? 'Start video when you are ready.' : peerName + ' is not online yet.';
  }

  function stopLocalMedia(call = state.call) {
    if (call && call.localStream) {
      call.localStream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
      call.localStream = null;
    }
    const video = $('remote-video');
    if (video) video.srcObject = null;
  }
  function closeCallResources(call = state.call) {
    if (!call) return;
    stopLocalMedia(call);
    if (call.pc) { try { call.pc.ontrack = null; call.pc.onicecandidate = null; call.pc.close(); } catch (_) {} call.pc = null; }
    call.remoteStream = null;
  }
  async function endCall(notifyServer = true) {
    const call = state.call;
    if (!call) { renderVideoPanel(); return; }
    closeCallResources(call);
    if (notifyServer && state.token && call.id) {
      try { await post('callEnd', {token:state.token, call_id:call.id}); } catch (_) {}
    }
    state.lastCallId = call.id || state.lastCallId;
    state.lastCallStatus = 'ended';
    state.call = null;
    renderVideoPanel();
  }
  async function requestVideoCall() {
    if (!state.peerOnline || state.call) return;
    $('request-video-btn').disabled = true;
    try {
      const result = await post('callRequest', {token:state.token});
      state.call = {id:result.call.id, caller:result.call.caller, callee:result.call.callee, status:result.call.status, role:'caller', pc:null, localStream:null, remoteStream:null, pendingCandidates:[], offerStarted:false, connected:false};
      state.lastCallId = state.call.id; state.lastCallStatus = state.call.status;
      renderVideoPanel();
    } catch (error) { $('video-call-status').textContent = error.message; }
    finally { renderVideoPanel(); }
  }
  async function acceptVideoCall() {
    const call = state.call;
    if (!call || call.role !== 'callee' || call.status !== 'pending') return;
    $('accept-video-btn').disabled = true;
    try {
      await post('callRespond', {token:state.token, call_id:call.id, decision:'accept'});
      call.status = 'accepted';
      renderVideoPanel();
      await setupAcceptedCall(call);
    } catch (error) {
      $('video-call-status').textContent = error.message;
      await endCall(true);
    } finally { $('accept-video-btn').disabled = false; }
  }
  async function declineVideoCall() {
    const call = state.call;
    if (!call || call.role !== 'callee' || call.status !== 'pending') return;
    try { await post('callRespond', {token:state.token, call_id:call.id, decision:'decline'}); } catch (_) {}
    closeCallResources(call); state.lastCallId = call.id; state.lastCallStatus = 'declined'; state.call = null; renderVideoPanel();
  }
  function setupPeerConnection(call) {
    if (call.pc) return call.pc;
    const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}],bundlePolicy:'max-bundle',iceCandidatePoolSize:4});
    call.pc = pc;
    call.remoteStream = new MediaStream();
    $('remote-video').srcObject = call.remoteStream;
    pc.ontrack = event => {
      const streams = event.streams || [];
      if (streams[0]) streams[0].getTracks().forEach(track => {
        if (!call.remoteStream.getTracks().some(existing => existing.id === track.id)) call.remoteStream.addTrack(track);
      });
      else if (event.track && !call.remoteStream.getTracks().some(existing => existing.id === event.track.id)) call.remoteStream.addTrack(event.track);
      $('remote-video').srcObject = call.remoteStream;
      $('remote-video').play().catch(()=>{});
    };
    pc.onicecandidate = event => {
      if (event.candidate && state.call === call) post('callSignal', {token:state.token, call_id:call.id, type:'ice', payload:event.candidate.toJSON()}).catch(()=>{});
    };
    pc.onconnectionstatechange = () => {
      if (state.call !== call) return;
      if (pc.connectionState === 'connected') { call.connected = true; renderVideoPanel(); }
      if (['failed','closed','disconnected'].includes(pc.connectionState)) {
        if (pc.connectionState === 'failed') { banner('Video could not connect. This network may require a TURN relay.'); endCall(true); }
        else if (pc.connectionState === 'disconnected') setTimeout(() => { if (state.call === call && call.pc && call.pc.connectionState === 'disconnected') endCall(true); }, 8000);
      }
    };
    return pc;
  }
  async function setupAcceptedCall(call) {
    if (state.call !== call || call.status !== 'accepted') return;
    const pc = setupPeerConnection(call);
    if (!call.localStream) {
      call.localStream = await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true},
        video:{facingMode:'user', width:{ideal:320,max:480}, height:{ideal:240,max:360}, frameRate:{ideal:15,max:20}}
      });
      if (state.call !== call) { call.localStream.getTracks().forEach(t=>t.stop()); return; }
      call.localStream.getTracks().forEach(track => pc.addTrack(track, call.localStream));
      const videoSender = pc.getSenders().find(sender => sender.track && sender.track.kind === 'video');
      if (videoSender && videoSender.getParameters && videoSender.setParameters) {
        try {
          const params = videoSender.getParameters();
          params.encodings = params.encodings && params.encodings.length ? params.encodings : [{}];
          params.encodings[0].maxBitrate = 350000; params.encodings[0].maxFramerate = 15;
          params.degradationPreference = 'maintain-framerate';
          await videoSender.setParameters(params);
        } catch (_) {}
      }
    }
    if (call.role === 'caller' && !call.offerStarted) {
      call.offerStarted = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await post('callSignal', {token:state.token, call_id:call.id, type:'offer', payload:pc.localDescription});
    }
    await flushCandidates(call);
  }
  async function flushCandidates(call) {
    if (!call.pc || !call.pc.remoteDescription || !call.pendingCandidates) return;
    const candidates = call.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try { await call.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
    }
  }
  async function handleCallSignal(call, signal) {
    if (state.call !== call || call.status !== 'accepted') return;
    if (signal.type === 'offer' && call.role === 'callee') {
      await setupAcceptedCall(call);
      const pc = call.pc;
      if (!pc.remoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
        await flushCandidates(call);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await post('callSignal', {token:state.token, call_id:call.id, type:'answer', payload:pc.localDescription});
      }
    } else if (signal.type === 'answer' && call.role === 'caller' && call.pc && !call.pc.remoteDescription) {
      await call.pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
      await flushCandidates(call);
    } else if (signal.type === 'ice') {
      if (call.pc && call.pc.remoteDescription) {
        try { await call.pc.addIceCandidate(new RTCIceCandidate(signal.payload)); } catch (_) {}
      } else call.pendingCandidates.push(signal.payload);
    }
  }
  async function pollCallState() {
    if (!state.token || state.callPolling) return;
    state.callPolling = true;
    try {
      const result = await post('callPoll', {token:state.token, cursor:state.callCursor});
      state.callCursor = Number(result.cursor || state.callCursor);
      const serverCall = result.call;
      if (serverCall && serverCall.id !== state.lastCallId) {
        if (state.call && state.call.id !== serverCall.id) await endCall(true);
        if (['pending','accepted'].includes(serverCall.status)) {
          state.call = {id:serverCall.id, caller:serverCall.caller, callee:serverCall.callee, status:serverCall.status,
            role:serverCall.caller === state.user ? 'caller' : 'callee', pc:null, localStream:null, remoteStream:null,
            pendingCandidates:[], offerStarted:false, connected:false};
          state.lastCallId = serverCall.id; state.lastCallStatus = serverCall.status;
          renderVideoPanel();
          if (serverCall.status === 'accepted') setupAcceptedCall(state.call).catch(async error => {
            $('video-call-status').textContent = error.name === 'NotAllowedError' ? 'Allow camera and microphone to start video.' : (error.message || 'Could not start video.');
            await endCall(true);
          });
        } else {
          state.lastCallId = serverCall.id; state.lastCallStatus = serverCall.status;
        }
      } else if (serverCall && state.call && serverCall.id === state.call.id && serverCall.status !== state.call.status) {
        state.call.status = serverCall.status;
        state.lastCallStatus = serverCall.status;
        if (serverCall.status === 'accepted') setupAcceptedCall(state.call).catch(async error => {
          $('video-call-status').textContent = error.name === 'NotAllowedError' ? 'Allow camera and microphone to start video.' : (error.message || 'Could not start the call.');
          await endCall(true);
        });
        if (['ended','declined'].includes(serverCall.status)) {
          closeCallResources(state.call); state.call = null; renderVideoPanel();
        } else renderVideoPanel();
      }
      if (serverCall && state.call && serverCall.id === state.call.id && serverCall.status === 'pending' && state.call.role === 'callee') renderVideoPanel();
      if (serverCall && state.call && serverCall.id === state.call.id && serverCall.status === 'accepted') {
        for (const signal of (result.signals || [])) await handleCallSignal(state.call, signal);
      }
    } catch (_) {
      // Temporary signaling errors should not break chat polling.
    } finally { state.callPolling = false; }
  }
  $('request-video-btn').addEventListener('click', requestVideoCall);
  $('accept-video-btn').addEventListener('click', acceptVideoCall);
  $('decline-video-btn').addEventListener('click', declineVideoCall);
  $('end-video-btn').addEventListener('click', () => endCall(true));
  window.addEventListener('pagehide', () => {
    const call = state.call;
    closeCallResources(call);
    if (call && state.token && apiConfigured()) {
      try {
        const data = new URLSearchParams({action:'callEnd', payload:JSON.stringify({token:state.token, call_id:call.id}), nonce:'pagehide'});
        navigator.sendBeacon(API_URL, data);
      } catch (_) {}
    }
  });
  window.addEventListener('beforeunload', () => closeCallResources(state.call));

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
      const actions = document.createElement('div'); actions.className = 'gallery-social';
      const likeBtn = document.createElement('button'); likeBtn.type = 'button'; likeBtn.className = 'like-button' + (item.liked_by_me ? ' liked' : '');
      likeBtn.textContent = (item.liked_by_me ? '♥' : '♡') + ' ' + ((item.likes || []).length);
      likeBtn.setAttribute('aria-label', 'Like this item');
      likeBtn.addEventListener('click', async () => {
        likeBtn.disabled = true;
        try { await post('toggleLike', {token:state.token, gallery_id:item.id}); await loadGallery(); }
        catch (error) { banner(error.message); }
        finally { likeBtn.disabled = false; }
      });
      const whoBtn = document.createElement('button'); whoBtn.type = 'button'; whoBtn.className = 'text-button who-liked';
      whoBtn.textContent = (item.likes || []).length ? 'Liked by ' + item.likes.join(', ') : 'No likes yet';
      whoBtn.addEventListener('click', () => { const names = (item.likes || []).join(', '); alert(names ? 'Liked by: ' + names : 'No one has liked this yet.'); });
      const commentBtn = document.createElement('button'); commentBtn.type = 'button'; commentBtn.className = 'comment-toggle';
      commentBtn.textContent = 'Comments (' + (item.comment_count || 0) + ')';
      const commentArea = document.createElement('div'); commentArea.className = 'comment-area'; commentArea.hidden = true;
      const commentList = document.createElement('div'); commentList.className = 'comment-list';
      const commentForm = document.createElement('form'); commentForm.className = 'comment-form';
      const commentInput = document.createElement('input'); commentInput.type = 'text'; commentInput.maxLength = 1000; commentInput.placeholder = 'Write a comment…'; commentInput.setAttribute('aria-label', 'Write a comment');
      const commentSend = document.createElement('button'); commentSend.type = 'submit'; commentSend.textContent = 'Send';
      commentForm.append(commentInput, commentSend); commentArea.append(commentList, commentForm);
      async function fetchComments() {
        const result = await post('galleryComments', {token:state.token, gallery_id:item.id});
        commentList.replaceChildren();
        (result.comments || []).forEach(comment => {
          const p = document.createElement('p'); p.className = 'gallery-comment';
          const strong = document.createElement('strong'); strong.textContent = comment.username + ': ';
          const body = document.createElement('span'); body.textContent = comment.comment;
          const time = document.createElement('small'); time.textContent = new Date(comment.created_at).toLocaleString();
          p.append(strong, body, time); commentList.append(p);
        });
        if (!result.comments?.length) { const empty = document.createElement('p'); empty.className = 'comment-empty'; empty.textContent = 'No comments yet.'; commentList.append(empty); }
      }
      commentBtn.addEventListener('click', async () => {
        commentArea.hidden = !commentArea.hidden;
        if (!commentArea.hidden) { try { await fetchComments(); } catch (error) { banner(error.message); } }
      });
      commentForm.addEventListener('submit', async event => {
        event.preventDefault(); const comment = commentInput.value.trim(); if (!comment) return;
        commentSend.disabled = true;
        try { await post('addComment', {token:state.token, gallery_id:item.id, comment}); commentInput.value = ''; await fetchComments(); await loadGallery(); }
        catch (error) { banner(error.message); }
        finally { commentSend.disabled = false; }
      });
      actions.append(likeBtn, whoBtn, commentBtn); details.append(title, caption, meta, actions, commentArea); card.append(preview, details); grid.append(card);
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
      const extension = file.name.split('.').pop().toLowerCase();
      const inferred = ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',jfif:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',avif:'image/avif',heic:'image/heic',heif:'image/heif',bmp:'image/bmp',tif:'image/tiff',tiff:'image/tiff',ico:'image/vnd.microsoft.icon',mp4:'video/mp4',m4v:'video/x-m4v',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',mpeg:'video/mpeg',mpg:'video/mpeg','3gp':'video/3gpp',ogv:'video/ogg',ts:'video/mp2t'})[extension] || '';
      const mimeType = file.type && file.type !== 'application/octet-stream' ? file.type : inferred;
      if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) { $('upload-status').textContent = 'Unsupported media type. Choose an image or video file.'; continue; }
      $('upload-status').textContent = 'Preparing ' + file.name + '…';
      try {
        const started = await post('uploadStart', {token:state.token, filename:file.name, mime_type:mimeType, size:file.size, title:file.name.replace(/\.[^.]+$/, '')});
        const uploadId = started.upload_id;
        const chunkSize = 1024 * 1024;
        for (let offset = 0; offset < file.size; offset += chunkSize) {
          const end = Math.min(offset + chunkSize, file.size);
          const blob = file.slice(offset, end);
          const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read file chunk.')); reader.readAsDataURL(blob); });
          $('upload-status').textContent = 'Uploading ' + file.name + ' · ' + Math.round(end / file.size * 100) + '%';
          await post('uploadChunk', {token:state.token, upload_id:uploadId, start:offset, end:end - 1, total:file.size, base64});
        }
        $('upload-status').textContent = 'Uploaded ' + file.name;
      } catch (error) { $('upload-status').textContent = error.message; break; }
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
    post('whoami', {token:state.token}).then(result => { applySupabaseConfig(result); return openApp(); }).catch(() => { state.token = ''; state.user = ''; sessionStorage.removeItem('anonyms_token'); sessionStorage.removeItem('anonyms_user'); });
  }
})();