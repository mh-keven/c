-- Faster secure voice-note finalization for Anonyms.
-- Run this in the Supabase SQL Editor after anonyms_bridge.sql and anonyms_fast_chat.sql.
-- The browser only receives the public anon key; it never receives the service-role key.

create or replace function public.anonyms_fast_send_voice(
  p_token_hash text,
  p_media_path text,
  p_mime_type text,
  p_duration_seconds integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_username text;
  v_path text := coalesce(p_media_path, '');
  v_mime text := lower(split_part(coalesce(p_mime_type, 'audio/webm'), ';', 1));
  v_duration integer := least(greatest(coalesce(p_duration_seconds, 1), 1), 3600);
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

  if v_path !~ '^(keven|zubii)/[0-9a-f-]{36}\.(webm|ogg|m4a|mp3|wav)$'
     or split_part(v_path, '/', 1) <> lower(v_username) then
    raise exception 'This voice-note upload does not belong to your session.';
  end if;

  if v_mime not in ('audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac','audio/wav','audio/x-m4a') then
    raise exception 'This audio format is not supported.';
  end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'anonyms-voice-notes'
      and o.name = v_path
  ) then
    raise exception 'Voice note upload is not complete yet.';
  end if;

  insert into public.anonyms_messages (
    username, message, media_type, media_path, duration_seconds, created_at
  )
  values (v_username, 'Voice note', 'audio', v_path, v_duration, now())
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'message', jsonb_build_object(
      'id', v_row.id,
      'username', v_row.username,
      'message', 'Voice note',
      'created_at', v_row.created_at,
      'media_type', 'audio',
      'media_id', v_path,
      'media_url', '',
      'media_mime', v_mime,
      'duration_seconds', v_row.duration_seconds
    )
  );
end;
$$;

revoke all on function public.anonyms_fast_send_voice(text,text,text,integer) from public;
grant execute on function public.anonyms_fast_send_voice(text,text,text,integer) to anon, authenticated;
