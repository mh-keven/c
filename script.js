/* Private chat
 * The password is checked on the server (Supabase database function), never here.
 * Row Level Security then only lets verified sessions read/write messages.
 * Only the publishable (anon) key belongs in this file.
 */

// ====== 1. CONFIG — paste your own values (Project Settings → API) ======
const SUPABASE_URL = "https://czqijodfoidzejgwblrf.supabase.co";
const SUPABASE_KEY = "sb_publishable_MQXhkfcmpYCNbetVDR-ARw_yUoUkNmK";

const PAGE_SIZE = 200;
const MAX_LEN = 2000;
const MAX_VOICE_SECONDS = 300;           // 5 minutes per voice note
const COLS = "id, username, message, created_at, audio_path, audio_seconds";
const BUCKET = "voice-notes";

// Face / emotion emojis + the heart
const EMOJIS = [
  "❤️","😀","😃","😄","😁","😆","😅","😂","🤣",
  "😊","😇","🙂","🙃","😉","😌","😍","🥰","😘",
  "😗","😙","😚","😋","😛","😝","😜","🤪",
  "🤨","🧐","🤓","😎","🤩","🥳",
  "😏","😒","😞","😔","😟","😕","🙁","☹️",
  "😣","😖","😫","😩","🥺","😢","😭",
  "😤","😠","😡","🤬","🤯","😳","🥵","🥶",
  "😱","😨","😰","😥","😓",
  "🤗","🤔","🤭","🤫","🤥",
  "😶","😐","😑","😬","🙄",
  "😮","😯","😲","😴","🤤",
  "😪","😵","🤐","🤢","🤮","🤧",
  "😷","🤒","🤕",
  "🫠","🫡","🫣","🫢","🫤",
];

// ====== 2. Setup ======
const $ = (id) => document.getElementById(id);
const el = {
  loginScreen: $("login-screen"), chatScreen: $("chat-screen"),
  loginForm: $("login-form"), username: $("username"), password: $("password"),
  loginError: $("login-error"), loginBtn: $("login-btn"),
  logoutBtn: $("logout-btn"), status: $("conn-status"), banner: $("banner"),
  scroller: $("messages"), list: $("message-list"), empty: $("empty-state"),
  loadEarlier: $("load-earlier"),
  composer: $("composer"), input: $("message-input"), sendBtn: $("send-btn"),
  emojiBtn: $("emoji-btn"), emojiPanel: $("emoji-panel"),
  micBtn: $("mic-btn"), recorder: $("recorder"), recTime: $("rec-time"),
  recCancel: $("rec-cancel"), recSend: $("rec-send"),
};

const configured = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_KEY.includes("YOUR-");
const db = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

let other = null;               // the other person's name
let rec = null;                 // active voice recording
let currentAudio = null;        // voice note currently playing
let connState = "connecting";
let me = null;                 // "Zubii" | "Keven"
let channel = null;             // messages channel
let retryTimer = null;
let tickTimer = null, tickCount = 0;
let otherLastSeen = null, otherAgo = null, otherFetchedAt = 0, peerKnown = false;
let oldestId = null;           // smallest message id loaded
let newestId = 0;              // largest message id loaded
let hasMore = false;
const seen = new Set();        // message ids already rendered
let lastDay = null;            // for date separators (bottom of list)

const LOGIN_ERROR = "This chat is private. Check your username and password.";

// ====== 3. Login / logout ======
function showError(msg) {
  el.loginError.textContent = msg;
  el.loginError.hidden = false;
}

async function ensureAnonSession() {
  const { data } = await db.auth.getSession();
  if (data?.session) return null;
  const { error } = await db.auth.signInAnonymously();
  return error;
}

el.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  el.loginError.hidden = true;

  if (!db) return showError("Add your Supabase URL and key in script.js first.");

  const typed = el.username.value.trim();
  const password = el.password.value;
  if (!typed || !password) return showError(LOGIN_ERROR);

  el.loginBtn.disabled = true;
  try {
    // 1) a plain anonymous session (no account needed), 2) the SERVER checks name + password
    const anonError = await ensureAnonSession();
    if (anonError) {
      console.error(anonError);
      return showError("Setup problem: " + anonError.message + " (turn on Anonymous sign-ins in Supabase → Authentication → Sign In / Providers)");
    }

    const { data: name, error } = await db.rpc("chat_login", {
      p_username: typed,
      p_password: password,
    });
    if (error) {
      console.error("Login error:", error);
      if (/too_many_attempts/i.test(error.message)) {
        return showError("Too many wrong tries. Please wait a few minutes.");
      }
      return showError("Setup problem: " + error.message + " (did you run setup.sql?)");
    }
    if (!name) return showError(LOGIN_ERROR);

    el.password.value = "";
    await openChat(name);
  } catch (err) {
    console.error(err);
    el.chatScreen.hidden = true;
    el.loginScreen.hidden = false;
    showError("Something went wrong: " + (err?.message || err));
  } finally {
    el.loginBtn.disabled = false;
  }
});

