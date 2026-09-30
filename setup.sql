-- =====================================================================
-- Zubii ❤️ Keven — private chat
-- Run this whole file in: Supabase Dashboard → SQL Editor → New query → Run
-- (Do STEP 1 in the Dashboard first, see README.md)
-- =====================================================================

-- 1) Table ------------------------------------------------------------
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  username   text        not null check (username in ('Zubii', 'Keven')),
  message    text        not null check (char_length(btrim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- 2) Index ------------------------------------------------------------
create index if not exists messages_created_at_idx
  on public.messages (created_at desc, id desc);

-- 3) Helper: which of the two people is signed in? --------------------
--    Returns 'Zubii', 'Keven', or NULL for anybody else.
--    The identity comes from the signed JWT that Supabase Auth issued
--    after checking the password on the server.
create or replace function public.current_chat_user()
returns text
language sql
stable
as $$
  select case lower(coalesce(auth.jwt() ->> 'email', ''))
    when 'zubii@ourprivatechat.app' then 'Zubii'
    when 'keven@ourprivatechat.app' then 'Keven'
    else null
  end;
$$;

-- 4) Row Level Security ----------------------------------------------
alter table public.messages enable row level security;
alter table public.messages force  row level security;

-- Start clean so this file can be re-run safely
drop policy if exists "chat members can read"   on public.messages;
drop policy if exists "chat members can insert" on public.messages;

-- Only Zubii or Keven (signed in) can read. No policy for `anon` => anonymous
-- visitors get zero rows.
create policy "chat members can read"
  on public.messages
  for select
  to authenticated
  using (public.current_chat_user() is not null);

-- Only Zubii or Keven can write, and only as themselves.
create policy "chat members can insert"
  on public.messages
  for insert
  to authenticated
  with check (username = public.current_chat_user());

-- No UPDATE / DELETE policies => nobody can edit or delete history via the API.

-- 5) Privileges (belt and braces on top of RLS) -----------------------
revoke all on public.messages from anon;
revoke all on public.messages from authenticated;
grant select, insert on public.messages to authenticated;

-- 6) Realtime ---------------------------------------------------------
-- Adds the table to the publication Supabase Realtime listens to.
-- Realtime respects the SELECT policy above, so only Zubii/Keven receive events.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
