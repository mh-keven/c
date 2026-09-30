/* Private chat
 * The password is checked on the server (Supabase database function), never here.
 * Row Level Security then only lets verified sessions read/write messages.
 * Only the publishable (anon) key belongs in this file.
 */

// ====== 1. CONFIG — paste your own values (Project Settings → API) ======
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_KEY = "sb_publishable_MQXhkfcmpYCNbetVDR-ARw_yUoUkNmK";

const PAGE_SIZE = 200;
const MAX_LEN = 2000;

// Face / emotion emojis only
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
};

const configured = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_KEY.includes("YOUR-");
const db = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

let me = null;                 // "Zubii" | "Keven"
let channel = null;
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
  } catch {
    showError("Couldn't reach the server. Check your connection and try again.");
  } finally {
    el.loginBtn.disabled = false;
  }
});

el.logoutBtn.addEventListener("click", async () => {
  if (channel) { await db.removeChannel(channel); channel = null; }
  try { await db.rpc("chat_logout"); } catch {}
  await db.auth.signOut();
  resetChatState();
  el.chatScreen.hidden = true;
  el.loginScreen.hidden = false;
});

function resetChatState() {
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
  const { data } = await db.auth.getSession();
  if (!data?.session) return;
  const { data: name } = await db.rpc("chat_whoami");
  if (name) await openChat(name);
})();

// ====== 4. Open chat, history, realtime ======
async function openChat(username) {
  me = username;
  el.loginScreen.hidden = true;
  el.chatScreen.hidden = false;
  setStatus("connecting");
  await loadLatest();
  subscribe();
  el.input.focus({ preventScroll: true });
}

async function loadLatest() {
  const { data, error } = await db
    .from("messages")
    .select("id, username, message, created_at")
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
    .select("id, username, message, created_at")
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

function subscribe() {
  if (channel) db.removeChannel(channel);
  channel = db
    .channel("private-chat")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const m = payload.new;
        const nearBottom = isNearBottom();
        appendMessage(m, { animate: true });
        el.empty.hidden = true;
        if (m.username === me || nearBottom) scrollToBottom(true);
      })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setStatus("online");
        hideBanner();
        catchUp(); // fetch anything missed while disconnected
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setStatus("offline");
        showBanner("Connection lost. Trying to reconnect…");
      } else if (status === "CLOSED") {
        setStatus("offline");
      }
    });
}

async function catchUp() {
  if (!newestId) return;
  const { data } = await db
    .from("messages")
    .select("id, username, message, created_at")
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
  if (!document.hidden && me) catchUp();
});
window.addEventListener("online", () => { if (me) subscribe(); });
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

  bubble.append(text, time);
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

function setStatus(state) {
  el.status.dataset.state = state;
  el.status.textContent = { online: "Online", offline: "Reconnecting…", connecting: "Connecting…" }[state];
}
function showBanner(text) { el.banner.textContent = text; el.banner.hidden = false; }
function hideBanner() { el.banner.hidden = true; }

// ====== 6. Sending ======
function updateSendState() {
  el.sendBtn.disabled = el.input.value.trim().length === 0;
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
    .select("id, username, message, created_at")
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
