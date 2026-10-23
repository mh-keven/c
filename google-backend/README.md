# Anonyms — Google Sheets + Drive backend

This is a fresh backend for Anonyms. It does not use Supabase. It is deliberately kept separate from the current live frontend until the Google deployment has been configured and tested.

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
4. Run `setupAnonyms` manually once and approve the Google permissions. It creates the Sheets database and a private Drive folder. Open **Execution log** to find the spreadsheet URL.
5. Deploy → New deployment → **Web app**. Execute as **you**. Set access to **Anyone** so the login page can call the API; application access is still checked by the script. Copy the deployment URL ending in `/exec`.
6. Do not share the spreadsheet or Drive folder publicly. Keep both passwords and the script editor access private.
7. Add the deployment URL to the frontend configuration only after reviewing and testing the deployment.

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
The migration branch replaces the root frontend with the Google-backed chat/gallery UI and includes this backend foundation. It does not deploy the Apps Script project or configure the frontend API URL automatically. Voice-note recording/playback from the old version is not yet included in this first migration pass. Keep this PR in draft until Google API setup, account sharing, and browser flows are tested end to end.
