# Anonyms fresh Supabase setup and migration plan

## Target architecture
- **Current frontend:** still uses Google Apps Script. Do not switch it until the new frontend is implemented and tested.
- **Supabase:** new Auth-linked profiles, PostgreSQL messages, private voice notes, gallery metadata, likes/comments, call invitation metadata, and Realtime.
- **Google Drive:** keep private original gallery photos/videos in Drive.
- **Video calls:** evaluate Cloudflare Realtime SFU or a tested WebRTC + TURN option. The SQL table only stores call state; it does not transport audio/video.
- **Google Apps Script / Sheets:** preserve as the current working backend until cutover.

## Fresh schema
`supabase/schema.sql` now creates the tables and policies from a clean database foundation. It does not require the old custom RPC functions, does not create Auth users, does not import old records/files, and does not update the deployed frontend.

### Before running
1. Confirm Supabase Dashboard project ref is `czqijodfoidzejgwblrf`.
2. Open SQL Editor and run the complete `supabase/schema.sql` from this branch after reviewing it.
3. Confirm tables `chat_profiles`, `messages`, `gallery_items`, `gallery_likes`, `gallery_comments`, and `call_sessions` exist.
4. Confirm private `voice-notes` Storage bucket and RLS policies exist.
5. Create/link the two approved Supabase Auth users (Keven and Zubii) to `chat_profiles` through a trusted admin/server-side setup. Never put passwords or service-role keys in browser code.
6. The existing frontend remains Apps Script-only. Database creation alone does not enable Supabase messaging.

## Important security/design notes
- The frontend must use Supabase Auth identities and rows in `chat_profiles`; the old Apps Script token cannot be used as a Supabase session.
- Only approved profiles should be inserted by a trusted setup step. Do not allow public signup to create arbitrary chat profiles.
- Voice-note object paths must start with the authenticated user's UUID, e.g. `<auth-user-uuid>/<file-name>`.
- Gallery binaries remain in Drive. Do not make the Drive folder public or expose OAuth/service credentials.
- Never expose Supabase service-role keys in frontend JavaScript or GitHub.
- The SQL file is intended for a fresh install; rerunning it is mostly idempotent, but review all changes before applying it to any populated project.

## Next phases
1. Apply and verify the schema.
2. Add a secure bootstrap flow for the two users and test RLS.
3. Implement the Supabase client/auth in a separate branch; retain the current Apps Script version as fallback.
4. Move text messages and presence to Supabase Realtime.
5. Add voice-note upload/playback using private Storage.
6. Connect likes/comments and gallery metadata to Supabase while keeping Drive file operations server-side.
7. Implement call authorization/signaling and choose the media transport after testing pricing/free-tier limits.
8. Export Google Sheets records before any optional import; verify both accounts end-to-end before cutover.

## Not yet live
Committing SQL does not run it in Supabase, create users, move data/files, deploy server functions, configure Cloudflare, or change the live site. These are separate steps.
