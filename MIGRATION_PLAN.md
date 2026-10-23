# Anonyms migration plan

## Target architecture
- **GitHub Pages:** keep the existing frontend and URL.
- **Supabase:** Auth, PostgreSQL, Realtime messaging/presence, voice-note storage, gallery metadata, likes and comments.
- **Google Drive:** keep private original gallery photos/videos. Supabase stores Drive file IDs and metadata, not original media bytes.
- **Cloudflare Realtime SFU:** use for live audio/video media. A server-side endpoint must authorize call sessions; never put Cloudflare API secrets in browser JavaScript.
- **Temporary compatibility:** keep the current Apps Script deployment available until the Supabase version is tested end-to-end.

## Repository baseline audited
The current main frontend calls the Google Apps Script /exec endpoint for login, messages, status, gallery, likes/comments, Drive uploads and WebRTC signaling. The Google backend stores records in Sheets. The previous Supabase code used an anonymous Supabase Auth session plus server-side RPC functions (chat_login/chat_whoami) and a private voice-notes bucket. The current main branch no longer includes its base schema, so confirm the existing project functions before applying this additive SQL.

## Phase 1 — database foundation
1. Confirm the existing Supabase project URL is https://czqijodfoidzejgwblrf.supabase.co before running anything.
2. In Supabase Dashboard → SQL Editor, run supabase/schema.sql only after verifying the existing chat_login/current_chat_user functions are present. This file is an additive migration for the prior custom-login model; it does not create new Auth users or replace existing login functions.
3. Confirm Anonymous sign-ins remain enabled because the old frontend establishes an anonymous Supabase Auth session and verifies the entered username/password through server-side RPC.
4. Verify the private voice-notes bucket and gallery_likes/gallery_comments policies were created.
5. Store only the project URL and publishable/anon key in frontend configuration. Never expose a service-role key.

## Phase 2 — frontend integration
- Keep the existing custom username/password login flow, backed by Supabase anonymous Auth plus the server-side chat_login/chat_whoami RPCs. Replace Apps Script calls for text messages, voice notes, likes/comments, and presence with Supabase Postgres/Realtime.
- Keep gallery file uploads/download authorization on the Google Drive backend until a server-side authorization bridge is implemented. Do not expose Apps Script owner credentials or Drive OAuth tokens.
- Map each signed-in Supabase user to the matching Google account email for Drive permissions. Ensure only Keven and Zubii can view the private Drive folder/files.
- Keep the old backend available during migration; do not delete data or turn it off yet.
- Use Realtime subscriptions instead of polling for messages; use Supabase Presence for online status.

## Phase 3 — video calls
- Keep browser WebRTC for media, but use Cloudflare Realtime SFU for media transport.
- Add a server-side endpoint (e.g. Supabase Edge Function) that validates the authenticated Anonyms user and creates/authorizes a call session. Store Cloudflare account/API credentials only as server-side secrets.
- Use Supabase Realtime Broadcast or protected call-room state for invitations and status. Never let the browser choose arbitrary users or access another private call room.
- Test on both devices and at least two network types. If Cloudflare setup or free limits are unsuitable, use direct WebRTC with a TURN fallback as a separately tested option.

## Phase 4 — data migration and cutover
- Export Sheets tabs (Messages, Gallery, Likes, Comments) to CSV/JSON before import.
- Import only after schema and access policies are verified. Preserve old IDs/timestamps where possible; map Keven/Zubii rows to Supabase Auth UUIDs.
- Existing voice-note binaries remain in Drive until downloaded/re-uploaded to the private Supabase Storage bucket and playback is tested. The SQL schema does not copy files automatically.
- Do not migrate private gallery binaries from Drive unless requested; store Drive file IDs and metadata in Supabase.
- Run acceptance tests: both logins, realtime text, reload/history, voice-note record/playback, private gallery viewing, likes/comments, online/offline status, call accept/decline/end, reconnect, logout and cross-account isolation.

## Not yet live
Adding these files does not change the deployed site, create Supabase Auth users, move records/files, deploy an Edge Function, or configure Cloudflare. Those steps require dashboard setup and project secrets. Do not cut over until both users pass acceptance tests.
