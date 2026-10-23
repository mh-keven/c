/**
 * Anonyms Google backend (no Supabase).
 * Deploy as a Web App: execute as owner; access: Anyone.
 * Configure ANONYMS_USER_KEVEN_PASSWORD and ANONYMS_USER_ZUBII_PASSWORD
 * in Script Properties before deploying. Never put these in frontend code.
 */
const CFG = {
  SHEET_ID_PROPERTY: 'ANONYMS_SHEET_ID',
  DRIVE_FOLDER_PROPERTY: 'ANONYMS_MEDIA_FOLDER_ID',
  SESSION_TTL_SECONDS: 60 * 60 * 24 * 14,
  MAX_MESSAGE_LENGTH: 2000,
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
  USERS: ['Keven', 'Zubii'],
  SHEETS: {
    Messages: ['id', 'username', 'message', 'created_at', 'media_type', 'media_id', 'media_url', 'media_mime', 'duration_seconds'],
    Gallery: ['id', 'uploader', 'title', 'caption', 'media_type', 'source', 'drive_file_id', 'youtube_id', 'mime_type', 'created_at'],
    Sessions: ['token_hash', 'username', 'created_at', 'expires_at', 'last_seen'],
    Likes: ['gallery_id', 'username', 'created_at'],
    Comments: ['id', 'gallery_id', 'username', 'comment', 'created_at']
  }
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || '');
  let result;
  try {
    if (action === 'health') result = { ok: true, service: 'Anonyms Google backend' };
    else if (action === 'bootstrap') result = bootstrap_();
    else {
      const user = requireSession_(p.token);
      if (action === 'messages') result = { ok: true, user: user, messages: getMessages_(p.before, p.limit) };
      else if (action === 'gallery') result = { ok: true, user: user, items: getGallery_(user) };
      else if (action === 'toggleLike') result = toggleLike_(user, payload.gallery_id);
      else if (action === 'galleryComments') result = getGalleryComments_(payload.gallery_id);
      else if (action === 'addComment') result = addGalleryComment_(user, payload.gallery_id, payload.comment);
      else if (action === 'whoami') result = { ok: true, user: user };
      else if (action === 'status') result = { ok: true, user: user, peer: peerStatus_(user) };
      else throw new Error('Unknown action');
    }
  } catch (err) { result = { ok: false, error: safeError_(err) }; }
  return jsonp_(result, p.callback);
}

function doPost(e) {
  let result;
  try {
    const p = (e && e.parameter) || {};
    const action = String(p.action || '');
    const payload = p.payload ? JSON.parse(p.payload) : {};
    if (action === 'login') result = login_(payload.username, payload.password);
    else if (action === 'bootstrap') result = bootstrap_();
    else {
      const user = requireSession_(payload.token);
      if (action === 'logout') { revokeSession_(payload.token); result = { ok: true }; }
      else if (action === 'whoami') result = { ok: true, user: user };
      else if (action === 'messages') result = { ok: true, user: user, messages: getMessages_(payload.before, payload.limit) };
      else if (action === 'gallery') result = { ok: true, user: user, items: getGallery_() };
      else if (action === 'status') result = { ok: true, user: user, peer: peerStatus_(user) };
      else if (action === 'sendMessage') result = sendMessage_(user, payload.message);
      else if (action === 'addYoutube') result = addYoutube_(user, payload.url, payload.title, payload.caption);
      else if (action === 'uploadMedia') result = uploadMedia_(user, payload);
      else if (action === 'touch') { touchSession_(payload.token); result = { ok: true }; }
      else throw new Error('Unknown action');
    }
  } catch (err) { result = { ok: false, error: safeError_(err) }; }
  // Requests are submitted through a hidden form/iframe to avoid browser CORS issues.
  const json = JSON.stringify(result).replace(/</g, '\\u003c');
  const nonce = String((e && e.parameter && e.parameter.nonce) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>parent.postMessage({type:"anonyms-api",nonce:' + JSON.stringify(nonce) + ',result:' + json + '}, "*");</script>');
}

function setupAnonyms() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(CFG.SHEET_ID_PROPERTY);
  let ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Anonyms Private Chat Database');
  props.setProperty(CFG.SHEET_ID_PROPERTY, ss.getId());
  Object.keys(CFG.SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = CFG.SHEETS[name];
    if (sh.getLastRow() === 0) sh.appendRow(headers);
    else {
      const current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
      if (headers.some((h, i) => current[i] !== h)) throw new Error('Unexpected header row in ' + name + '. Back up the sheet before changing it.');
    }
  });
  let folderId = props.getProperty(CFG.DRIVE_FOLDER_PROPERTY);
  if (!folderId) {
    const folder = DriveApp.createFolder('Anonyms Private Media');
    folderId = folder.getId();
    props.setProperty(CFG.DRIVE_FOLDER_PROPERTY, folderId);
  }
  const folder = DriveApp.getFolderById(folderId);
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  Logger.log('Spreadsheet: ' + ss.getUrl());
  Logger.log('Private Drive folder: ' + folder.getName() + ' (' + folderId + ')');
  Logger.log('Set ANONYMS_USER_KEVEN_PASSWORD, ANONYMS_USER_ZUBII_PASSWORD, ANONYMS_KEVEN_EMAIL, and ANONYMS_ZUBII_EMAIL in Script Properties before use.');
}