el.logoutBtn.addEventListener("click", async () => {
  await stopRealtime();
  try { await db.rpc("chat_logout"); } catch {}
  await db.auth.signOut();
  resetChatState();
  el.chatScreen.hidden = true;
  el.loginScreen.hidden = false;
});

function resetChatState() {
  if (rec) stopRecording(false);
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  otherLastSeen = null; otherAgo = null; peerKnown = false;
  me = null; oldestId = null; newestId = 0; hasMore = false; lastDay = null;
  seen.clear();
  el.list.innerHTML = "";
  el.input.value = "";
  closeEmoji();
  updateSendState();
}

// Restore an existing session (so nobody retypes the password every visit)
(async function init() {
  buildEmojiPanel();
  if (!db) return;
  try {
    const { data } = await db.auth.getSession();
    if (!data?.session) return;
    const { data: name } = await db.rpc("chat_whoami");
    if (name) await openChat(name);
  } catch (err) {
    console.error(err);
    el.chatScreen.hidden = true;
    el.loginScreen.hidden = false;
  }
})();

// ====== 4. Open chat, history, realtime ======
async function openChat(username) {
  me = username;
  other = me === "Zubii" ? "Keven" : "Zubii";
  el.loginScreen.hidden = true;
  el.chatScreen.hidden = false;
  setStatus("connecting");
  await loadLatest();
  startRealtime();
  el.input.focus({ preventScroll: true });
}

async function loadLatest() {
  const { data, error } = await db
    .from("messages")
    .select(COLS)
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  if (error) return showBanner("Couldn't load messages. Pull to retry or reopen the page.");
  hideBanner();

  const rows = data.slice().reverse();
  el.list.innerHTML = "";
  seen.clear();
  lastDay = null;
  rows.forEach((m) => appendMessage(m, { animate: false }));
  if (rows.length) { oldestId = rows[0].id; newestId = rows[rows.length - 1].id; }
  hasMore = data.length === PAGE_SIZE;
  el.loadEarlier.hidden = !hasMore;
  el.empty.hidden = rows.length > 0;
  scrollToBottom(false);
}

el.loadEarlier.addEventListener("click", async () => {
  if (oldestId == null) return;
  el.loadEarlier.disabled = true;
  const { data, error } = await db
    .from("messages")
    .select(COLS)
    .lt("id", oldestId)
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);
  el.loadEarlier.disabled = false;
  if (error) return showBanner("Couldn't load earlier messages.");

  const rows = data.slice().reverse();
  const prevHeight = el.scroller.scrollHeight;
  const frag = document.createDocumentFragment();
  let prevDay = null, prevUser = null;
  rows.forEach((m) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    const day = dayKey(m.created_at);
    if (day !== prevDay) { frag.appendChild(daySeparator(m.created_at)); prevDay = day; prevUser = null; }
    frag.appendChild(buildRow(m, m.username !== prevUser, false));
    prevUser = m.username;
  });
  el.list.prepend(frag);
  if (rows.length) oldestId = rows[0].id;
  hasMore = data.length === PAGE_SIZE;
  el.loadEarlier.hidden = !hasMore;
  el.scroller.style.scrollBehavior = "auto";
  el.scroller.scrollTop += el.scroller.scrollHeight - prevHeight;
  el.scroller.style.scrollBehavior = "";
});

// Messages arrive two ways: instantly through Realtime, and through a 3-second check as a safety net.
// Online / last seen uses a small "heartbeat" saved on the server, so it does not depend on Realtime.
function startRealtime() {
  startMessages();
  clearInterval(tickTimer);
  tickCount = 0;
  touch(); fetchPeer();
  tickTimer = setInterval(() => {
    if (document.hidden || !me) return;
    tickCount++;
    catchUp();                              // every 3s
    if (tickCount % 5 === 0) touch();       // every 15s
    if (tickCount % 3 === 0) fetchPeer();   // every 9s
    renderStatus();
  }, 3000);
}

