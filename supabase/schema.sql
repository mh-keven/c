-- Anonyms Supabase foundation
-- Run in Supabase SQL Editor only after reviewing the project target.
-- Auth users should be created manually for Keven and Zubii; disable public sign-ups.
-- Google Drive remains the private gallery file store. Supabase stores gallery metadata,
-- chat messages, voice-note objects, likes, comments, and realtime signaling state.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username in ('Keven', 'Zubii')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_anonyms_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare requested_username text;
begin
  requested_username := coalesce(new.raw_user_meta_data ->> 'username', '');
  if requested_username not in ('Keven', 'Zubii') then
    raise exception 'Anonyms account username must be Keven or Zubii';
  end if;
  insert into public.profiles (id, username)
  values (new.id, requested_username)
  on conflict (id) do update set username = excluded.username;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_anonyms on auth.users;
create trigger on_auth_user_created_anonyms after insert on auth.users
for each row execute function public.handle_new_anonyms_user();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  message_type text not null default 'text' check (message_type in ('text', 'voice')),
  voice_storage_path text,
  voice_mime_type text,
  voice_duration_seconds integer check (voice_duration_seconds is null or voice_duration_seconds between 1 and 3600),
  created_at timestamptz not null default now(),
  constraint message_content_check check (
    (message_type = 'text' and length(trim(body)) between 1 and 2000 and voice_storage_path is null)
    or (message_type = 'voice' and body = 'Voice note' and voice_storage_path is not null)
  )
);
create index if not exists messages_created_at_idx on public.messages (created_at desc);
create index if not exists messages_sender_created_at_idx on public.messages (sender_id, created_at desc);

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '',
  caption text not null default '',
  media_type text not null check (media_type in ('image', 'video')),
  source text not null check (source in ('drive', 'youtube')),
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

create table if not exists public.gallery_likes (
  gallery_item_id uuid not null references public.gallery_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (gallery_item_id, user_id)
);

create table if not exists public.gallery_comments (
  id uuid primary key default gen_random_uuid(),
  gallery_item_id uuid not null references public.gallery_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  comment text not null check (length(trim(comment)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists gallery_comments_item_created_idx on public.gallery_comments (gallery_item_id, created_at asc);

-- Call rooms contain state only. Cloudflare credentials must remain server-side.
create table if not exists public.call_rooms (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'declined')),
  cloudflare_session_id text,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.gallery_items enable row level security;
alter table public.gallery_likes enable row level security;
alter table public.gallery_comments enable row level security;
alter table public.call_rooms enable row level security;

drop policy if exists "Anonyms users can view profiles" on public.profiles;
create policy "Anonyms users can view profiles" on public.profiles
for select to authenticated using (exists (select 1 from public.profiles me where me.id = auth.uid()));

drop policy if exists "Anonyms users can read messages" on public.messages;
create policy "Anonyms users can read messages" on public.messages
for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can send own messages" on public.messages;
create policy "Users can send own messages" on public.messages
for insert to authenticated with check (sender_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can delete own messages" on public.messages;
create policy "Users can delete own messages" on public.messages
for delete to authenticated using (sender_id = auth.uid());

drop policy if exists "Anonyms users can read gallery" on public.gallery_items;
create policy "Anonyms users can read gallery" on public.gallery_items
for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can add own gallery metadata" on public.gallery_items;
create policy "Users can add own gallery metadata" on public.gallery_items
for insert to authenticated with check (uploader_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can delete own gallery metadata" on public.gallery_items;
create policy "Users can delete own gallery metadata" on public.gallery_items
for delete to authenticated using (uploader_id = auth.uid());

drop policy if exists "Anonyms users can read likes" on public.gallery_likes;
create policy "Anonyms users can read likes" on public.gallery_likes
for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can like as themselves" on public.gallery_likes;
create policy "Users can like as themselves" on public.gallery_likes
for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can remove own likes" on public.gallery_likes;
create policy "Users can remove own likes" on public.gallery_likes
for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Anonyms users can read comments" on public.gallery_comments;
create policy "Anonyms users can read comments" on public.gallery_comments
for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can comment as themselves" on public.gallery_comments;
create policy "Users can comment as themselves" on public.gallery_comments
for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can delete own comments" on public.gallery_comments;
create policy "Users can delete own comments" on public.gallery_comments
for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Anonyms users can view call rooms" on public.call_rooms;
create policy "Anonyms users can view call rooms" on public.call_rooms
for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can create own call rooms" on public.call_rooms;
create policy "Users can create own call rooms" on public.call_rooms
for insert to authenticated with check (created_by = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid()));

-- Private voice-note bucket. Store objects under {auth.uid()}/filename.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anonyms-voice-notes', 'anonyms-voice-notes', false, 52428800,
        array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/aac'])
on conflict (id) do update set public = false;

drop policy if exists "Anonyms users can read voice notes" on storage.objects;
create policy "Anonyms users can read voice notes" on storage.objects
for select to authenticated using (bucket_id = 'anonyms-voice-notes' and exists (select 1 from public.profiles p where p.id = auth.uid()));
drop policy if exists "Users can upload their own voice notes" on storage.objects;
create policy "Users can upload their own voice notes" on storage.objects
for insert to authenticated with check (
  bucket_id = 'anonyms-voice-notes' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid())
);
drop policy if exists "Users can delete their own voice notes" on storage.objects;
create policy "Users can delete their own voice notes" on storage.objects
for delete to authenticated using (bucket_id = 'anonyms-voice-notes' and (storage.foldername(name))[1] = auth.uid()::text);

-- Enable Realtime for live rows, only if not already published.
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

grant select on public.profiles, public.messages, public.gallery_items, public.gallery_likes, public.gallery_comments, public.call_rooms to authenticated;
grant insert, delete on public.messages, public.gallery_likes, public.gallery_comments to authenticated;
grant insert, delete on public.gallery_items to authenticated;
grant select, insert on public.call_rooms to authenticated;
