# Anonyms faster chat and voice uploads

This change adds a direct Supabase path for chat text and voice-note bytes while keeping the existing Google Apps Script session login and video-call signaling.

## One-time setup

1. In Supabase, open **SQL Editor** and run [anonyms_fast_chat.sql](./anonyms_fast_chat.sql). It creates a server-side session-hash table and two narrowly scoped RPC functions. It does not grant browser clients direct table access.
2. In **Apps Script → Project Settings → Script Properties**, add **SUPABASE_ANON_KEY** with your project's **public anon key** (the client/public key). Keep **SUPABASE_SERVICE_ROLE_KEY** in Script Properties only. Never put the service-role key in **script.js** or the browser.
3. Copy the latest [google-backend/Code.gs](../google-backend/Code.gs) into the existing Apps Script project, save it, then **Deploy → Manage deployments → Edit → New version → Deploy**. Keep the existing Web App URL.
4. Hard-refresh the GitHub Pages site. Log in again or reload once so the backend syncs the current session hash into Supabase.

The browser uses the public anon key only to call the two RPC functions. The functions validate the session hash against **anonyms_sessions** and do not expose direct SELECT or INSERT access to the messages table. Direct chat automatically falls back to the existing Apps Script API if the SQL migration/key isn't configured.

## Voice notes

With the public key configured, Apps Script creates a one-object signed upload URL, the browser sends the audio bytes directly to the private Supabase Storage bucket, and Apps Script finalizes the message record and returns a signed playback URL. The audio blob no longer passes through Google Sheets, Google Drive, or Apps Script. Deploy the updated **Code.gs** before testing this path.

The pre-existing **anonyms_bridge.sql** migration must already be applied and the **anonyms-voice-notes** bucket must exist. Without the public key, voice notes fall back to a single Apps Script request that writes the blob directly to Supabase Storage without a Drive copy.