async function stopRealtime() {
  clearTimeout(retryTimer);
  clearInterval(tickTimer);
  const c = channel;
  channel = null;
  try { if (c) await db.removeChannel(c); } catch {}
}

async function startMessages() {
  clearTimeout(retryTimer);
  const old = channel;
  channel = null;
  try { if (old) await db.removeChannel(old); } catch {}
  if (!me) return;

  const ch = db
    .channel("chat-messages")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const m = payload.new;
        const nearBottom = isNearBottom();
        appendMessage(m, { animate: true });
        el.empty.hidden = true;
        if (m.username === me || nearBottom) scrollToBottom(true);
      })
    .subscribe((status, err) => {
      console.log("[realtime]", status, err || "");
      if (ch !== channel) return; // ignore callbacks from channels we replaced
      if (status === "SUBSCRIBED") {
        setStatus("online");
        hideBanner();
        catchUp();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setStatus("offline");
        clearTimeout(retryTimer);
        retryTimer = setTimeout(startMessages, 3000);
      }
    });
  channel = ch;
}

// ---- heartbeat: online / last seen ----
async function touch() {
  if (!me) return;
  const { error } = await db.rpc("chat_touch");
  if (error) console.warn("chat_touch failed (did you run addons2.sql?)", error.message);
}

async function fetchPeer() {
  if (!me) return;
  const { data, error } = await db.rpc("chat_peer_status");
  if (error) { console.warn("chat_peer_status failed (did you run addons2.sql?)", error.message); return; }
  peerKnown = true;
  otherLastSeen = data?.last_seen || null;
  otherAgo = data?.seconds_ago ?? null;
  otherFetchedAt = Date.now();
  renderStatus();
}

function otherIsOnline() {
  if (!peerKnown || otherAgo == null) return false;
  return otherAgo + (Date.now() - otherFetchedAt) / 1000 <= 40;
}

