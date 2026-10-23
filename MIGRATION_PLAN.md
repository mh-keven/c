# Anonyms migration plan

## Target architecture
- **GitHub Pages:** keep the existing frontend and URL.
- **Supabase:** Auth, PostgreSQL, Realtime messaging/presence, voice-note storage, gallery metadata, likes and comments.
- **Google Drive:** keep private original gallery photos/videos. Supabase stores Drive file IDs and metadata, not original media bytes.
- **Cloudflare Realtime SFU:** use for live audio/video media. A server-side endpoint must authorize call sessions; never put Cloudflare API secrets in browser JavaScript.
- **Temporary compatibility:** keep the current Apps Script deployment available until the Supabase version is tested end-to-end.

## Repository baseline audited
The current main frontend calls the Google Apps Script /exec endpoint for login, messages, status, gallery, likes/comments, Drive uploads and WebRTC signaling. The Google backend stores records in Sheets. There is no setup.sql at the current main branch, and script.js explicitly says it is Google Apps Script only. Do not assume an older Supabase schema is still installed.

## Phase 1 — database foundation
1. In Supabase Dashboard → SQL Editor, run supabase/schema.sql only after confirming the intended Anonyms project.
2. In Supabase Authentication → Users, create exactly two accounts, one for Keven and one for Zubii. Set each user's metadata username to exactly Keven or Zubii. Do not enable public sign-ups.
3. Verify the trigger created one matching row in public.profiles for each Auth user.
4. In Authentication URL configuration, allow https://mh-keven.github.io/c/ and the local development URL if used.
5. Store only the Supabase project URL and publishable/anon key in frontend configuration. Never expose a service-role key.

## Phase 2 — frontend integration
- Replace Apps Script calls for login/session, text messages, voice notes, likes/comments, and presence with Supabase Auth/Postgres/Realtime.
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
