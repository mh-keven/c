# Anonyms — Google Sheets + Drive backend

This is the Google backend for the clean-start Anonyms frontend now committed to `main`. The frontend no longer uses Supabase. The Google Apps Script project itself must still be updated and redeployed manually before the new backend fixes are live.

## Services
- Google Sheets: messages, gallery metadata, session hashes, video-call state, and WebRTC signaling messages.
- Google Drive: uploaded photos/videos in a private folder.
- Google Apps Script: login checks, session validation, API operations, presence checks, and video-call signaling.
- YouTube: unlisted video hosting; only video ID and metadata are stored in Sheets.

## Setup
1. Create a Google Apps Script project at https://script.google.com/.
2. Copy `Code.gs` into its editor.
3. In **Project Settings → Script properties**, add:
   - `ANONYMS_USER_KEVEN_PASSWORD`: a long, unique password for Keven.
   - `ANONYMS_USER_ZUBII_PASSWORD`: a different long, unique password for Zubii.
   - `ANONYMS_KEVEN_EMAIL`: Keven's Google account email.
   - `ANONYMS_ZUBII_EMAIL`: Zubii's Google account email.
4. Run `setupAnonyms()` and approve the Google permissions. It creates missing tabs (including Calls and CallSignals) and a private Drive folder; existing rows are not erased. Open **Execution log** to find the spreadsheet URL. You can safely rerun it after adding new sheet definitions if the existing header rows match.
5. Deploy → New deployment → **Web app**. Execute as **you**. Set access to **Anyone** so the login page can call the API; application access is still checked by the script. Copy the deployment URL ending in `/exec`.
6. Do not share the spreadsheet or Drive folder publicly. Keep both passwords and the script editor access private.
7. The current frontend is configured with the existing `/exec` deployment URL. If you create a new Apps Script deployment, update `API_URL` in `script.js` to the new URL before publishing.

## Video calls
- The chat includes a compact left-side panel with Request to Start Video, incoming Accept/Decline, remote-video-only display, and one End button.
- Camera and microphone permissions are requested only after the recipient accepts. The page does not show a self-view or offer mute/camera-toggle controls.
- Ending the call, logging out, navigating away, closing the page, or detecting a disconnected peer triggers local media-track cleanup. Browsers cannot guarantee page-unload cleanup after a crash or power loss.
- Calls use browser WebRTC with public STUN servers. Some restrictive networks require a TURN relay; configure a trusted TURN service before relying on calls across all networks.
- The Apps Script database is used for signaling/presence only, not for transporting live audio/video.

## Important limitations and privacy
- Google Apps Script is not a high-throughput realtime database. The initial implementation uses polling and is intended for a small, two-person chat.
- Drive media is shared only with the two configured Google account emails. Both users must use those Google accounts in their browser to preview media.
- Device uploads are capped at 8 MB in this initial endpoint to stay within Apps Script request/runtime constraints. Large videos need a resumable Drive upload flow rather than base64-through-Apps-Script.
- Unlisted YouTube videos are not private: anyone with the link can watch them, and embedding may be disabled by the uploader.
- Apps Script web apps have quotas and response-size limits. This backend must be tested with your actual Google accounts before use.
- Do not store Google passwords or OAuth refresh tokens in Sheets. The app passwords belong only in Script Properties. Script Properties are accessible to project editors, so only trusted people should have editor access.

## Current status
The Google-backed frontend and backend source are merged into `main`. GitHub Pages may publish the frontend automatically from `main`; this repository change does not update the separate Google Apps Script deployment. After updating `Code.gs` in Apps Script, run `setupAnonyms()` and deploy a new web-app version, then test both logins, messages, uploads, likes/comments, and video calls. Voice-note recording/playback from the old Supabase version is not included in this clean-start build.