function bootstrap_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(CFG.SHEET_ID_PROPERTY) || !props.getProperty(CFG.DRIVE_FOLDER_PROPERTY)) throw new Error('Run setupAnonyms() first.');
  if (!props.getProperty('ANONYMS_USER_KEVEN_PASSWORD') || !props.getProperty('ANONYMS_USER_ZUBII_PASSWORD')) throw new Error('Configure both user passwords in Script Properties.');
  return { ok: true, service: 'Anonyms Google backend', users: CFG.USERS };
}

function login_(username, password) {
  username = normalizeUser_(username);
  if (!username || typeof password !== 'string' || !password) return { ok: false, error: 'Invalid username or password.' };
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty('ANONYMS_USER_' + username.toUpperCase() + '_PASSWORD');
  if (!expected || !constantTimeEqual_(String(password), String(expected))) {
    Utilities.sleep(500);
    return { ok: false, error: 'Invalid username or password.' };
  }
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const hash = digest_(token);
  const now = new Date();
  const expires = new Date(now.getTime() + CFG.SESSION_TTL_SECONDS * 1000);
  withLock_(() => sheet_('Sessions').appendRow([hash, username, now.toISOString(), expires.toISOString(), now.toISOString()]));
  return { ok: true, user: username, token: token, expires_at: expires.toISOString() };
}

function sendMessage_(user, message) {
  message = String(message || '').trim();
  if (!message || message.length > CFG.MAX_MESSAGE_LENGTH) throw new Error('Message must contain 1–2000 characters.');
  const now = new Date().toISOString();
  const id = Utilities.getUuid();
  withLock_(() => sheet_('Messages').appendRow([id, user, message, now, 'text', '', '', '', '']));
  return { ok: true, message: { id: id, username: user, message: message, created_at: now, media_type: 'text' } };
}

function addYoutube_(user, url, title, caption) {
  const videoId = youtubeId_(String(url || ''));
  if (!videoId) throw new Error('Paste a valid YouTube video URL.');
  const now = new Date().toISOString();
  const id = Utilities.getUuid();
  const safeTitle = String(title || 'YouTube video').trim().slice(0, 120);
  const safeCaption = String(caption || '').trim().slice(0, 500);
  withLock_(() => sheet_('Gallery').appendRow([id, user, safeTitle, safeCaption, 'video', 'youtube', '', videoId, 'video/youtube', now]));
  return { ok: true, item: { id: id, uploader: user, title: safeTitle, caption: safeCaption, media_type: 'video', source: 'youtube', youtube_id: videoId, created_at: now } };
}

