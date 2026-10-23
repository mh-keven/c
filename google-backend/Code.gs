/**
 * Anonyms Google backend; optional Supabase login audit logging only.
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
    Gallery: ['id', 'uploader', 'title', 'caption', 'media_type', 'source', 'drive_file_id', 'youtube_id', 'mime_type', 'created_at'],
    Sessions: ['token_hash', 'username', 'created_at', 'expires_at', 'last_seen'],
    Likes: ['gallery_id', 'username', 'created_at'],
    Comments: ['id', 'gallery_id', 'username', 'comment', 'created_at'],
    Calls: ['id', 'caller', 'callee', 'status', 'created_at', 'updated_at', 'ended_by'],
    CallSignals: ['id', 'call_id', 'from_user', 'to_user', 'type', 'payload', 'created_at']
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
      if (action === 'messages') result = { ok: true, user: user, messages: getSupabaseMessages_(p.before, p.limit, p.after) };
      else if (action === 'gallery') result = { ok: true, user: user, items: getGallery_(user) };
      else if (action === 'toggleLike') result = toggleSupabaseLike_(user, p.gallery_id);
      else if (action === 'galleryComments') result = getSupabaseGalleryComments_(p.gallery_id);
      else if (action === 'addComment') result = addSupabaseGalleryComment_(user, p.gallery_id, p.comment);
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
      if (action === 'logout') {
        revokeSession_(payload.token);
        logSupabaseLoginEvent_(user, 'logout');
        result = { ok: true };
      }
      else if (action === 'whoami') result = { ok: true, user: user };
      else if (action === 'messages') result = { ok: true, user: user, messages: getSupabaseMessages_(payload.before, payload.limit, payload.after) };
      else if (action === 'gallery') result = { ok: true, user: user, items: getGallery_(user) };
      else if (action === 'toggleLike') result = toggleSupabaseLike_(user, payload.gallery_id);
      else if (action === 'galleryComments') result = getSupabaseGalleryComments_(payload.gallery_id);
      else if (action === 'addComment') result = addSupabaseGalleryComment_(user, payload.gallery_id, payload.comment);
      else if (action === 'status') result = { ok: true, user: user, peer: peerStatus_(user) };
      else if (action === 'sendMessage') result = sendSupabaseMessage_(user, payload.message);
      else if (action === 'addYoutube') result = addYoutube_(user, payload.url, payload.title, payload.caption);
      else if (action === 'uploadMedia') result = uploadMedia_(user, payload);
      else if (action === 'uploadStart') result = startResumableUpload_(user, payload);
      else if (action === 'uploadChunk') result = uploadChunk_(user, payload);
      else if (action === 'sendVoiceNote') result = sendVoiceNote_(user, payload);
      else if (action === 'touch') { touchSession_(payload.token); result = { ok: true }; }
      else if (action === 'callRequest') result = requestCall_(user);
      else if (action === 'callRespond') result = respondCall_(user, payload.call_id, payload.decision);
      else if (action === 'callSignal') result = addCallSignal_(user, payload.call_id, payload.type, payload.payload);
      else if (action === 'callPoll') result = pollCall_(user, payload.cursor);
      else if (action === 'callEnd') result = endCall_(user, payload.call_id);
      else throw new Error('Unknown action');
    }
  } catch (err) { result = { ok: false, error: safeError_(err) }; }
  // Requests are submitted through a hidden form/iframe to avoid browser CORS issues.
  const json = JSON.stringify(result).replace(/</g, '\\u003c');
  const nonce = String((e && e.parameter && e.parameter.nonce) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>window.top.postMessage({type:"anonyms-api",nonce:' + JSON.stringify(nonce) + ',result:' + json + '}, "*");</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
  // Newly created Drive folders are private by default; avoid invalid NONE permission updates.
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
    logSupabaseLoginEvent_(username, 'login_failure');
    return { ok: false, error: 'Invalid username or password.' };
  }
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const hash = digest_(token);
  const now = new Date();
  const expires = new Date(now.getTime() + CFG.SESSION_TTL_SECONDS * 1000);
  withLock_(() => sheet_('Sessions').appendRow([hash, username, now.toISOString(), expires.toISOString(), now.toISOString()]));
  logSupabaseLoginEvent_(username, 'login_success');
  return { ok: true, user: username, token: token, expires_at: expires.toISOString() };
}

/** Best-effort audit logging. Credentials and session tokens are never sent to Supabase. */
function logSupabaseLoginEvent_(username, eventType) {
  try {
    if (CFG.USERS.indexOf(username) === -1) return;
    if (['login_success', 'login_failure', 'logout'].indexOf(eventType) === -1) return;

    const props = PropertiesService.getScriptProperties();
    const url = String(props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
    const key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      console.warn('Supabase login-event logging is not configured.');
      return;
    }

    const response = UrlFetchApp.fetch(url + '/rest/v1/login_events', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify({
        username: username,
        event_type: eventType,
        request_id: Utilities.getUuid()
      }),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) console.warn('Supabase login-event logging failed; HTTP ' + code);
  } catch (err) {
    // Audit logging must never expose secrets or prevent the normal login/logout flow.
    console.warn('Supabase login-event logging error: ' + String(err).slice(0, 120));
  }
}

