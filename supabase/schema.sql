-- Anonyms Supabase migration add-ons (compatible with the previous custom chat_login model)
-- This is additive to the original Supabase schema. It expects these existing server-side
-- functions to be present: public.current_chat_user(), public.chat_login(),
-- public.chat_whoami(), public.chat_peer_status(), public.chat_touch(), public.chat_logout().
-- Do not run this against a different Supabase project without verifying those functions first.
-- Google Drive remains the gallery file store; only gallery metadata is kept in PostgreSQL.

-- 1) Voice-note support on the existing messages table.
alter table public.messages add column if not exists audio_path text;
alter table public.messages add column if not exists audio_seconds integer;
alter table public.messages drop constraint if exists messages_audio_check;
alter table public.messages add constraint messages_audio_check check (
  (audio_path is null and audio_seconds is null)
  or (audio_path is not null
      and audio_seconds between 1 and 300
      and split_part(audio_path, '/', 1) = username)
);

-- 2) Private voice-note storage. Existing model uses Zubii/Keven folder names.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-notes', 'voice-notes', false, 10485760,
        array['audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/aac','audio/x-m4a'])
on conflict (id) do update set
  public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat members read voice notes" on storage.objects;
drop policy if exists "chat members upload voice notes" on storage.objects;
create policy "chat members read voice notes" on storage.objects
for select to authenticated using (
  bucket_id = 'voice-notes' and public.current_chat_user() is not null
);
create policy "chat members upload voice notes" on storage.objects
for insert to authenticated with check (
  bucket_id = 'voice-notes'
  and public.current_chat_user() is not null
  and (storage.foldername(name))[1] = public.current_chat_user()
);

-- 3) Gallery metadata. The actual private photo/video binary remains in Google Drive.
create table if not exists public.gallery_items (
  id text primary key,
  uploader text not null check (uploader in ('Keven','Zubii')),
  title text not null default '',
  caption text not null default '',
  media_type text not null check (media_type in ('image','video')),
  source text not null check (source in ('drive','youtube')),
  drive_file_id text,
  youtube_id text,
  mime_type text,
  created_at timestamptz not null default now(),
  constraint gallery_source_check check (
    (source = 'drive' and drive_file_id is not null and youtube_id is null)
    or (source = 'youtube' and youtube_id is not null and drive_file_id is null)
  )
);
create index if not exists gallery_items_created_at_idx on public.gallery_items (created_at desc);
alter table public.gallery_items enable row level security;
alter table public.gallery_items force row level security;
drop policy if exists "chat members read gallery metadata" on public.gallery_items;
drop policy if exists "chat members insert gallery metadata" on public.gallery_items;
drop policy if exists "chat members delete own gallery metadata" on public.gallery_items;
create policy "chat members read gallery metadata" on public.gallery_items
for select to authenticated using (public.current_chat_user() is not null);
create policy "chat members insert gallery metadata" on public.gallery_items
for insert to authenticated with check (uploader = public.current_chat_user());
create policy "chat members delete own gallery metadata" on public.gallery_items
for delete to authenticated using (uploader = public.current_chat_user());
revoke all on public.gallery_items from anon;
revoke all on public.gallery_items from authenticated;
grant select, insert, delete on public.gallery_items to authenticated;


-- 4) Likes and comments are tied to the verified chat username, never client-supplied identity.
create table if not exists public.gallery_likes (
  gallery_item_id text not null,
  username text not null check (username in ('Keven','Zubii')),
  created_at timestamptz not null default now(),
  primary key (gallery_item_id, username)
);
create table if not exists public.gallery_comments (
  id text primary key default gen_random_uuid()::text,
  gallery_item_id bigint not null references public.gallery_items(id) on delete cascade,
  username text not null check (username in ('Keven','Zubii')),
  comment text not null check (char_length(btrim(comment)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists gallery_comments_item_created_idx on public.gallery_comments (gallery_item_id, created_at asc, id asc);
alter table public.gallery_likes enable row level security;
alter table public.gallery_likes force row level security;
alter table public.gallery_comments enable row level security;
alter table public.gallery_comments force row level security;

drop policy if exists "chat members read likes" on public.gallery_likes;
drop policy if exists "chat members add own likes" on public.gallery_likes;
drop policy if exists "chat members remove own likes" on public.gallery_likes;
create policy "chat members read likes" on public.gallery_likes
for select to authenticated using (public.current_chat_user() is not null);
create policy "chat members add own likes" on public.gallery_likes
for insert to authenticated with check (username = public.current_chat_user());
create policy "chat members remove own likes" on public.gallery_likes
for delete to authenticated using (username = public.current_chat_user());
drop policy if exists "chat members read comments" on public.gallery_comments;
drop policy if exists "chat members add own comments" on public.gallery_comments;
drop policy if exists "chat members delete own comments" on public.gallery_comments;
create policy "chat members read comments" on public.gallery_comments
for select to authenticated using (public.current_chat_user() is not null);
create policy "chat members add own comments" on public.gallery_comments
for insert to authenticated with check (username = public.current_chat_user());
create policy "chat members delete own comments" on public.gallery_comments
for delete to authenticated using (username = public.current_chat_user());

revoke all on public.gallery_likes from anon;
revoke all on public.gallery_likes from authenticated;
grant select, insert, delete on public.gallery_likes to authenticated;
revoke all on public.gallery_comments from anon;
revoke all on public.gallery_comments from authenticated;
grant select, insert, delete on public.gallery_comments to authenticated;


-- 5) Realtime subscriptions for chat and social updates.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gallery_likes') then
    alter publication supabase_realtime add table public.gallery_likes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gallery_comments') then
    alter publication supabase_realtime add table public.gallery_comments;
  end if;
end $$;

-- Secure presence channel authorization: only verified chat members may join.
drop policy if exists "chat members receive realtime" on realtime.messages;
drop policy if exists "chat members send realtime" on realtime.messages;
create policy "chat members receive realtime" on realtime.messages
for select to authenticated using (public.current_chat_user() is not null);
create policy "chat members send realtime" on realtime.messages
for insert to authenticated with check (public.current_chat_user() is not null);