function uploadMedia_(user, payload) {
  const mime = String(payload.mime_type || '');
  const name = String(payload.filename || 'upload').replace(/[\\/\\r\\n]/g, '_').slice(0, 160);
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : '';
  if (!type) throw new Error('Only image and video files are supported.');
  const bytes = Utilities.base64Decode(String(payload.base64 || ''));
  if (!bytes.length || bytes.length > CFG.MAX_UPLOAD_BYTES) throw new Error('Upload must be smaller than 8 MB. Larger uploads need a resumable upload flow.');
  const blob = Utilities.newBlob(bytes, mime, name);
  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty(CFG.DRIVE_FOLDER_PROPERTY));
  const file = folder.createFile(blob);
  // Keep files private; grant viewer access only to the two configured Google accounts.
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const props = PropertiesService.getScriptProperties();
  const allowedEmails = [props.getProperty('ANONYMS_KEVEN_EMAIL'), props.getProperty('ANONYMS_ZUBII_EMAIL')].filter(Boolean);
  if (allowedEmails.length !== 2) { file.setTrashed(true); throw new Error('Configure ANONYMS_KEVEN_EMAIL and ANONYMS_ZUBII_EMAIL before uploading media.'); }
  allowedEmails.forEach(email => file.addViewer(email));
  const now = new Date().toISOString();
  const id = Utilities.getUuid();
  withLock_(() => sheet_('Gallery').appendRow([id, user, String(payload.title || name).slice(0, 120), String(payload.caption || '').slice(0, 500), type, 'drive', file.getId(), '', mime, now]));
  return { ok: true, item: { id: id, uploader: user, title: String(payload.title || name).slice(0, 120), caption: String(payload.caption || ''), media_type: type, source: 'drive', drive_file_id: file.getId(), mime_type: mime, media_url: 'https://drive.google.com/uc?export=view&id=' + file.getId(), preview_url: 'https://drive.google.com/file/d/' + file.getId() + '/preview', created_at: now } };
}

function getMessages_(before, limit) {
  const rows = rowsAsObjects_('Messages');
  const max = Math.min(Math.max(Number(limit) || 200, 1), 200);
  const filtered = rows.filter(r => !before || String(r.created_at) < String(before));
  return filtered.slice(-max).map(r => ({
    id: r.id, username: r.username, message: r.message, created_at: r.created_at,
    media_type: r.media_type || 'text', media_id: r.media_id || '', media_url: r.media_url || '',
    media_mime: r.media_mime || '', duration_seconds: r.duration_seconds || ''
  }));
}

function getGallery_(activeGalleryUser) {
  const likes = rowsAsObjects_('Likes');
  const comments = rowsAsObjects_('Comments');
  return rowsAsObjects_('Gallery').reverse().slice(0, 300).map(r => {
    const itemLikes = likes.filter(l => String(l.gallery_id) === String(r.id));
    return {
      id: r.id, uploader: r.uploader, title: r.title, caption: r.caption, media_type: r.media_type,
      source: r.source, drive_file_id: r.drive_file_id, youtube_id: r.youtube_id, mime_type: r.mime_type,
      media_url: r.drive_file_id ? ('https://drive.google.com/uc?export=view&id=' + r.drive_file_id) : '',
      preview_url: r.drive_file_id ? ('https://drive.google.com/file/d/' + r.drive_file_id + '/preview') : '',
      created_at: r.created_at, likes: itemLikes.map(l => l.username), liked_by_me: itemLikes.some(l => l.username === activeGalleryUser),
      comment_count: comments.filter(c => String(c.gallery_id) === String(r.id)).length
    };
  });
}

  return rowsAsObjects_('Gallery').reverse().slice(0, 300).map(r => ({
    id: r.id, uploader: r.uploader, title: r.title, caption: r.caption, media_type: r.media_type,
    source: r.source, drive_file_id: r.drive_file_id, youtube_id: r.youtube_id, mime_type: r.mime_type, media_url: r.drive_file_id ? ('https://drive.google.com/uc?export=view&id=' + r.drive_file_id) : '', preview_url: r.drive_file_id ? ('https://drive.google.com/file/d/' + r.drive_file_id + '/preview') : '', created_at: r.created_at
  }));
}

