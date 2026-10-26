-- Secure direct-chat RPCs for the two existing Anonyms accounts.
-- Apply in Supabase SQL Editor after anonyms_bridge.sql.
-- The browser receives only the public anon key. Service-role credentials stay in Apps Script.
begin;

create table if not exists public.anonyms_sessions (
  token_hash text primary key,
  username text not null check (username in ('Keven','Zubii')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.anonyms_sessions enable row level security;
revoke all on public.anonyms_sessions from anon, authenticated;
grant all on public.anonyms_sessions to service_role;

create or replace function public.anonyms_fast_messages(
  p_token_hash text,
  p_before timestamptz default null,
  p_after timestamptz default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  username text,
  message text,
  created_at timestamptz,
  media_type text,
  media_path text,
  duration_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 200);
begin
  if not exists (
    select 1 from public.anonyms_sessions s
    where s.token_hash = p_token_hash
      and s.revoked_at is null
      and s.expires_at > now()
  ) then
    raise exception 'Session expired. Please log in again.';
  end if;

  if p_before is not null then
    return query
      select m.id, m.username, m.message, m.created_at, m.media_type, m.media_path, m.duration_seconds
      from (
        select am.*
        from public.anonyms_messages am
        where am.created_at < p_before
        order by am.created_at desc
        limit v_limit
      ) m
      order by m.created_at asc;
  elsif p_after is not null then
    return query
      select am.id, am.username, am.message, am.created_at, am.media_type, am.media_path, am.duration_seconds
      from public.anonyms_messages am
      where am.created_at >= p_after
      order by am.created_at asc
      limit v_limit;
  else
    return query
      select m.id, m.username, m.message, m.created_at, m.media_type, m.media_path, m.duration_seconds
      from (
        select am.*
        from public.anonyms_messages am
        order by am.created_at desc
        limit v_limit
      ) m
      order by m.created_at asc;
  end if;
end;
$$;

create or replace function public.anonyms_fast_delete(
  p_token_hash text,
  p_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $
declare v_username text;
begin
  select s.username into v_username from public.anonyms_sessions s
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
  limit 1;
  if v_username is null then raise exception 'Session expired. Please log in again.'; end if;
  delete from public.anonyms_messages where id = p_message_id and username = v_username;
  return found;
end;
$;

create or replace function public.anonyms_fast_send(
  p_token_hash text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_message text := btrim(coalesce(p_message, ''));
  v_row public.anonyms_messages%rowtype;
begin
  select s.username into v_username
  from public.anonyms_sessions s
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
  limit 1;

  if v_username is null then
    raise exception 'Session expired. Please log in again.';
  end if;
  if char_length(v_message) < 1 or char_length(v_message) > 2000 then
    raise exception 'Message must contain 1–2000 characters.';
  end if;

  insert into public.anonyms_messages (username, message, media_type, created_at)
  values (v_username, v_message, 'text', now())
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'username', v_row.username,
    'message', v_row.message,
    'created_at', v_row.created_at,
    'media_type', v_row.media_type,
    'media_id', '',
    'media_url', '',
    'media_mime', '',
    'duration_seconds', null
  );
end;
$$;

revoke all on function public.anonyms_fast_messages(text,timestamptz,timestamptz,integer) from public;
revoke all on function public.anonyms_fast_send(text,text) from public;
revoke all on function public.anonyms_fast_delete(text,uuid) from public;
grant execute on function public.anonyms_fast_messages(text,timestamptz,timestamptz,integer) to anon, authenticated;
grant execute on function public.anonyms_fast_send(text,text) to anon, authenticated;
grant execute on function public.anonyms_fast_delete(text,uuid) to anon, authenticated;

commit;
