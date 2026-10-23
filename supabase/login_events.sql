-- Anonyms login audit log.
-- Apply this SQL in the Supabase SQL Editor.
-- IMPORTANT: write events from the trusted Google Apps Script backend only.
-- Never send the service-role key to the browser or commit it to GitHub.

begin;

create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  username text not null check (username in ('Keven', 'Zubii')),
  event_type text not null check (event_type in ('login_success', 'login_failure', 'logout')),
  occurred_at timestamptz not null default now(),
  request_id text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists login_events_occurred_at_idx
  on public.login_events (occurred_at desc);

alter table public.login_events enable row level security;
alter table public.login_events force row level security;

-- No browser/regular authenticated client can read or write audit events.
revoke all on public.login_events from anon, authenticated;
grant all on public.login_events to service_role;

commit;