function toggleLike_(user, galleryId) {
  galleryId = String(galleryId || '');
  if (!rowsAsObjects_('Gallery').some(r => String(r.id) === galleryId)) throw new Error('Gallery item not found.');
  const sh = sheet_('Likes'), rows = rowsAsObjects_('Likes');
  const existing = rows.find(r => String(r.gallery_id) === galleryId && r.username === user);
  if (existing) {
    const values = sh.getDataRange().getValues();
    for (let i = values.length - 1; i >= 1; i--) if (String(values[i][0]) === galleryId && values[i][1] === user) { sh.deleteRow(i + 1); break; }
    return { ok: true, liked: false };
  }
  withLock_(() => sh.appendRow([galleryId, user, new Date().toISOString()]));
  return { ok: true, liked: true };
}
function getGalleryComments_(galleryId) {
  galleryId = String(galleryId || '');
  if (!rowsAsObjects_('Gallery').some(r => String(r.id) === galleryId)) throw new Error('Gallery item not found.');
  return { ok: true, comments: rowsAsObjects_('Comments').filter(r => String(r.gallery_id) === galleryId).slice(-100) };
}
function addGalleryComment_(user, galleryId, comment) {
  galleryId = String(galleryId || ''); comment = String(comment || '').trim();
  if (!rowsAsObjects_('Gallery').some(r => String(r.id) === galleryId)) throw new Error('Gallery item not found.');
  if (!comment || comment.length > 1000) throw new Error('Comment must contain 1–1000 characters.');
  const item = { id: Utilities.getUuid(), gallery_id: galleryId, username: user, comment: comment, created_at: new Date().toISOString() };
  withLock_(() => sheet_('Comments').appendRow([item.id, item.gallery_id, item.username, item.comment, item.created_at]));
  return { ok: true, comment: item };
}
function peerStatus_(user) {
  const rows = rowsAsObjects_('Sessions').filter(r => r.username !== user && new Date(r.expires_at).getTime() > Date.now());
  if (!rows.length) return { username: user === 'Keven' ? 'Zubii' : 'Keven', online: false, last_seen: null };
  const latest = rows.sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)))[0];
  const online = Date.now() - new Date(latest.last_seen).getTime() < 45000;
  return { username: latest.username, online: online, last_seen: latest.last_seen };
}

function touchSession_(token) {
  const hash = digest_(String(token || ''));
  const sh = sheet_('Sessions');
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) if (values[i][0] === hash) {
    sh.getRange(i + 1, 5).setValue(new Date().toISOString());
    return;
  }
}

function revokeSession_(token) {
  const hash = digest_(String(token || ''));
  const sh = sheet_('Sessions');
  const values = sh.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) if (values[i][0] === hash) sh.deleteRow(i + 1);
}

function requireSession_(token) {
  if (!token || typeof token !== 'string') throw new Error('Please log in again.');
  const hash = digest_(token);
  const rows = rowsAsObjects_('Sessions');
  const session = rows.find(r => r.token_hash === hash && new Date(r.expires_at).getTime() > Date.now());
  if (!session || CFG.USERS.indexOf(session.username) < 0) throw new Error('Session expired. Please log in again.');
  return session.username;
}

function normalizeUser_(value) {
  const name = String(value || '').trim().toLowerCase();
  return name === 'keven' ? 'Keven' : name === 'zubii' ? 'Zubii' : '';
}
function youtubeId_(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}
function sheet_(name) {
  const id = PropertiesService.getScriptProperties().getProperty(CFG.SHEET_ID_PROPERTY);
  if (!id) throw new Error('Run setupAnonyms() first.');
  const sh = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sh) throw new Error('Missing sheet: ' + name);
  return sh;
}
function rowsAsObjects_(name) {
  const values = sheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => headers.reduce((obj, h, i) => { obj[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]; return obj; }, {}));
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function digest_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)).replace(/=+$/, '');
}
function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function safeError_(err) {
  const msg = String(err && err.message || err || 'Request failed');
  return msg.slice(0, 240);
}
function jsonp_(obj, callback) {
  const json = JSON.stringify(obj).replace(/</g, '\\u003c');
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$\.\[\]]{0,100}$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