function fmtLastSeen(iso) {
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return "just now";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (dayKey(iso) === dayKey(new Date())) return `today at ${time}`;
  if (dayKey(iso) === dayKey(y)) return `yesterday at ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + ` at ${time}`;
}

async function catchUp() {
  const { data } = await db
    .from("messages")
    .select(COLS)
    .gt("id", newestId)
    .order("id", { ascending: true });
  if (data?.length) {
    data.forEach((m) => appendMessage(m, { animate: true }));
    el.empty.hidden = true;
    scrollToBottom(true);
  }
}

// Refresh when the phone wakes up or the network comes back
document.addEventListener("visibilitychange", () => {
  if (!me || document.hidden) return;
  catchUp();
  touch();
  fetchPeer();
  if (connState !== "online") startMessages();
});
window.addEventListener("pagehide", () => { if (me) touch(); });
window.addEventListener("online", () => { if (me) { startMessages(); catchUp(); } });
window.addEventListener("offline", () => {
  setStatus("offline");
  showBanner("You're offline. Messages will send when you're back.");
});

// ====== 5. Rendering ======
function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function daySeparator(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  let label;
  if (dayKey(iso) === dayKey(today)) label = "Today";
  else if (dayKey(iso) === dayKey(yesterday)) label = "Yesterday";
  else label = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const div = document.createElement("div");
  div.className = "day-sep";
  const span = document.createElement("span");
  span.textContent = label;
  div.appendChild(span);
  return div;
}

function buildRow(m, isFirstOfGroup, animate) {
  const row = document.createElement("div");
  row.className = `row ${m.username === me ? "mine" : "theirs"}${isFirstOfGroup ? " first" : ""}`;
  row.dataset.id = m.id;
  if (!animate) row.style.animation = "none";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const text = document.createElement("p");
  text.className = "text";
  text.textContent = m.message; // textContent => no HTML injection

  const time = document.createElement("time");
  time.className = "time";
  time.dateTime = m.created_at;
  time.textContent = new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  bubble.append(m.audio_path ? buildVoice(m) : text, time);
  row.appendChild(bubble);
  return row;
}

function appendMessage(m, { animate }) {
  if (seen.has(m.id)) return;
  seen.add(m.id);

  const day = dayKey(m.created_at);
  if (day !== lastDay) { el.list.appendChild(daySeparator(m.created_at)); lastDay = day; }

  const prev = el.list.lastElementChild;
  const prevUser = prev?.classList.contains("row")
    ? (prev.classList.contains("mine") ? me : "other") : null;
  const thisUser = m.username === me ? me : "other";
  el.list.appendChild(buildRow(m, prevUser !== thisUser, animate));

  if (m.id > newestId) newestId = m.id;
}

function isNearBottom() {
  const s = el.scroller;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
}

function scrollToBottom(smooth) {
  requestAnimationFrame(() => {
    el.scroller.scrollTo({ top: el.scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  });
}

function setStatus(state) { connState = state; renderStatus(); }
function renderStatus() {
  if (!peerKnown) {
    el.status.dataset.state = connState === "online" ? "idle" : "connecting";
    el.status.textContent = other || "";
    return;
  }
  if (otherIsOnline()) {
    el.status.dataset.state = "online";
    el.status.textContent = `${other} · online`;
  } else {
    el.status.dataset.state = "idle";
    el.status.textContent = otherLastSeen
      ? `${other} · last seen ${fmtLastSeen(otherLastSeen)}`
      : `${other} · offline`;
  }
}
function showBanner(text) { el.banner.textContent = text; el.banner.hidden = false; }
function hideBanner() { el.banner.hidden = true; }

// ====== 6. Sending ======
function updateSendState() {
  const hasText = el.input.value.trim().length > 0;
  el.sendBtn.hidden = !hasText;
  el.sendBtn.disabled = false;
  el.micBtn.hidden = hasText;
}

function autoGrow() {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 120) + "px";
}

el.input.addEventListener("input", () => { updateSendState(); autoGrow(); });

el.input.addEventListener("keydown", (e) => {
  // Enter sends; Shift+Enter inserts a new line. Ignore Enter during IME composition.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    el.composer.requestSubmit();
  }
});

el.composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = el.input.value.trim();
  if (!text || !me) return;
  if (text.length > MAX_LEN) return showBanner(`Messages can be up to ${MAX_LEN} characters.`);

  el.sendBtn.disabled = true;
  const { data, error } = await db
    .from("messages")
    .insert({ username: me, message: text })
    .select(COLS)
    .single();

  if (error) {
    showBanner("Message not sent. Check your connection and try again.");
    updateSendState();
    return;
  }
  hideBanner();
  el.input.value = "";
  autoGrow();
  updateSendState();
  closeEmoji();
  appendMessage(data, { animate: true }); // instant for the sender; realtime echo is de-duplicated by id
  el.empty.hidden = true;
  scrollToBottom(true);
  el.input.focus({ preventScroll: true });
});

// ====== 6b. Voice notes ======
const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

function pickMime() {
  // mp4/AAC plays on iPhones and modern Android; webm/ogg are fallbacks
  const options = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return options.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

async function startRecording() {
  if (rec) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return showBanner("Voice notes aren't supported in this browser.");
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return showBanner("Allow microphone access to send voice notes.");
  }
  const mime = pickMime();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const r = { mr, stream, chunks: [], startedAt: Date.now(), send: false, timer: null, mime: mr.mimeType || mime || "audio/webm" };
  rec = r;

  mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
  mr.onstop = () => finishRecording(r);

  closeEmoji();
  el.composer.hidden = true;
  el.recorder.hidden = false;
  el.recTime.textContent = "0:00";
  r.timer = setInterval(() => {
    const secs = (Date.now() - r.startedAt) / 1000;
    el.recTime.textContent = fmtTime(secs);
    if (secs >= MAX_VOICE_SECONDS) stopRecording(true);
  }, 250);
  mr.start();
}

function stopRecording(send) {
  if (!rec) return;
  rec.send = send;
  if (rec.mr.state !== "inactive") rec.mr.stop();
  else finishRecording(rec);
}

async function finishRecording(r) {
  if (rec !== r) return;
  rec = null;
  clearInterval(r.timer);
  r.stream.getTracks().forEach((t) => t.stop());
  el.recorder.hidden = true;
  el.composer.hidden = false;

  const secs = Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - r.startedAt) / 1000));
  if (!r.send || !me) return;
  if (secs < 1 || !r.chunks.length) return showBanner("Voice note too short.");

  showBanner("Sending voice note…");
  const base = r.mime.split(";")[0];
  const ext = base.includes("mp4") ? "m4a" : base.includes("ogg") ? "ogg" : "webm";
  const path = `${me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const blob = new Blob(r.chunks, { type: base });

  const { error: upErr } = await db.storage.from(BUCKET).upload(path, blob, { contentType: base, cacheControl: "3600" });
  if (upErr) { console.error(upErr); return showBanner("Couldn't upload the voice note. Try again."); }

  const { data, error } = await db
    .from("messages")
    .insert({ username: me, message: "Voice note", audio_path: path, audio_seconds: Math.max(1, secs) })
    .select(COLS)
    .single();
  if (error) { console.error(error); return showBanner("Voice note not sent. Try again."); }

  hideBanner();
  appendMessage(data, { animate: true });
  el.empty.hidden = true;
  scrollToBottom(true);
}

el.micBtn.addEventListener("click", startRecording);
el.recCancel.addEventListener("click", () => stopRecording(false));
el.recSend.addEventListener("click", () => stopRecording(true));

const ICON_PLAY = '<svg class="i-play" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg class="i-pause" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/></svg>';

function buildVoice(m) {
  const wrap = document.createElement("div");
  wrap.className = "voice";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "v-play";
  btn.setAttribute("aria-label", "Play voice note");
  btn.innerHTML = ICON_PLAY + ICON_PAUSE;

  const bar = document.createElement("div");
  bar.className = "v-bar";
  const fill = document.createElement("div");
  fill.className = "v-fill";
  bar.appendChild(fill);

  const dur = document.createElement("span");
  dur.className = "v-dur";
  dur.textContent = fmtTime(m.audio_seconds || 0);

  wrap.append(btn, bar, dur);

  const ui = { audio: null, wrap, btn, fill, dur, total: m.audio_seconds || 0 };
  btn.addEventListener("click", () => togglePlay(m, ui));
  bar.addEventListener("click", (e) => {
    if (!ui.audio) return;
    const box = bar.getBoundingClientRect();
    const total = isFinite(ui.audio.duration) ? ui.audio.duration : ui.total;
    ui.audio.currentTime = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * total;
  });
  return wrap;
}

async function togglePlay(m, ui) {
  if (ui.audio && !ui.audio.paused) { ui.audio.pause(); return; }
  if (currentAudio && currentAudio !== ui.audio) currentAudio.pause();

  if (!ui.audio) {
    ui.btn.disabled = true;
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(m.audio_path, 3600);
    ui.btn.disabled = false;
    if (error) { console.error(error); return showBanner("Couldn't load the voice note."); }

    const a = new Audio(data.signedUrl);
    a.preload = "auto";
    a.addEventListener("play", () => ui.wrap.classList.add("playing"));
    a.addEventListener("pause", () => ui.wrap.classList.remove("playing"));
    a.addEventListener("ended", () => {
      ui.wrap.classList.remove("playing");
      ui.fill.style.width = "0%";
      ui.dur.textContent = fmtTime(ui.total);
    });
    a.addEventListener("timeupdate", () => {
      const total = isFinite(a.duration) && a.duration > 0 ? a.duration : ui.total || 1;
      ui.fill.style.width = Math.min(100, (a.currentTime / total) * 100) + "%";
      ui.dur.textContent = fmtTime(a.currentTime);
    });
    a.addEventListener("error", () => { ui.audio = null; showBanner("This voice note can't be played on this device."); });
    ui.audio = a;
  }
  currentAudio = ui.audio;
  try { await ui.audio.play(); } catch { showBanner("Couldn't play the voice note."); }
}

// ====== 7. Emoji picker ======
function buildEmojiPanel() {
  const frag = document.createDocumentFragment();
  EMOJIS.forEach((emoji) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = emoji;
    b.setAttribute("aria-label", "Insert " + emoji);
    // mousedown preventDefault keeps focus (and the mobile keyboard) in the textarea
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => insertAtCursor(emoji));
    frag.appendChild(b);
  });
  el.emojiPanel.appendChild(frag);
}

function insertAtCursor(text) {
  const input = el.input;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  if (input.value.length - (end - start) + text.length > MAX_LEN) return;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  input.setSelectionRange(pos, pos);
  updateSendState();
  autoGrow();
}

function closeEmoji() {
  el.emojiPanel.hidden = true;
  el.emojiBtn.setAttribute("aria-expanded", "false");
}

el.emojiBtn.addEventListener("click", () => {
  const open = el.emojiPanel.hidden;
  el.emojiPanel.hidden = !open;
  el.emojiBtn.setAttribute("aria-expanded", String(open));
});

document.addEventListener("click", (e) => {
  if (!el.emojiPanel.hidden && !e.target.closest("#emoji-panel") && !e.target.closest("#emoji-btn")) closeEmoji();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEmoji(); });

// Tells index.html the whole script loaded without crashing
window.__chatReady = true;
