-- =====================================================================
-- ADD-ONS: voice notes + online/offline indicator
-- Run this ONCE, after setup.sql:
--   Supabase → SQL Editor → New query → paste everything → Run
-- Safe to run again.
-- =====================================================================

-- 1) Voice-note columns on messages ------------------------------------
alter table public.messages add column if not exists audio_path    text;
alter table public.messages add column if not exists audio_seconds integer;

alter table public.messages drop constraint if exists messages_audio_check;
alter table public.messages add constraint messages_audio_check check (
  (audio_path is null and audio_seconds is null)
  or (
    audio_path is not null
    and audio_seconds between 1 and 300
    and split_part(audio_path, '/', 1) = username   -- file must live in the sender's own folder
  )
);

-- 2) Private storage bucket for the audio files --------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-notes', 'voice-notes', false, 10485760,   -- private, 10 MB max per file
  array['audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/aac','audio/x-m4a']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat members read voice notes"   on storage.objects;
drop policy if exists "chat members upload voice notes" on storage.objects;

-- Only Zubii/Keven can listen...
create policy "chat members read voice notes"
  on storage.objects for select to authenticated
  using (bucket_id = 'voice-notes' and public.current_chat_user() is not null);

-- ...and upload, only into their own folder. No update/delete policies.
create policy "chat members upload voice notes"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-notes'
    and public.current_chat_user() is not null
    and (storage.foldername(name))[1] = public.current_chat_user()
  );

-- 3) Realtime channel authorization (secures the online/offline indicator) --
--    Only verified chat members may join the realtime channel and share presence.
drop policy if exists "chat members receive realtime" on realtime.messages;
drop policy if exists "chat members send realtime"    on realtime.messages;

create policy "chat members receive realtime"
  on realtime.messages for select to authenticated
  using (public.current_chat_user() is not null);

create policy "chat members send realtime"
  on realtime.messages for insert to authenticated
  with check (public.current_chat_user() is not null);