/* Supabase is accessed only from this trusted Apps Script backend. Never put the service-role key in browser code. */
function supabaseRest_(method, path, payload, prefer) {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('Supabase backend is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Apps Script Script Properties.');
  const options = { method: String(method || 'GET').toLowerCase(), headers: { apikey:key, Authorization:'Bearer ' + key, Prefer:prefer || 'return=representation' }, muteHttpExceptions:true };
  if (payload !== null && payload !== undefined) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload); }
  const response = UrlFetchApp.fetch(base + path, options), code = response.getResponseCode(), body = response.getContentText() || '';
  if (code < 200 || code >= 300) {
    console.warn('Supabase request failed: ' + code + ' ' + body.slice(0,180));
    throw new Error('Supabase could not complete this request (' + code + '). Check the Supabase migration and Apps Script properties.');
  }
  if (!body) return null;
  try { return JSON.parse(body); } catch (_) { return body; }
}
function supabaseStorageUpload_(path, blob) {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('Supabase backend is not configured.');
  const response = UrlFetchApp.fetch(base + '/storage/v1/object/anonyms-voice-notes/' + path.split('/').map(encodeURIComponent).join('/'), {
    method:'post', contentType:blob.getContentType() || 'audio/webm',
    headers:{apikey:key, Authorization:'Bearer ' + key, 'x-upsert':'false'},
    payload:blob.getBytes(), muteHttpExceptions:true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Could not save voice note in Supabase Storage (' + response.getResponseCode() + ').');
}
function supabaseSignedAudioUrl_(path) {
  if (!path) return '';
  // Signed URLs last 24 hours; reuse a cached URL for six hours instead of
  // making another Storage API request on every chat refresh.
  const cache = CacheService.getScriptCache();
  const cacheKey = 'anonyms_audio_url_' + digest_(String(path));
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('Supabase backend is not configured.');
  const response = UrlFetchApp.fetch(base + '/storage/v1/object/sign/anonyms-voice-notes/' + String(path).split('/').map(encodeURIComponent).join('/'), {
    method:'post', contentType:'application/json', headers:{apikey:key,Authorization:'Bearer '+key},
    payload:JSON.stringify({expiresIn:86400}), muteHttpExceptions:true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Could not create a secure voice-note link.');
  const result = JSON.parse(response.getContentText() || '{}');
  const signed = result.signedURL || result.signedUrl || '';
  const url = signed.startsWith('http') ? signed : base + '/storage/v1' + (signed.startsWith('/') ? signed : '/' + signed);
  cache.put(cacheKey, url, 21600);
  return url;
}
function getSupabaseMessages_(before, limit, after) {
  const max = Math.min(Math.max(Number(limit) || 200,1),200);
  let query = '/rest/v1/anonyms_messages?select=id,username,message,created_at,media_type,media_path,duration_seconds&limit=' + max;
  if (before) query += '&created_at=lt.' + encodeURIComponent(String(before)) + '&order=created_at.desc';
  else if (after) query += '&created_at=gt.' + encodeURIComponent(String(after)) + '&order=created_at.asc';
  else query += '&order=created_at.desc';
  const rows = supabaseRest_('GET',query,null) || [];
  if (!after) rows.reverse();
  return rows.map(r => ({id:r.id,username:r.username,message:r.message || '',created_at:r.created_at,media_type:r.media_type || 'text',media_id:r.media_path || '',media_url:r.media_path ? supabaseSignedAudioUrl_(r.media_path) : '',media_mime:'',duration_seconds:r.duration_seconds || ''}));
}
function sendSupabaseMessage_(user, message) {
  message = String(message || '').trim();
  if (!message || message.length > CFG.MAX_MESSAGE_LENGTH) throw new Error('Message must contain 1–2000 characters.');
  const row = supabaseRest_('POST','/rest/v1/anonyms_messages',[{username:user,message:message,media_type:'text',created_at:new Date().toISOString()}],'return=representation')[0];
  return {ok:true,message:{id:row.id,username:row.username,message:row.message,created_at:row.created_at,media_type:'text'}};
}
function saveSupabaseVoiceNoteBlob_(user, blob, mime, duration) {
  const id = Utilities.getUuid(), now = new Date().toISOString();
  const safeMime = String(mime || blob.getContentType() || 'audio/webm').split(';')[0];
  const extension = safeMime.includes('ogg') ? 'ogg' : safeMime.includes('mp4') ? 'm4a' : safeMime.includes('mpeg') ? 'mp3' : safeMime.includes('wav') ? 'wav' : 'webm';
  const path = user.toLowerCase() + '/' + id + '.' + extension;
  blob.setContentType(safeMime);
  supabaseStorageUpload_(path,blob);
  const row = supabaseRest_('POST','/rest/v1/anonyms_messages',[{id:id,username:user,message:'Voice note',media_type:'audio',media_path:path,duration_seconds:Math.max(1,Number(duration)||1),created_at:now}],'return=representation')[0];
  return {ok:true,message:{id:row.id,username:row.username,message:'Voice note',created_at:row.created_at,media_type:'audio',media_id:path,media_url:supabaseSignedAudioUrl_(path),media_mime:safeMime,duration_seconds:row.duration_seconds}};
}

// Compatibility for an already-running older resumable upload session. New clients
// send the recorded blob directly to sendVoiceNote_ and never create a Drive copy.
function saveSupabaseVoiceNote_(user, driveFile, mime, duration) {
  const saved = saveSupabaseVoiceNoteBlob_(user, driveFile.getBlob(), mime, duration);
  try { driveFile.setTrashed(true); } catch (_) {}
  return saved;
}
function toggleSupabaseLike_(user, galleryId) {
  galleryId = String(galleryId || '');
  if (!rowsAsObjects_('Gallery').some(r => String(r.id) === galleryId)) throw new Error('Gallery item not found.');
  const q = '/rest/v1/anonyms_gallery_likes?select=id&gallery_id=eq.' + encodeURIComponent(galleryId) + '&username=eq.' + encodeURIComponent(user);
  const existing = supabaseRest_('GET',q,null) || [];
  if (existing.length) { supabaseRest_('DELETE','/rest/v1/anonyms_gallery_likes?gallery_id=eq.'+encodeURIComponent(galleryId)+'&username=eq.'+encodeURIComponent(user),null,'return=minimal'); return {ok:true,liked:false}; }
  supabaseRest_('POST','/rest/v1/anonyms_gallery_likes',[{gallery_id:galleryId,username:user,created_at:new Date().toISOString()}],'return=minimal');
  return {ok:true,liked:true};
}
function getSupabaseGalleryComments_(galleryId) {
  galleryId = String(galleryId || '');
  if (!rowsAsObjects_('Gallery').some(r => String(r.id) === galleryId)) throw new Error('Gallery item not found.');
  const comments = supabaseRest_('GET','/rest/v1/anonyms_gallery_comments?select=id,gallery_id,username,comment,created_at&gallery_id=eq.'+encodeURIComponent(galleryId)+'&order=created_at.asc&limit=100',null) || [];
  return {ok:true,comments:comments};
}
function addSupabaseGalleryComment_(user, galleryId, comment) {
  galleryId = String(galleryId || ''); comment = String(comment || '').trim();
  if (!rowsAsObjects_('Gallery').some(r => String(r.id) === galleryId)) throw new Error('Gallery item not found.');
  if (!comment || comment.length > 1000) throw new Error('Comment must contain 1–1000 characters.');
  const row = supabaseRest_('POST','/rest/v1/anonyms_gallery_comments',[{gallery_id:galleryId,username:user,comment:comment,created_at:new Date().toISOString()}],'return=representation')[0];
  return {ok:true,comment:row};
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

function inferMediaMime_(filename, suppliedMime) {
  const mime = String(suppliedMime || '').trim().toLowerCase().split(';')[0].trim();
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) return mime;
  const ext = String(filename || '').split('.').pop().toLowerCase();
  const known = {
    png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', jfif:'image/jpeg', gif:'image/gif',
    webp:'image/webp', svg:'image/svg+xml', avif:'image/avif', heic:'image/heic', heif:'image/heif',
    bmp:'image/bmp', tif:'image/tiff', tiff:'image/tiff', ico:'image/vnd.microsoft.icon',
    mp4:'video/mp4', m4v:'video/x-m4v', mov:'video/quicktime', webm:'video/webm',
    mkv:'video/x-matroska', avi:'video/x-msvideo', mpeg:'video/mpeg', mpg:'video/mpeg',
    '3gp':'video/3gpp', ogv:'video/ogg', ts:'video/mp2t',
    ogg:'audio/ogg', oga:'audio/ogg', mp3:'audio/mpeg', m4a:'audio/mp4',
    wav:'audio/wav', aac:'audio/aac', opus:'audio/ogg'
  };
  return known[ext] || mime;
}

function grantPrivateViewers_(fileId) {
  const props = PropertiesService.getScriptProperties();
  const emails = [props.getProperty('ANONYMS_KEVEN_EMAIL'), props.getProperty('ANONYMS_ZUBII_EMAIL')]
    .map(value => String(value || '').trim()).filter(Boolean);
  if (emails.length !== 2) throw new Error('Configure ANONYMS_KEVEN_EMAIL and ANONYMS_ZUBII_EMAIL before uploading media.');
  emails.forEach(email => {
    const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/permissions?supportsAllDrives=true&sendNotificationEmail=false';
    const response = UrlFetchApp.fetch(url, {
      method:'post', contentType:'application/json; charset=UTF-8',
      headers:{Authorization:'Bearer ' + ScriptApp.getOAuthToken()},
      payload:JSON.stringify({type:'user', role:'reader', emailAddress:email}),
      muteHttpExceptions:true
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      let detail = '';
      try { detail = JSON.parse(response.getContentText() || '{}').error.message || ''; } catch (_) {}
      throw new Error('Could not grant private media access to a configured account (' + code + '). ' + detail.slice(0,140));
    }
  });
}

function startResumableUpload_(user, payload) {
  const name = String(payload.filename || 'upload').replace(/[\\/\\r\\n]/g, '_').slice(0, 160);
  const purpose = String(payload.purpose || 'gallery');
  const mime = inferMediaMime_(name, payload.mime_type || '');
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : '';
  const isVoice = purpose === 'voice' && mime.startsWith('audio/');
  const size = Number(payload.size);
  if ((!type && !isVoice) || !Number.isFinite(size) || size <= 0) throw new Error('Choose a supported photo/video file or record a voice note.');
  const folderId = PropertiesService.getScriptProperties().getProperty(CFG.DRIVE_FOLDER_PROPERTY);
  if (!folderId) throw new Error('Run setupAnonyms() first.');
  const response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size', {
    method: 'post', contentType: 'application/json; charset=UTF-8',
    headers: {Authorization:'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type':mime, 'X-Upload-Content-Length':String(size)},
    payload: JSON.stringify({name:name, mimeType:mime, parents:[folderId], description:'Anonyms private media uploaded by ' + user}),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('Google Drive could not start this upload (' + response.getResponseCode() + ').');
  const headers = response.getAllHeaders();
  const sessionUrl = headers.Location || headers.location;
  if (!sessionUrl) throw new Error('Google Drive did not return an upload session.');
  const uploadId = Utilities.getUuid(), cache = CacheService.getScriptCache();
  const meta = {user:user, purpose:isVoice?'voice':'gallery', filename:name, mime_type:mime, size:size, title:String(payload.title || name).slice(0,120), duration_seconds:Math.max(1,Number(payload.duration_seconds)||1), session_url:String(sessionUrl), created_at:new Date().toISOString()};
  cache.put('anonyms_upload_' + uploadId, JSON.stringify(meta), 21600);
  return {ok:true, upload_id:uploadId, chunk_size:1024*1024};
}

function uploadChunk_(user, payload) {
  const uploadId = String(payload.upload_id || '');
  const key = 'anonyms_upload_' + uploadId;
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key);
  if (!raw) throw new Error('Upload session expired. Please select the file again.');
  const meta = JSON.parse(raw);
  if (meta.user !== user) throw new Error('This upload does not belong to your session.');
  const start = Number(payload.start), end = Number(payload.end), total = Number(payload.total);
  if (!Number.isInteger(start) || !Number.isInteger(end) || total !== meta.size || start < 0 || end < start || end >= total) throw new Error('Invalid upload chunk range.');
  const bytes = Utilities.base64Decode(String(payload.base64 || ''));
  if (!bytes.length || bytes.length !== end - start + 1) throw new Error('Upload chunk size does not match its range.');
  const response = UrlFetchApp.fetch(meta.session_url, {
    method: 'put',
    contentType: meta.mime_type,
    headers: {Authorization:'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Range':'bytes ' + start + '-' + end + '/' + total},
    payload: bytes,
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code === 308) return {ok:true, complete:false};
  if (code !== 200 && code !== 201) throw new Error('Google Drive upload failed (' + code + '). Please retry the file.');
  const file = JSON.parse(response.getContentText() || '{}');
  if (!file.id) throw new Error('Google Drive finished without returning a file ID.');
  const now = new Date().toISOString(), id = Utilities.getUuid();
  cache.remove(key);
  if (meta.purpose === 'voice') {
    // Voice notes are stored in private Supabase Storage. They do not need Drive
    // sharing, so do not attempt to grant Google Drive viewer permissions.
    try {
      const driveFile = DriveApp.getFileById(file.id);
      const saved = saveSupabaseVoiceNote_(user,driveFile,meta.mime_type,meta.duration_seconds);
      return {ok:true,complete:true,message:saved.message};
    } catch (error) {
      // Keep the Drive copy as a recovery fallback if Supabase is temporarily unavailable.
      throw new Error('Voice note reached Drive but could not be saved to Supabase. ' + safeError_(error));
    }
  }
  // Gallery media still uses the existing private Drive-sharing behavior.
  try { grantPrivateViewers_(file.id); }
  catch (error) {
    try { DriveApp.getFileById(file.id).setTrashed(true); } catch (_) {}
    throw error;
  }
  const mediaType = meta.mime_type.startsWith('image/') ? 'image' : 'video';
  withLock_(() => sheet_('Gallery').appendRow([id,user,meta.title,'',mediaType,'drive',file.id,'',meta.mime_type,now]));
  return {ok:true,complete:true,item:{id:id,uploader:user,title:meta.title,caption:'',media_type:mediaType,source:'drive',drive_file_id:file.id,mime_type:meta.mime_type,media_url:'https://drive.google.com/uc?export=view&id='+file.id,preview_url:'https://drive.google.com/file/d/'+file.id+'/preview',created_at:now}};
}

function sendVoiceNote_(user, payload) {
  const mime = String(payload.mime_type || 'audio/webm').split(';')[0];
  if (!mime.startsWith('audio/')) throw new Error('This is not a supported audio recording.');
  const bytes = Utilities.base64Decode(String(payload.base64 || ''));
  if (!bytes.length || bytes.length > CFG.MAX_UPLOAD_BYTES) throw new Error('Voice note is too large. Please record a shorter note and try again.');
  // Voice recordings are small at 32 kbps. Store the posted bytes directly in
  // private Supabase Storage instead of round-tripping them through Google Drive.
  const blob = Utilities.newBlob(bytes,mime,String(payload.filename || 'voice-note.webm').replace(/[\\/\\r\\n]/g,'_').slice(0,160));
  const saved = saveSupabaseVoiceNoteBlob_(user,blob,mime,payload.duration_seconds);
  return {ok:true,message:saved.message};
}

function uploadMedia_(user, payload) {
  const mime = String(payload.mime_type || '');
  const name = String(payload.filename || 'upload').replace(/[\\/\\r\\n]/g, '_').slice(0, 160);
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : '';
  if (!type) throw new Error('Only image and video files are supported.');
  const bytes = Utilities.base64Decode(String(payload.base64 || ''));
  if (!bytes.length || bytes.length > CFG.MAX_UPLOAD_BYTES) throw new Error('This upload is too large for the legacy upload path. Please use the resumable uploader.');
  const blob = Utilities.newBlob(bytes, mime, name);
  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty(CFG.DRIVE_FOLDER_PROPERTY));
  const file = folder.createFile(blob);
  // Keep files private; grant viewer access only to the two configured Google accounts.
  const props = PropertiesService.getScriptProperties();
  const allowedEmails = [props.getProperty('ANONYMS_KEVEN_EMAIL'), props.getProperty('ANONYMS_ZUBII_EMAIL')].filter(Boolean);
  if (allowedEmails.length !== 2) { file.setTrashed(true); throw new Error('Configure ANONYMS_KEVEN_EMAIL and ANONYMS_ZUBII_EMAIL before uploading media.'); }
  allowedEmails.forEach(email => file.addViewer(email));
  const now = new Date().toISOString();
  const id = Utilities.getUuid();
  withLock_(() => sheet_('Gallery').appendRow([id, user, String(payload.title || name).slice(0, 120), String(payload.caption || '').slice(0, 500), type, 'drive', file.getId(), '', mime, now]));
  return { ok: true, item: { id: id, uploader: user, title: String(payload.title || name).slice(0, 120), caption: String(payload.caption || ''), media_type: type, source: 'drive', drive_file_id: file.getId(), mime_type: mime, media_url: 'https://drive.google.com/uc?export=view&id=' + file.getId(), preview_url: 'https://drive.google.com/file/d/' + file.getId() + '/preview', created_at: now } };
}


function getGallery_(activeGalleryUser) {
  const likes = supabaseRest_('GET', '/rest/v1/anonyms_gallery_likes?select=gallery_id,username,created_at&order=created_at.asc', null) || [];
  const comments = supabaseRest_('GET', '/rest/v1/anonyms_gallery_comments?select=gallery_id,username,comment,created_at&order=created_at.asc', null) || [];
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
  const peerName = user === 'Keven' ? 'Zubii' : 'Keven';
  const now = Date.now();
  const rows = rowsAsObjects_('Sessions').filter(r => r.username === peerName && r.last_seen);
  if (!rows.length) return { username: peerName, online: false, last_seen: null };
  rows.sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)));
  const active = rows.find(r => new Date(r.expires_at).getTime() > now && now - new Date(r.last_seen).getTime() < 30000);
  const latest = active || rows[0];
  return { username: peerName, online: !!active, last_seen: latest.last_seen };
}


function requestCall_(user) {
  const peer = user === 'Keven' ? 'Zubii' : 'Keven';
  if (!peerStatus_(user).online) throw new Error('Video not possible due to ' + peer + ' offline.');
  const active = rowsAsObjects_('Calls').filter(r => ['pending','accepted'].includes(String(r.status)) && (r.caller === user || r.callee === user));
  if (active.length) throw new Error('A video session is already pending or active.');
  const now = new Date().toISOString();
  const item = {id:Utilities.getUuid(), caller:user, callee:peer, status:'pending', created_at:now, updated_at:now, ended_by:''};
  withLock_(() => sheet_('Calls').appendRow([item.id,item.caller,item.callee,item.status,item.created_at,item.updated_at,item.ended_by]));
  return {ok:true, call:item};
}
function respondCall_(user, callId, decision) {
  if (!['accept','decline'].includes(String(decision))) throw new Error('Invalid call response.');
  const call = findCall_(callId);
  if (!call || call.callee !== user || call.status !== 'pending') throw new Error('This video request is no longer available.');
  const status = decision === 'accept' ? 'accepted' : 'declined';
  updateCall_(call.id, {status:status, updated_at:new Date().toISOString(), ended_by:decision === 'decline' ? user : ''});
  return {ok:true, call:Object.assign({},call,{status:status})};
}
function addCallSignal_(user, callId, type, payload) {
  const allowed = ['offer','answer','ice'];
  if (!allowed.includes(String(type))) throw new Error('Invalid video signal.');
  const call = findCall_(callId);
  if (!call || ![call.caller,call.callee].includes(user) || call.status !== 'accepted') throw new Error('Video session is not active.');
  const to = user === call.caller ? call.callee : call.caller;
  const data = JSON.stringify(payload || {});
  if (data.length > 45000) throw new Error('Video connection signal is too large.');
  withLock_(() => sheet_('CallSignals').appendRow([Utilities.getUuid(),call.id,user,to,String(type),data,new Date().toISOString()]));
  return {ok:true};
}
function pollCall_(user, cursor) {
  let allCalls = rowsAsObjects_('Calls').filter(r => r.caller === user || r.callee === user);
  allCalls.sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)));
  let call = allCalls.length ? allCalls[allCalls.length - 1] : null;
  if (call && ['pending','accepted'].includes(String(call.status))) {
    const peer = call.caller === user ? call.callee : call.caller;
    if (!peerStatus_(user).online) {
      updateCall_(call.id, {status:'ended',updated_at:new Date().toISOString(),ended_by:peer});
      call = Object.assign({},call,{status:'ended',updated_at:new Date().toISOString(),ended_by:peer});
    } else {
      const refreshed = findCall_(call.id);
      if (refreshed) call = refreshed;
    }
  }
  const sh = sheet_('CallSignals');
  const values = sh.getDataRange().getValues();
  const after = Math.max(0, Number(cursor) || 0);
  const signals = [];
  for (let i = Math.max(1, after + 1); i < values.length; i++) {
    const row = values[i];
    if (String(row[1]) !== String(call && call.id || '') || String(row[3]) !== user) continue;
    let payload = {};
    try { payload = JSON.parse(String(row[5] || '{}')); } catch (_) {}
    signals.push({seq:i, id:String(row[0]), call_id:String(row[1]), from_user:String(row[2]), type:String(row[4]), payload:payload});
  }
  return {ok:true, call:call, signals:signals, cursor:Math.max(0,values.length - 1)};
}
function endCall_(user, callId) {
  const call = findCall_(callId);
  if (!call || ![call.caller,call.callee].includes(user)) return {ok:true};
  if (['pending','accepted'].includes(String(call.status))) updateCall_(call.id,{status:'ended',updated_at:new Date().toISOString(),ended_by:user});
  return {ok:true};
}
function findCall_(callId) {
  const id = String(callId || '');
  if (!id) return null;
  const rows = rowsAsObjects_('Calls');
  const row = rows.find(r => String(r.id) === id);
  return row || null;
}
function updateCall_(callId, updates) {
  const sh = sheet_('Calls'), values = sh.getDataRange().getValues();
  const headers = values[0] || [];
  const idCol = headers.indexOf('id');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) !== String(callId)) continue;
    Object.keys(updates).forEach(key => { const col = headers.indexOf(key); if (col >= 0) sh.getRange(i + 1,col + 1).setValue(updates[key]); });
    return;
  }
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
  for (let i = values.length - 1; i >= 1; i--) if (values[i][0] === hash) {
    const now = new Date().toISOString();
    sh.getRange(i + 1, 4).setValue(now);
    sh.getRange(i + 1, 5).setValue(now);
  }
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
