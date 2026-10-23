# Anonyms calling — Cloudflare Realtime SFU

This folder documents the intended call transport; it is not yet a deployed integration.

## Why an SFU
The current WebRTC code uses public STUN servers only and exchanges SDP/ICE through Apps Script polling. A dedicated SFU can relay media and reduce dependence on a direct peer-to-peer route. It does not eliminate poor network bandwidth or high device CPU use, and it still requires signaling/session setup.

## Security rules
- Never place Cloudflare API tokens, account secrets, or service-role credentials in script.js, HTML, or any public GitHub file.
- Call credentials/session tokens must be issued by a server-side function after checking the Supabase Auth session and that the user is one of the two provisioned Anonyms profiles.
- Restrict each room to the two allowed participants; validate invite/accept/end events server-side.
- Use short-lived credentials and do not log tokens.

## Implementation sequence
1. Confirm Cloudflare Realtime is enabled for the account and review current pricing/limits.
2. Add secrets to a Supabase Edge Function: Cloudflare account identifier and API token with minimum required permissions.
3. Implement an authenticated Edge Function to create/authorize a call session and return only short-lived client credentials.
4. Use Supabase Realtime Broadcast or protected call-room state for invitations and status.
5. Integrate the Cloudflare WebRTC SDK/protocol into a dedicated call.html page, retaining the same GitHub Pages origin and Supabase session.
6. Test incoming/outgoing calls, accept/decline/end, camera/microphone permissions, network changes, reconnects, and failure messages.

No Cloudflare SDK or token endpoint is added yet because account-specific API configuration and current SDK/API contract must be confirmed before writing production calling code.
